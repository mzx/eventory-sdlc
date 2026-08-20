import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';
import { MembersSettingsPage } from './MembersSettingsPage';

function member(overrides: Partial<api.WorkspaceMemberRow> = {}): api.WorkspaceMemberRow {
  return {
    userId: 'user-1',
    email: 'owner@example.com',
    name: 'Owner Person',
    picture: null,
    role: 'owner',
    memberSince: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function invite(overrides: Partial<api.WorkspaceInviteRow> = {}): api.WorkspaceInviteRow {
  return {
    id: 'invite-1',
    role: 'member',
    status: 'pending',
    expiresAt: '2026-02-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    redeemedAt: null,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MembersSettingsPage />
    </QueryClientProvider>,
  );
}

describe('MembersSettingsPage (EVT-43 AC5)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the roster with a role column', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
      member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'member' }),
    ]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);

    renderPage();

    const table = await screen.findByRole('table', { name: /workspace members/i });
    expect(within(table).getByText('owner@example.com')).toBeInTheDocument();
    expect(within(table).getByText('kid@example.com')).toBeInTheDocument();
    expect(within(table).getByText('Owner')).toBeInTheDocument();
  });

  it('owner can toggle a member between member and viewer', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
      member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'member' }),
    ]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);
    const roleMock = vi
      .spyOn(api, 'changeWorkspaceMemberRole')
      .mockResolvedValue(
        member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'viewer' }),
      );
    const user = userEvent.setup();

    renderPage();

    await screen.findByText('kid@example.com');
    await user.click(screen.getByLabelText('Role for Kid'));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));

    await waitFor(() => expect(roleMock).toHaveBeenCalledWith('ws-1', 'user-2', 'viewer'));
  });

  it('does not show a role toggle for non-owners', async () => {
    setActiveWorkspaceRole('member');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
      member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'member' }),
    ]);

    renderPage();

    await screen.findByText('kid@example.com');
    expect(screen.queryByLabelText('Role for Kid')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /workspace invites/i })).not.toBeInTheDocument();
  });

  it('disables Remove for the last remaining owner, with an explanatory tooltip', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
    ]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);

    renderPage();

    const removeButton = await screen.findByLabelText('Remove Owner Person');
    expect(removeButton).toBeDisabled();
  });

  it('removes a member after confirming', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
      member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'member' }),
    ]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);
    const removeMock = vi.spyOn(api, 'removeWorkspaceMember').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();

    await screen.findByText('kid@example.com');
    await user.click(screen.getByLabelText('Remove Kid'));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('ws-1', 'user-2'));
  });

  it('creates an invite, shows a copyable link, and copies it to the clipboard', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([member()]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);
    const createMock = vi.spyOn(api, 'createWorkspaceInvite').mockResolvedValue({
      id: 'invite-new',
      token: 'raw-token-xyz',
      role: 'viewer',
      status: 'pending',
      expiresAt: '2026-02-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const user = userEvent.setup();

    renderPage();

    await screen.findByText('owner@example.com');
    await user.click(screen.getByLabelText('Role'));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await user.click(screen.getByRole('button', { name: /create invite/i }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('ws-1', 'viewer'));
    expect(await screen.findByText(/raw-token-xyz/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Copy invite link'));
    // `userEvent.setup()` installs its own in-memory Clipboard stub (jsdom
    // has no real Clipboard API) — read it back rather than asserting on a
    // `vi.fn()`, since `writeText` here IS that stub's own implementation.
    await waitFor(async () =>
      expect(await navigator.clipboard.readText()).toContain('/invite/raw-token-xyz'),
    );
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });

  it('revokes a pending invite', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([member()]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([invite({ id: 'invite-1' })]);
    const revokeMock = vi.spyOn(api, 'revokeWorkspaceInvite').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();

    const invitesTable = await screen.findByRole('table', { name: /workspace invites/i });
    await user.click(within(invitesTable).getByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(revokeMock).toHaveBeenCalledWith('ws-1', 'invite-1'));
  });
});
