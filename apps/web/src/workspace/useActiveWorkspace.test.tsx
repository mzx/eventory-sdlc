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

  // Round-2 review, MAJOR 1: previously, a removed member's `X-Workspace-Id`
  // header was sent on `GET /api/workspaces` itself, 403ing the ONE request
  // that could have told them their membership changed — a silent,
  // unrecoverable lockout. `fetchWorkspaces` no longer sends the header at
  // all (see api.ts), so the list keeps loading regardless of what's
  // persisted; this test additionally exercises the full recovery loop —
  // some OTHER request 403s on the now-stale id, which self-heals (clears
  // the id, invalidates the cached list) and this hook's own fallback effect
  // then lands on a still-valid membership from the refreshed list.
  it('removed-member recovery: a workspace-context 403 on another request clears the stale id and re-resolves from a refreshed workspaces list', async () => {
    api.setActiveWorkspaceId('removed-ws');
    const fetchWorkspacesMock = vi
      .spyOn(api, 'fetchWorkspaces')
      .mockResolvedValueOnce([workspace({ id: 'ws-1', role: 'owner' })])
      .mockResolvedValueOnce([workspace({ id: 'ws-2', name: 'Garage', role: 'member' })]);

    renderProbe();

    // The list loads successfully despite the stale/foreign persisted id
    // (the header is never sent on this call) and the existing fallback
    // effect already picks a valid membership from it.
    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-1'));

    // Some other request 403s because `removed-ws` — the id `fetchWorkspaces`
    // never actually validated — is rejected by every OTHER endpoint's
    // `WorkspaceContextGuard` check. Simulated directly against `fetchItems`
    // rather than through a page, to isolate the self-heal wiring itself.
    api.setActiveWorkspaceId('removed-ws');
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 403,
          message: 'Not a member of the requested workspace',
          error: 'Forbidden',
        }),
        { status: 403 },
      ),
    );
    await expect(api.fetchItems()).rejects.toThrow();

    // Self-heal cleared the id and invalidated the cached list; this hook's
    // fallback effect then lands on the refreshed list's own membership.
    await waitFor(() => expect(fetchWorkspacesMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-2'));
  });

  // Test reviewer's ask (EVT-43 review, convergent MAJOR): `useMyWorkspaces()`
  // is mounted by multiple components at once in the real app (app shell,
  // switcher, onboarding, members settings). The previous implementation
  // registered its self-heal listener in a single nullable module slot, so
  // ANY one consumer unmounting — e.g. `InviteRedeemPage` after redeem,
  // `OnboardingPage` after its first workspace, or `AppShell` navigating to
  // the sibling-routed print pages `/items/:id/print` and
  // `/projects/:id/pick-list` — nulled the listener out from under every
  // OTHER still-mounted consumer, silently disabling the self-heal for the
  // rest of the session (a workspace-context 403 would then clear the
  // stored id but never invalidate the cached list, so the fallback effect
  // re-selected the very membership the server just rejected — an
  // id-flapping 403 loop only a reload broke).
  //
  // Reproduces that scenario directly: a transient consumer and a surviving
  // consumer both mount `useMyWorkspaces()` against the same `QueryClient`;
  // the transient one unmounts (standing in for a page navigating away)
  // while the surviving one (standing in for the app shell) stays mounted.
  // A subsequent workspace-context 403 must still self-heal through the
  // survivor's own listener. Fails on the old single-slot implementation —
  // the transient consumer's unmount-cleanup would null the shared slot
  // regardless of which listener was "current", silently disabling the
  // survivor's self-heal too.
  it('a still-mounted consumer keeps self-healing after another useMyWorkspaces() consumer unmounts (partial-unmount regression)', async () => {
    const fetchWorkspacesMock = vi
      .spyOn(api, 'fetchWorkspaces')
      .mockResolvedValueOnce([workspace({ id: 'ws-1', role: 'owner' })])
      .mockResolvedValueOnce([workspace({ id: 'ws-2', name: 'Garage', role: 'member' })]);
    api.setActiveWorkspaceId('removed-ws');

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function TransientConsumer() {
      useMyWorkspaces();
      return null;
    }

    function Shell({ mountTransient }: { mountTransient: boolean }) {
      return (
        <QueryClientProvider client={queryClient}>
          {mountTransient && <TransientConsumer />}
          <Probe />
        </QueryClientProvider>
      );
    }

    const { rerender } = render(<Shell mountTransient />);

    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-1'));

    // Only the transient consumer unmounts — `Probe` (the surviving
    // component instance, standing in for the app shell) stays mounted.
    rerender(<Shell mountTransient={false} />);

    api.setActiveWorkspaceId('removed-ws');
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          statusCode: 403,
          message: 'Not a member of the requested workspace',
          error: 'Forbidden',
        }),
        { status: 403 },
      ),
    );
    await expect(api.fetchItems()).rejects.toThrow();

    await waitFor(() => expect(fetchWorkspacesMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('workspace-id')).toHaveTextContent('ws-2'));
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
