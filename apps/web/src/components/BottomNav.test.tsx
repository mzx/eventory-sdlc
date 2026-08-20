import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { BottomNav } from './BottomNav';

function renderNav(initialEntry: string, props: Partial<Parameters<typeof BottomNav>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BottomNav
        openShoppingListCount={0}
        overdueVerificationCount={0}
        onScanClick={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  );
}

function getNav() {
  return screen.getByRole('navigation', { name: /primary mobile navigation/i });
}

/**
 * Active-tab (`value`) coverage (test-reviewer, round 2): the previous test
 * suite only ever rendered the bottom nav at `/`, so the `value` derivation
 * in BottomNav.tsx (which tab highlights for a given `location.pathname`)
 * had no coverage for any of its other branches.
 */
describe('BottomNav active-tab selection', () => {
  it('highlights Items at "/"', () => {
    renderNav('/');
    expect(within(getNav()).getByRole('link', { name: /^items$/i })).toHaveClass('Mui-selected');
  });

  it.each(['/items/item-1', '/items/item-1/edit'])(
    'keeps Items highlighted on the nested route %s',
    (path) => {
      // Round-2 code-reviewer finding: `value` used `pathname === '/'`
      // (exact match) for Items, so `/items/:id` and `/items/:id/edit`
      // fell through to no tab highlighted at all.
      renderNav(path);
      expect(within(getNav()).getByRole('link', { name: /^items$/i })).toHaveClass('Mui-selected');
    },
  );

  it('highlights Add at "/intake"', () => {
    renderNav('/intake');
    expect(within(getNav()).getByRole('link', { name: /^add$/i })).toHaveClass('Mui-selected');
  });

  it('highlights Shopping at "/shopping-list"', () => {
    renderNav('/shopping-list');
    expect(within(getNav()).getByRole('link', { name: /^shopping$/i })).toHaveClass('Mui-selected');
  });

  it.each(['/projects', '/locations', '/verification'])(
    'highlights More at %s (demoted routes)',
    (path) => {
      renderNav(path);
      expect(within(getNav()).getByRole('button', { name: /^more$/i })).toHaveClass('Mui-selected');
    },
  );

  it.each(['/projects/proj-1', '/locations/loc-1'])(
    'highlights More on nested demoted routes %s too',
    (path) => {
      renderNav(path);
      expect(within(getNav()).getByRole('button', { name: /^more$/i })).toHaveClass('Mui-selected');
    },
  );

  it('highlights nothing for an unrelated route (e.g. /r/:token)', () => {
    renderNav('/r/some-token');
    const nav = getNav();
    expect(within(nav).getByRole('link', { name: /^items$/i })).not.toHaveClass('Mui-selected');
    expect(within(nav).getByRole('link', { name: /^shopping$/i })).not.toHaveClass('Mui-selected');
    expect(within(nav).getByRole('button', { name: /^more$/i })).not.toHaveClass('Mui-selected');
  });
});

describe('BottomNav workspace switcher + viewer-aware UI (EVT-43)', () => {
  it('disables the "Add" tab for a viewer', () => {
    renderNav('/', { isViewer: true });
    expect(within(getNav()).getByRole('link', { name: /^add$/i })).toHaveClass('Mui-disabled');
  });

  it('keeps the "Add" tab enabled for a member', () => {
    renderNav('/', { isViewer: false });
    expect(within(getNav()).getByRole('link', { name: /^add$/i })).not.toHaveClass('Mui-disabled');
  });

  it('"Switch workspace" in More calls onSwitchWorkspace', async () => {
    const onSwitchWorkspace = vi.fn();
    renderNav('/', { onSwitchWorkspace });
    const user = userEvent.setup();

    await user.click(within(getNav()).getByRole('button', { name: /^more$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /switch workspace/i }));

    expect(onSwitchWorkspace).toHaveBeenCalled();
  });

  it('shows "Members" in More only for a workspace owner', async () => {
    renderNav('/', { isOwner: false });
    const user = userEvent.setup();
    await user.click(within(getNav()).getByRole('button', { name: /^more$/i }));
    expect(screen.queryByRole('menuitem', { name: /^members$/i })).not.toBeInTheDocument();
  });

  it('shows "Members" in More for a workspace owner', async () => {
    renderNav('/', { isOwner: true });
    const user = userEvent.setup();
    await user.click(within(getNav()).getByRole('button', { name: /^more$/i }));
    expect(await screen.findByRole('menuitem', { name: /^members$/i })).toBeInTheDocument();
  });
});
