// Active-workspace resolution + read hooks (EVT-43).
//
// Deliberately NOT a React Context/Provider: `useMyWorkspaces` below is a
// thin `useQuery` wrapper that self-heals the active selection (auto-picks a
// workspace once the list resolves, falls back when the persisted id is
// stale/foreign) as a side effect, and TanStack Query's own cache is the
// "shared state" — every caller of `useMyWorkspaces()` (the app shell, the
// switcher, onboarding, members settings) shares the identical
// `WORKSPACES_QUERY_KEY` cache entry, so no provider tree is needed to keep
// them in sync. `useActiveWorkspaceId`/`useActiveWorkspaceRole` read the
// resolved selection via `useSyncExternalStore` against plain module-level
// stores (the id lives in `api.ts`, next to the header-injection logic that
// needs it; role lives here, UI-only, never sent to the server) — this is
// why individual pages/tests don't need to wrap in any provider: they just
// call `setActiveWorkspaceId('ws-1')` (a page-level test fixture) or render
// under a tree that also mounts `useMyWorkspaces()` once (the app shell).
import { useEffect, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  fetchWorkspaces,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  setWorkspaceContextInvalidatedListener,
  subscribeActiveWorkspaceId,
  type WorkspaceRole,
  type WorkspaceSummary,
} from '../api';

/** Not workspace-scoped itself — this IS the query used to discover which workspaces exist. */
export const WORKSPACES_QUERY_KEY = ['workspaces', 'mine'] as const;

/** React-facing read side of `api.ts`'s active-workspace-id store. */
export function useActiveWorkspaceId(): string | null {
  return useSyncExternalStore(subscribeActiveWorkspaceId, getActiveWorkspaceId);
}

// ---------------------------------------------------------------------------
// active workspace role — UI-only (never sent to the server; the server
// re-derives the caller's role from WorkspaceMember on every request). Kept
// as its own lightweight store, parallel to api.ts's id store, so pages can
// gate mutating affordances (EVT-43 "viewer-aware UI" goal) without needing
// a context provider either.
// ---------------------------------------------------------------------------

let activeWorkspaceRole: WorkspaceRole | null = null;
const activeWorkspaceRoleListeners = new Set<() => void>();

export function getActiveWorkspaceRole(): WorkspaceRole | null {
  return activeWorkspaceRole;
}

export function setActiveWorkspaceRole(role: WorkspaceRole | null): void {
  if (activeWorkspaceRole === role) return;
  activeWorkspaceRole = role;
  for (const listener of activeWorkspaceRoleListeners) listener();
}

export function subscribeActiveWorkspaceRole(listener: () => void): () => void {
  activeWorkspaceRoleListeners.add(listener);
  return () => activeWorkspaceRoleListeners.delete(listener);
}

export function useActiveWorkspaceRole(): WorkspaceRole | null {
  return useSyncExternalStore(subscribeActiveWorkspaceRole, getActiveWorkspaceRole);
}

/** `true` only once the role has resolved to `viewer` — `null` (not yet resolved) is never treated as read-only. */
export function useIsViewer(): boolean {
  return useActiveWorkspaceRole() === 'viewer';
}

/** Consistent hint text for every hidden/disabled viewer-facing mutating affordance (EVT-43 AC6). */
export const READ_ONLY_HINT = 'Read-only access — ask a workspace owner to change your role.';

/**
 * `GET /api/workspaces` + self-healing active-selection sync. Call this
 * anywhere the current workspace list and/or the active id/role need to be
 * current — every call site shares the same cache entry and this effect is
 * idempotent (the setters below no-op when the value is already correct), so
 * mounting it in multiple components at once is safe and cheap.
 */
export function useMyWorkspaces(): UseQueryResult<WorkspaceSummary[]> {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: WORKSPACES_QUERY_KEY, queryFn: fetchWorkspaces });
  const activeId = useActiveWorkspaceId();

  // Round-2 review, MAJOR 1: `api.ts`'s `selfHealStaleWorkspaceHeader`
  // clears a stale/foreign `X-Workspace-Id` (and notifies this listener) the
  // moment ANY request 403s specifically because of it — e.g. a member who
  // was just removed from the workspace they were sitting in. Invalidating
  // here forces a fresh `GET /api/workspaces` (which never sends the header
  // at all — see `fetchWorkspaces`'s doc comment — so it always succeeds
  // regardless of the id that was just cleared); the effect below then picks
  // a still-valid fallback membership from the refreshed list. Registered
  // unconditionally on every mount — idempotent, since the id only actually
  // changes when the effect below finds a real mismatch — so mounting
  // `useMyWorkspaces()` from multiple components at once (app shell +
  // switcher + members settings, per the module doc comment above) is safe.
  useEffect(() => {
    setWorkspaceContextInvalidatedListener(() => {
      void queryClient.invalidateQueries({ queryKey: WORKSPACES_QUERY_KEY });
    });
    return () => setWorkspaceContextInvalidatedListener(null);
  }, [queryClient]);

  useEffect(() => {
    if (!query.data) return;
    const current = query.data.find((w) => w.id === activeId);
    if (current) {
      setActiveWorkspaceRole(current.role);
      return;
    }
    // No selection yet, or a stale/foreign id (e.g. a different account
    // signed in on the same browser previously) — fall back to the oldest
    // membership, matching the API's own default-workspace resolution order
    // (see apps/api WorkspaceContextGuard).
    const fallback = query.data[0] ?? null;
    setActiveWorkspaceId(fallback?.id ?? null);
    setActiveWorkspaceRole(fallback?.role ?? null);
  }, [query.data, activeId]);

  return query;
}

// ---------------------------------------------------------------------------
// pending invite token (EVT-43 AC4 "redemption route works end-to-end") —
// survives the Google OAuth full-page round trip, which always lands back on
// `/` regardless of which path the sign-in was kicked off from (see apps/api
// AuthController.googleCallback's doc comment). `LoginPage` stashes the
// token here when a signed-out visitor lands on `/invite/:token`; `AppShell`
// picks it back up once signed in and client-side-navigates to
// `/invite/:token` to resume redemption.
// ---------------------------------------------------------------------------

const PENDING_INVITE_STORAGE_KEY = 'eventory:pendingInviteToken';

export function getPendingInviteToken(): string | null {
  try {
    return sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setPendingInviteToken(token: string): void {
  try {
    sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, token);
  } catch {
    // ignore — worst case the invite has to be re-followed after sign-in
  }
}

export function clearPendingInviteToken(): void {
  try {
    sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // ignore
  }
}
