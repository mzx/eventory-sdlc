import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import type { AdminUserRow, AuthUser } from '../api';
import { AuthContext } from '../auth/AuthContext';
import { AdminUsersPage } from './AdminUsersPage';

function row(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 'user-1',
    email: 'pending@example.com',
    name: 'Pending Person',
    picture: null,
    status: 'pending',
    role: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    lastLoginAt: null,
    ...overrides,
  };
}

function currentAdmin(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'admin-1',
    email: 'admin@example.com',
    name: 'Admin Person',
    picture: null,
    status: 'approved',
    role: 'admin',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(user: AuthUser = currentAdmin()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthContext.Provider
          value={{ user, loading: false, refresh: vi.fn().mockResolvedValue(undefined) }}
        >
          <AdminUsersPage />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminUsersPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC3: renders a table row per user', async () => {
    vi.spyOn(api, 'fetchUsers').mockResolvedValue([
      row({ id: 'u1', email: 'pending@example.com', status: 'pending' }),
      row({ id: 'u2', email: 'approved@example.com', status: 'approved' }),
    ]);

    renderPage();

    expect(await screen.findAllByTestId('admin-user-row')).toHaveLength(2);
    expect(screen.getByText('pending@example.com')).toBeInTheDocument();
    expect(screen.getByText('approved@example.com')).toBeInTheDocument();
  });

  it('AC3: approving a pending user calls updateUserStatus and optimistically flips the chip', async () => {
    // Mimics the real server: after the mutation lands, the invalidated
    // refetch of GET /api/users reflects the new status.
    vi.spyOn(api, 'fetchUsers')
      .mockResolvedValueOnce([row({ id: 'u1', email: 'pending@example.com', status: 'pending' })])
      .mockResolvedValue([row({ id: 'u1', email: 'pending@example.com', status: 'approved' })]);
    const updateStatusMock = vi
      .spyOn(api, 'updateUserStatus')
      .mockResolvedValue(row({ id: 'u1', email: 'pending@example.com', status: 'approved' }));

    renderPage();
    await screen.findByText('pending@example.com');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /approve pending@example.com/i }));

    expect(updateStatusMock).toHaveBeenCalledWith('u1', 'approved');
    await waitFor(() => expect(screen.getByText('approved')).toBeInTheDocument());
  });

  it('disables reject and the role toggle on the admin viewing their own row', async () => {
    vi.spyOn(api, 'fetchUsers').mockResolvedValue([
      row({ id: 'admin-1', email: 'admin@example.com', status: 'approved', role: 'admin' }),
    ]);

    renderPage();
    await screen.findByText('admin@example.com');

    expect(screen.getByRole('button', { name: /reject admin@example.com/i })).toBeDisabled();
    expect(
      screen.getByRole('checkbox', { name: /admin role for admin@example.com/i }),
    ).toBeDisabled();
  });
});
