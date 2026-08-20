import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api';
import {
  clearPendingInviteToken,
  getActiveWorkspaceRole,
  getPendingInviteToken,
  READ_ONLY_HINT,
  setPendingInviteToken,
  useActiveWorkspaceId,
  useActiveWorkspaceRole,
  useIsViewer,
  useMyWorkspaces,
} from './useActiveWorkspace';

function workspace(overrides: Partial<api.WorkspaceSummary> = {}): api.WorkspaceSummary {
  return {
    id: 'ws-1',
    name: 'Home',
    role: 'owner',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Renders a probe that surfaces every hook under test as plain text, so assertions stay black-box. */
function Probe() {
  const workspaceId = useActiveWorkspaceId();
  const role = useActiveWorkspaceRole();
  const isViewer = useIsViewer();
  const query = useMyWorkspaces();
  return (
    <div>
      <div data-testid="workspace-id">{workspaceId ?? 'none'}</div>
      <div data-testid="role">{role ?? 'none'}</div>
      <div data-testid="is-viewer">{String(isViewer)}</div>
      <div data-testid="count">{query.data?.length ?? 'loading'}</div>
    </div>
  );
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useMyWorkspaces (EVT-43)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('auto-selects the first (oldest) membership when nothing is active yet', async () => {
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([
      workspace({ id: 'ws-1', role: 'owner' }),
      workspace({ id: 'ws-2', name: 'Garage', role: 'member' }),
    ]);

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-1'));
    expect(screen.getByTestId('role')).toHaveTextContent('owner');
    expect(screen.getByTestId('is-viewer')).toHaveTextContent('false');
  });

  it('falls back to the first membership when the persisted id is stale/foreign', async () => {
    api.setActiveWorkspaceId('some-other-account-ws');
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([workspace({ id: 'ws-1' })]);

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-1'));
  });

  it('keeps the persisted selection when it is still a valid membership, and resolves its role', async () => {
    api.setActiveWorkspaceId('ws-2');
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([
      workspace({ id: 'ws-1', role: 'owner' }),
      workspace({ id: 'ws-2', name: 'Garage', role: 'viewer' }),
    ]);

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('role')).toHaveTextContent('viewer'));
    expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-2');
    expect(screen.getByTestId('is-viewer')).toHaveTextContent('true');
  });

  it('clears the active selection when the caller has zero workspaces', async () => {
    api.setActiveWorkspaceId('ws-1');
    vi.spyOn(api, 'fetchWorkspaces').mockResolvedValue([]);

    renderProbe();

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('0'));
    expect(screen.getByTestId('workspace-id')).toHaveTextContent('none');
    expect(getActiveWorkspaceRole()).toBeNull();
  });
});

describe('pending invite token helpers (EVT-43 AC4)', () => {
  afterEach(() => {
    clearPendingInviteToken();
  });

  it('round-trips through sessionStorage', () => {
    expect(getPendingInviteToken()).toBeNull();
    setPendingInviteToken('raw-token-abc');
    expect(getPendingInviteToken()).toBe('raw-token-abc');
    clearPendingInviteToken();
    expect(getPendingInviteToken()).toBeNull();
  });
});

describe('READ_ONLY_HINT', () => {
  it('is non-empty, human-readable copy shared by every viewer-gated affordance', () => {
    expect(READ_ONLY_HINT.length).toBeGreaterThan(10);
  });
});
