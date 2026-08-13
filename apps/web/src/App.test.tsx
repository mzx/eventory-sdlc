import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import type { AuthUser } from './api';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

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
    // AppShell's nav badge (EVT-26 AC 6) queries this on every render;
    // stub it so these auth-focused tests don't make a real network call.
    vi.spyOn(api, 'fetchShoppingList').mockResolvedValue([]);
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
});
