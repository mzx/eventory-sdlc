import type { QueryClient } from '@tanstack/react-query';
import { expect } from 'vitest';
import { WORKSPACES_QUERY_KEY } from '../workspace/useActiveWorkspace';

/**
 * Asserts that EVERY query currently cached on `queryClient` was built
 * through `wsKey` (see `lib/queryKeys.ts`) for the given workspace — i.e.
 * `key[0] === 'ws'` and `key[1] === workspaceId` — rather than a bare array
 * literal that would leak one workspace's cached data into another's UI
 * after a switch (EVT-43 AC1). `WORKSPACES_QUERY_KEY` (`['workspaces',
 * 'mine']`) is the one documented exception — it's the query that DISCOVERS
 * which workspaces exist in the first place, so it's deliberately NOT
 * workspace-scoped (see `useMyWorkspaces`'s own doc comment) — any page that
 * mounts `useMyWorkspaces()` (e.g. EVT-47's rename/delete affordances on
 * `MembersSettingsPage`) legitimately has this one unscoped entry alongside
 * its `wsKey`-scoped ones.
 *
 * Extracted from `ItemsPage.test.tsx` (round-2 review, suggestion 10) so
 * other pages can assert the same structural guarantee cheaply instead of
 * re-deriving the `getQueryCache().getAll()` walk per page.
 */
export function expectAllQueryKeysScopedToWorkspace(
  queryClient: QueryClient,
  workspaceId: string,
): void {
  const keys = queryClient
    .getQueryCache()
    .getAll()
    .map((q) => q.queryKey);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    if (key[0] === WORKSPACES_QUERY_KEY[0] && key[1] === WORKSPACES_QUERY_KEY[1]) {
      continue;
    }
    expect(key[0]).toBe('ws');
    expect(key[1]).toBe(workspaceId);
  }
}
