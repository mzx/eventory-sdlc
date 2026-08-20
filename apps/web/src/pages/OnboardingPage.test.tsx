import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { OnboardingPage } from './OnboardingPage';

function renderOnboarding() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage />
    </QueryClientProvider>,
  );
}

describe('OnboardingPage (EVT-43 AC4)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a workspace and sets it active', async () => {
    const created = {
      id: 'ws-new',
      name: 'The Smiths',
      role: 'owner' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    // Empty until creation; the post-create `refetch()` must observe the
    // now-real membership (mirrors the real server) for the self-healing
    // `useMyWorkspaces()` effect to keep the just-set active id instead of
    // reverting it back to null.
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValueOnce([]).mockResolvedValue([created]);
    const createMock = vi.spyOn(api, 'createWorkspace').mockResolvedValue(created);
    const user = userEvent.setup();

    renderOnboarding();

    await user.type(screen.getByLabelText('Workspace name'), 'The Smiths');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('The Smiths'));
    await waitFor(() => expect(api.getActiveWorkspaceId()).toBe('ws-new'));
  });

  it('shows an error when workspace creation fails', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);
    vi.spyOn(api, 'createWorkspace').mockRejectedValue(new Error('name already taken'));
    const user = userEvent.setup();

    renderOnboarding();

    await user.type(screen.getByLabelText('Workspace name'), 'The Smiths');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));

    expect(await screen.findByText('name already taken')).toBeInTheDocument();
  });

  it('redeems an invite token and sets the resulting workspace active', async () => {
    const joined = {
      id: 'ws-redeemed',
      name: 'Garage',
      role: 'member' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValueOnce([]).mockResolvedValue([joined]);
    const redeemMock = vi
      .spyOn(api, 'redeemInvite')
      .mockResolvedValue({ workspaceId: 'ws-redeemed', role: 'member' });
    const user = userEvent.setup();

    renderOnboarding();

    await user.type(screen.getByLabelText('Invite token'), 'raw-token-abc');
    await user.click(screen.getByRole('button', { name: /redeem invite/i }));

    await waitFor(() => expect(redeemMock).toHaveBeenCalledWith('raw-token-abc'));
    await waitFor(() => expect(api.getActiveWorkspaceId()).toBe('ws-redeemed'));
  });

  it('shows an error when redemption fails', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);
    vi.spyOn(api, 'redeemInvite').mockRejectedValue(
      new Error('Invite has already been used, revoked, or expired'),
    );
    const user = userEvent.setup();

    renderOnboarding();

    await user.type(screen.getByLabelText('Invite token'), 'raw-token-abc');
    await user.click(screen.getByRole('button', { name: /redeem invite/i }));

    expect(
      await screen.findByText('Invite has already been used, revoked, or expired'),
    ).toBeInTheDocument();
  });

  it('offers a log out link', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);

    renderOnboarding();

    expect(await screen.findByRole('link', { name: /log out/i })).toHaveAttribute(
      'href',
      '/api/auth/logout',
    );
  });
});
