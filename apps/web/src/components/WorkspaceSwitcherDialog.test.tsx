import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import { setActiveWorkspaceId } from '../api';
import { WorkspaceSwitcherDialog } from './WorkspaceSwitcherDialog';

function ws(overrides: Partial<api.WorkspaceSummary> = {}): api.WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Home',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderDialog(activeWorkspaceId: string | null = 'ws-1') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  return {
    onClose,
    ...render(
      <QueryClientProvider client={queryClient}>
        <WorkspaceSwitcherDialog open onClose={onClose} activeWorkspaceId={activeWorkspaceId} />
      </QueryClientProvider>,
    ),
  };
}

describe('WorkspaceSwitcherDialog (EVT-43 AC3)', () => {
  beforeEach(() => {
    setActiveWorkspaceId('ws-1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists every workspace the caller belongs to, with the active one marked selected', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([
      ws({ id: 'ws-1', name: 'Home', role: 'owner' }),
      ws({ id: 'ws-2', name: 'Garage', role: 'member' }),
    ]);

    renderDialog('ws-1');

    await screen.findByText('Home');
    const list = screen.getByRole('list', { name: /my workspaces/i });
    expect(within(list).getByText('Home')).toBeInTheDocument();
    expect(within(list).getByText('Garage')).toBeInTheDocument();
  });

  it('switching sets the active workspace id and closes', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([
      ws({ id: 'ws-1', name: 'Home' }),
      ws({ id: 'ws-2', name: 'Garage' }),
    ]);
    const user = userEvent.setup();

    const { onClose } = renderDialog('ws-1');

    await user.click(await screen.findByText('Garage'));

    expect(api.getActiveWorkspaceId()).toBe('ws-2');
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a workspace, switches to it, and closes', async () => {
    const created = ws({ id: 'ws-new', name: 'New Household', role: 'owner' });
    vi.spyOn(api, 'fetchWorkspaces')
      .mockResolvedValueOnce([ws({ id: 'ws-1', name: 'Home' })])
      .mockResolvedValue([ws({ id: 'ws-1', name: 'Home' }), created]);
    const createMock = vi.spyOn(api, 'createWorkspace').mockResolvedValue(created);
    const user = userEvent.setup();

    const { onClose } = renderDialog('ws-1');

    await screen.findByText('Home');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    await user.type(screen.getByLabelText('Workspace name'), 'New Household');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(createMock).toHaveBeenCalledWith('New Household'));
    await waitFor(() => expect(api.getActiveWorkspaceId()).toBe('ws-new'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an error and stays open when creation fails', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([ws({ id: 'ws-1', name: 'Home' })]);
    vi.spyOn(api, 'createWorkspace').mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();

    renderDialog('ws-1');

    await screen.findByText('Home');
    await user.click(screen.getByRole('button', { name: /create workspace/i }));
    await user.type(screen.getByLabelText('Workspace name'), 'New Household');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('boom')).toBeInTheDocument();
  });
});
