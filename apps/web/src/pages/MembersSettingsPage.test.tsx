import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { expectAllQueryKeysScopedToWorkspace } from '../test/queryKeyAssertions';
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

function workspace(overrides: Partial<api.WorkspaceSummary> = {}): api.WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Home',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <MembersSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

describe('MembersSettingsPage (EVT-43 AC5)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
    // `useMyWorkspaces()` (EVT-47 — backs the rename form + delete
    // confirmation) always fires; every test needs SOME resolved list so it
    // doesn't hang on a real, unmocked `fetch`. Tests specifically about
    // rename/delete override this with their own workspace fixture.
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace()]);
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

  // Round-2 review, suggestion 10 — same structural guard as ItemsPage's
  // AC1 test, extracted to `test/queryKeyAssertions.ts` so it's cheap to
  // apply here too.
  it('AC1: every cached query key carries the active workspace id', async () => {
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([member()]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);

    const { queryClient } = renderPage();
    await screen.findByRole('table', { name: /workspace members/i });

    expectAllQueryKeysScopedToWorkspace(queryClient, 'ws-1');
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
    // `useMyWorkspaces()` (EVT-47) re-syncs the active role from the fetched
    // workspace list once it resolves — must agree with the explicit
    // `setActiveWorkspaceRole` above, or its own effect would clobber it
    // back to the `beforeEach` default (`owner`) partway through the test.
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ role: 'member' })]);
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([
      member({ userId: 'user-1', role: 'owner' }),
      member({ userId: 'user-2', name: 'Kid', email: 'kid@example.com', role: 'member' }),
    ]);

    renderPage();

    await screen.findByText('kid@example.com');
    expect(screen.queryByLabelText('Role for Kid')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /workspace invites/i })).not.toBeInTheDocument();
    // EVT-47 AC1: the rename/delete affordances are owner-only, same as
    // invites — the server independently 403s a non-owner attempt either
    // way, but a non-owner shouldn't even see the buttons.
    expect(screen.queryByLabelText('Workspace name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete workspace/i })).not.toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// Rename + delete (EVT-47)
// ---------------------------------------------------------------------------

describe('MembersSettingsPage — workspace rename (EVT-47 AC1)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([member()]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the current name and saves a rename, invalidating the shared workspaces cache', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ name: 'Home' })]);
    const renameMock = vi
      .spyOn(api, 'renameWorkspace')
      .mockResolvedValue(workspace({ name: 'The Garage' }));
    const user = userEvent.setup();

    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const nameField = await screen.findByLabelText('Workspace name');
    expect(nameField).toHaveValue('Home');

    await user.clear(nameField);
    await user.type(nameField, 'The Garage');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(renameMock).toHaveBeenCalledWith('ws-1', 'The Garage'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['workspaces', 'mine'] }),
      ),
    );
  });

  it('disables Save until the name actually changes', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ name: 'Home' })]);

    renderPage();

    await screen.findByLabelText('Workspace name');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a server error (e.g. attempting to rename to a blank name) without crashing', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ name: 'Home' })]);
    vi.spyOn(api, 'renameWorkspace').mockRejectedValue(new Error('Request failed with status 400'));
    const user = userEvent.setup();

    renderPage();

    const nameField = await screen.findByLabelText('Workspace name');
    await user.clear(nameField);
    await user.type(nameField, 'New Name');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Request failed with status 400')).toBeInTheDocument();
  });
});

describe('MembersSettingsPage — workspace delete (EVT-47 AC2/AC4/AC5/AC6)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceRole('owner');
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ name: 'The Garage' })]);
    vi.spyOn(api, 'fetchWorkspaceMembers').mockResolvedValue([member()]);
    vi.spyOn(api, 'fetchWorkspaceInvites').mockResolvedValue([]);
    vi.spyOn(api, 'fetchItems').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openDeleteDialog(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByLabelText('Workspace name');
    await user.click(screen.getByRole('button', { name: /delete workspace/i }));
    return screen.findByRole('dialog');
  }

  it('AC5: the destructive button stays disabled until the workspace name is typed exactly', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    const confirmButton = within(dialog).getByRole('button', { name: /delete forever/i });
    expect(confirmButton).toBeDisabled();

    const confirmField = within(dialog).getByLabelText('Confirm workspace name');
    await user.type(confirmField, 'wrong name');
    expect(confirmButton).toBeDisabled();

    await user.clear(confirmField);
    await user.type(confirmField, 'The Garage');
    expect(confirmButton).toBeEnabled();
  });

  it('AC5: Cancel is the default-focused action', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('AC5: shows an approximate item count once fetched', async () => {
    vi.spyOn(api, 'fetchItems').mockResolvedValue([
      { id: 'item-1' } as api.ItemListRow,
      { id: 'item-2' } as api.ItemListRow,
    ]);
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    expect(await within(dialog).findByText(/approximately 2 item/i)).toBeInTheDocument();
  });

  it('AC2/AC6: deletes the workspace, invalidates the cache, and closes the dialog', async () => {
    const deleteMock = vi.spyOn(api, 'deleteWorkspace').mockResolvedValue(undefined);
    const user = userEvent.setup();

    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText('Confirm workspace name'), 'The Garage');
    await user.click(within(dialog).getByRole('button', { name: /delete forever/i }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('ws-1'));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ['workspaces', 'mine'] }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('AC4: surfaces the server refusal (409, Default Workspace) as a clear in-dialog error', async () => {
    vi.spyOn(api, 'deleteWorkspace').mockRejectedValue(
      new Error('Request to /workspaces/ws-1 failed with status 409'),
    );
    const user = userEvent.setup();
    renderPage();

    const dialog = await openDeleteDialog(user);
    await user.type(within(dialog).getByLabelText('Confirm workspace name'), 'The Garage');
    await user.click(within(dialog).getByRole('button', { name: /delete forever/i }));

    expect(await within(dialog).findByText(/failed with status 409/)).toBeInTheDocument();
    // The dialog stays open — nothing was destroyed, the owner can read the
    // error and back out.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
