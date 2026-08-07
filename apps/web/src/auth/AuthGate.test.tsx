import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import type { AuthUser } from '../api';
import { AuthGate } from './AuthGate';
import { AuthProvider } from './AuthContext';

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

function renderGate() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AuthGate>
          <div data-testid="protected-app">Protected app content</div>
        </AuthGate>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('AuthGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('AC1: shows only the loading spinner, never the app, before /auth/me resolves', async () => {
    let resolveMe!: (value: AuthUser | null) => void;
    vi.spyOn(api, 'fetchCurrentUser').mockReturnValue(
      new Promise((resolve) => {
        resolveMe = resolve;
      }),
    );

    renderGate();

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();

    resolveMe(null);
    await waitFor(() => expect(screen.queryByTestId('auth-loading')).not.toBeInTheDocument());
  });

  it('AC1: signed-out visit renders LoginPage, never the app content', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(null);

    renderGate();

    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();
  });

  it('AC2: pending user sees PendingPage, not the app', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser({ status: 'pending' }));

    renderGate();

    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();
  });

  it('AC2: after approval, clicking "Check again" refreshes and lands in the app', async () => {
    const fetchMock = vi
      .spyOn(api, 'fetchCurrentUser')
      .mockResolvedValueOnce(authUser({ status: 'pending' }))
      .mockResolvedValueOnce(authUser({ status: 'approved' }));

    renderGate();
    await screen.findByText('Waiting for approval');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /check again/i }));

    expect(await screen.findByTestId('protected-app')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejected user sees RejectedPage', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser({ status: 'rejected' }));

    renderGate();

    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument();
  });

  it('approved user sees the app', async () => {
    vi.spyOn(api, 'fetchCurrentUser').mockResolvedValue(authUser({ status: 'approved' }));

    renderGate();

    expect(await screen.findByTestId('protected-app')).toBeInTheDocument();
  });

  it('AC4: a 401/403 from any API call re-checks auth and drops back to LoginPage', async () => {
    const fetchMock = vi
      .spyOn(api, 'fetchCurrentUser')
      .mockResolvedValueOnce(authUser({ status: 'approved' }))
      .mockResolvedValueOnce(null);

    renderGate();
    await screen.findByTestId('protected-app');

    // Simulate a 401/403 coming back from an unrelated API call — the real
    // request() helper invokes the listener api.ts registers this through.
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    try {
      await api.fetchItems();
    } catch {
      // expected: request() throws on non-ok responses
    }
    global.fetch = originalFetch;

    await waitFor(() => expect(screen.queryByTestId('protected-app')).not.toBeInTheDocument());
    expect(await screen.findByRole('link', { name: /sign in with google/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
