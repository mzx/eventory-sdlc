import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { InviteRedeemPage } from './InviteRedeemPage';

function renderInvitePage(token = 'raw-token-abc') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/invite/${token}`]}>
        <Routes>
          <Route path="/invite/:token" element={<InviteRedeemPage />} />
          <Route path="/" element={<div>items list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InviteRedeemPage (EVT-43 AC4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redeems the token, sets the active workspace, and lands on the app', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([
      { id: 'ws-redeemed', name: 'Garage', role: 'member', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const redeemMock = vi
      .spyOn(api, 'redeemInvite')
      .mockResolvedValue({ workspaceId: 'ws-redeemed', role: 'member' });

    renderInvitePage('raw-token-abc');

    await waitFor(() => expect(redeemMock).toHaveBeenCalledWith('raw-token-abc'));
    expect(await screen.findByText('items list')).toBeInTheDocument();
    expect(api.getActiveWorkspaceId()).toBe('ws-redeemed');
  });

  it('shows an error with a "Go home" link when redemption fails', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);
    vi.spyOn(api, 'redeemInvite').mockRejectedValue(
      new Error('Invite has already been used, revoked, or expired'),
    );

    renderInvitePage('raw-token-abc');

    expect(
      await screen.findByText('Invite has already been used, revoked, or expired'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /go home/i })).toBeInTheDocument();
  });

  it('shows an error for an unknown token', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);
    vi.spyOn(api, 'redeemInvite').mockRejectedValue(new Error('Invite not found'));

    renderInvitePage('unknown-token');

    expect(await screen.findByText('Invite not found')).toBeInTheDocument();
  });
});
