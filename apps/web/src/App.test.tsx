import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import type { AuthUser } from './api';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { mockPhoneViewport } from './test/mockMatchMedia';

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

function renderApp(initialEntry = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('App / auth-aware shell', () => {
  beforeEach(() => {
    // AppShell's nav badges (EVT-26 AC 6, EVT-27) query these on every
    // render; stub them so these auth-focused tests don't make a real
    // network call.
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([]);
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC3: non-admin sees no Admin menu entry and /admin/users redirects home', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser({ role: 'user' }));
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);

    renderApp('/admin/users');

    // Redirected home — ItemsPage's empty state renders, not the users table.
    expect(await screen.findByText('No items yet')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('account menu'));
    expect(screen.queryByText(/admin.*users/i)).not.toBeInTheDocument();
  });

  it('AC3: admin sees the Admin > Users menu entry and can navigate to it', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser({ role: 'admin' }));
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchUsers').mockResolvedValue([]);

    renderApp('/');
    await screen.findByText('No items yet');

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('account menu'));
    await user.click(await screen.findByText(/admin.*users/i));

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
  });

  it('AC4: logout link points at the API logout URL (full-page navigation, clears cookie server-side)', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);

    renderApp('/');
    await screen.findByText('No items yet');

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('account menu'));
    const logoutLink = await screen.findByRole('menuitem', { name: /log out/i });

    await waitFor(() => expect(logoutLink).toHaveAttribute('href', '/api/auth/logout'));
  });

  // =========================================================================
  // Shopping List nav badge (EVT-26 AC 6)
  // =========================================================================

  it('AC6: the nav badge shows the count of open shopping-list entries', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([
      {
        id: 'entry-1',
        itemId: 'item-1',
        status: 'open',
        source: 'manual',
        createdAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
        item: {
          id: 'item-1',
          name: 'Screws',
          quantity: 1,
          minQuantity: 5,
          qrCode: 'qr-1',
          primaryPhoto: null,
          location: null,
        },
      },
    ]);

    renderApp('/');
    await screen.findByText('No items yet');

    const navLink = await screen.findByRole('link', { name: /shopping list/i });
    expect(within(navLink).getByText('1')).toBeInTheDocument();
  });

  it('shows no badge count when the shopping list is empty', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([]);

    renderApp('/');
    await screen.findByText('No items yet');

    const navLink = await screen.findByRole('link', { name: /shopping list/i });
    // MUI's Badge always renders the count node; a `0` count is hidden via
    // the `MuiBadge-invisible` class (CSS `display: none`) rather than being
    // absent from the DOM — jsdom doesn't compute that rule for `toBeVisible`,
    // so assert on the class directly.
    expect(within(navLink).getByText('0')).toHaveClass('MuiBadge-invisible');
  });

  // =========================================================================
  // Verification nav badge (EVT-27)
  // =========================================================================

  it('the nav badge shows the count of overdue verification-queue items', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([
      {
        id: 'item-1',
        name: 'Box of Screws',
        quantity: 10,
        qrCode: 'qr-1',
        lastVerifiedAt: null,
        countIntervalDays: 30,
        createdAt: '2026-01-01T00:00:00.000Z',
        primaryPhoto: null,
        location: null,
        daysOverdue: 5,
      },
    ]);

    renderApp('/');
    await screen.findByText('No items yet');

    const navLink = await screen.findByRole('link', { name: /verification/i });
    expect(within(navLink).getByText('1')).toBeInTheDocument();
  });
});

// ===========================================================================
// Phone-width bottom navigation (EVT-35)
// ===========================================================================

describe('App / phone-width bottom navigation (EVT-35)', () => {
  const shoppingListEntry = {
    id: 'entry-1',
    itemId: 'item-1',
    status: 'open' as const,
    source: 'manual' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    resolvedAt: null,
    item: {
      id: 'item-1',
      name: 'Screws',
      quantity: 1,
      minQuantity: 5,
      qrCode: 'qr-1',
      primaryPhoto: null,
      location: null,
    },
  };
  const verificationEntry = {
    id: 'item-1',
    name: 'Box of Screws',
    quantity: 10,
    qrCode: 'qr-1',
    lastVerifiedAt: null,
    countIntervalDays: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    primaryPhoto: null,
    location: null,
    daysOverdue: 5,
  };

  beforeEach(() => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser());
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
    vi.spyOn(api, 'fetchTags').mockResolvedValue([]);
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([shoppingListEntry]);
    vi.spyOn(api, 'fetchVerificationQueue').mockResolvedValue([verificationEntry]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC1/AC2: at xs/sm the AppBar drops the text-button row and a bottom nav with all destinations (badged) renders', async () => {
    mockPhoneViewport();
    renderApp('/');
    await screen.findByText('No items yet');

    // AppBar keeps only title + avatar — the desktop-only text buttons are
    // gone. Scoped to the `banner` landmark since ItemsPage's own empty-state
    // also renders an unrelated "Add item" link (ItemsPage.tsx) regardless
    // of viewport.
    const banner = screen.getByRole('banner');
    expect(within(banner).queryByRole('link', { name: /^projects$/i })).not.toBeInTheDocument();
    expect(within(banner).queryByRole('link', { name: /^locations$/i })).not.toBeInTheDocument();
    expect(within(banner).queryByRole('link', { name: /add item/i })).not.toBeInTheDocument();
    expect(within(banner).getByLabelText('account menu')).toBeInTheDocument();

    const bottomNav = screen.getByRole('navigation', { name: /primary mobile navigation/i });

    // Directly reachable: Items, Scan, Add, Shopping (AC1/2).
    expect(within(bottomNav).getByRole('link', { name: /items/i })).toHaveAttribute('href', '/');
    expect(within(bottomNav).getByRole('button', { name: /scan/i })).toBeInTheDocument();
    expect(within(bottomNav).getByRole('link', { name: /add/i })).toHaveAttribute(
      'href',
      '/intake',
    );
    const shoppingAction = within(bottomNav).getByRole('link', { name: /shopping/i });
    expect(shoppingAction).toHaveAttribute('href', '/shopping-list');
    expect(within(shoppingAction).getByText('1')).toBeInTheDocument(); // shopping-list badge

    // Verification count badges the "More" action instead (it's demoted
    // into the overflow menu at phone width) — AC1's "badge counts for
    // shopping list + verification" still holds even though Verification
    // itself isn't a top-level slot.
    const moreAction = within(bottomNav).getByRole('button', { name: /more/i });
    expect(within(moreAction).getByText('1')).toBeInTheDocument();

    // Reachable via More: Projects, Locations, Verification (AC2).
    const user = userEvent.setup();
    await user.click(moreAction);
    expect(await screen.findByRole('menuitem', { name: /projects/i })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(screen.getByRole('menuitem', { name: /locations/i })).toHaveAttribute(
      'href',
      '/locations',
    );
    expect(screen.getByRole('menuitem', { name: /verification/i })).toHaveAttribute(
      'href',
      '/verification',
    );
  });

  it('AC4: page content reserves bottom space so it is never obscured by the fixed bottom nav', async () => {
    mockPhoneViewport();
    renderApp('/');
    await screen.findByText('No items yet');

    const bottomNav = screen.getByRole('navigation', { name: /primary mobile navigation/i });
    // Fixed to the viewport bottom and respects the iOS PWA safe-area inset.
    expect(bottomNav).toHaveStyle({
      position: 'fixed',
      bottom: '0px',
      paddingBottom: 'env(safe-area-inset-bottom)',
    });

    // The routed page content itself reserves room below its last row so
    // the fixed bottom nav never overlaps it (the Container's `pb`, App.tsx).
    const main = screen.getByText('No items yet').closest('.MuiContainer-root');
    expect(main).toHaveStyle({ paddingBottom: 'calc(64px + env(safe-area-inset-bottom))' });
  });

  it('AC3: desktop (md+) keeps the full toolbar and never renders the bottom nav', async () => {
    // No mockPhoneViewport() call — the default stub (setup.ts) matches
    // every query, i.e. `up('md')` resolves true (desktop).
    renderApp('/');
    await screen.findByText('No items yet');

    const banner = screen.getByRole('banner');
    expect(within(banner).getByRole('link', { name: /^projects$/i })).toHaveAttribute(
      'href',
      '/projects',
    );
    expect(within(banner).getByRole('link', { name: /add item/i })).toHaveAttribute(
      'href',
      '/intake',
    );
    expect(
      screen.queryByRole('navigation', { name: /primary mobile navigation/i }),
    ).not.toBeInTheDocument();
  });
});
