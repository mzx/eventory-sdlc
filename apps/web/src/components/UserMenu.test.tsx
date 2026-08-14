import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../api';
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
