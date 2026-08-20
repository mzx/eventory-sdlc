/**
 * Shared TanStack Query key factory (EVT-43 AC1).
 *
 * Every workspace-scoped `useQuery`/`invalidateQueries` call in the app MUST
 * build its key through `wsKey` rather than a bare array literal. Switching
 * the active workspace (EVT-43 goal) must swap EVERY visible query's data —
 * react-query dedupes/caches/invalidates by treating `queryKey` as an
 * ordered array and matching prefixes positionally, so simply hashing
 * differently isn't enough: the workspace id has to be baked into the key
 * array itself, or a query fired while workspace A is active can still
 * satisfy (and therefore render stale data for) the identical-looking query
 * once workspace B becomes active.
 *
 * `workspaceId` is deliberately the leading segment (not the queryFn's own
 * concern) — this is what lets `wsKey(workspaceId)` alone invalidate every
 * cached query for a workspace at once (e.g. on leaving/removal), and what
 * the EVT-43 risk note's "a missed key leaks one workspace's cache into
 * another's UI" guard rail (see `useActiveWorkspace.test.ts`) checks for.
 */
export function wsKey(
  workspaceId: string | null,
  ...parts: readonly unknown[]
): readonly unknown[] {
  return ['ws', workspaceId, ...parts];
}
