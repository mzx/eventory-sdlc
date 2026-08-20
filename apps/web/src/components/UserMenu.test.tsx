import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getActiveWorkspaceId, setActiveWorkspaceId, type AuthUser } from '../api';
import { getActiveWorkspaceRole, setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';
import { UserMenu } from './UserMenu';

function authUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'op@example.com',
    name: 'Operator',
    picture: null,
    status: 'approved',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByLabelText('account menu'));
}

describe('UserMenu build version (EVT-34)', () => {
  it('AC1: shows a non-interactive entry with the short sha + build date for a real build', async () => {
    render(<UserMenu user={authUser()} version="994831b · 2026-08-14" />);

    await openMenu();

    const entry = screen.getByLabelText('build version');
    expect(entry).toHaveTextContent('994831b · 2026-08-14');
    // Non-interactive: MUI marks a disabled MenuItem with aria-disabled,
    // not a click handler that navigates or mutates state.
    expect(entry).toHaveAttribute('aria-disabled', 'true');
  });

  it('AC4: shows the "dev" marker instead of a missing or fabricated version', async () => {
    render(<UserMenu user={authUser()} version="dev" />);

    await openMenu();

    expect(screen.getByLabelText('build version')).toHaveTextContent('dev');
  });

  it('defaults to the build-time __BUILD_VERSION__ global when no version prop is passed', async () => {
    // Under `vitest run`, vite.config.ts's `define` resolves __BUILD_VERSION__
    // from the repo-root VERSION file, which is never git-archive-substituted
    // in a working-tree checkout — so the default is always the `dev` marker
    // here, exercising the same fallback path as AC4 with zero test setup.
    render(<UserMenu user={authUser()} />);

    await openMenu();

    expect(screen.getByLabelText('build version')).toHaveTextContent(__BUILD_VERSION__);
  });

  it('renders the version entry alongside the existing name header and logout link', async () => {
    render(<UserMenu user={authUser({ name: 'Sam Carter' })} version="994831b · 2026-08-14" />);

    await openMenu();

    expect(screen.getByText('Sam Carter')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    expect(screen.getByLabelText('build version')).toHaveTextContent('994831b · 2026-08-14');
  });
});

describe('UserMenu workspace switcher (EVT-43)', () => {
  it('shows the active workspace name and calls onSwitchWorkspace', async () => {
    const onSwitchWorkspace = vi.fn();
    render(
      <UserMenu
        user={authUser()}
        activeWorkspaceName="Home"
        onSwitchWorkspace={onSwitchWorkspace}
      />,
    );

    await openMenu();

    expect(screen.getByText(/workspace: home/i)).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('menuitem', { name: /switch workspace/i }));
    expect(onSwitchWorkspace).toHaveBeenCalled();
  });

  it('shows the "Members" entry only for a workspace owner', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <UserMenu user={authUser()} isOwner={false} />
      </MemoryRouter>,
    );
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: /^members$/i })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <UserMenu user={authUser()} isOwner />
      </MemoryRouter>,
    );
    await openMenu();
    expect(screen.getByRole('menuitem', { name: /^members$/i })).toBeInTheDocument();
  });
});

// Round-2 review, MAJOR 1: `authLogoutUrl()` is a full-page nav — the JS
// module graph (and its in-memory active-workspace store) tears down and
// reloads from scratch, but `localStorage` survives the reload. Left
// unhandled, the NEXT sign-in on this browser (a different account on a
// shared machine, or the same account rejoining later) would inherit this
// session's `X-Workspace-Id`/role.
describe('UserMenu logout clears the stale active-workspace selection (EVT-43 round-2)', () => {
  afterEach(() => {
    setActiveWorkspaceId(null);
    setActiveWorkspaceRole(null);
    vi.restoreAllMocks();
  });

  it('clears the persisted workspace id and role when "Log out" is clicked', async () => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceRole('owner');
    // jsdom logs (but does not throw on) "Not implemented: navigation" for a
    // real `<a href>` click — silence it so the assertion output stays
    // readable; the handler under test runs synchronously before any
    // navigation attempt either way.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<UserMenu user={authUser()} />);
    await openMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole('menuitem', { name: /log out/i }));

    expect(getActiveWorkspaceId()).toBeNull();
    expect(getActiveWorkspaceRole()).toBeNull();
  });
});
