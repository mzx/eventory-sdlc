/**
 * Default-workspace resolution (EVT-39 — workspace schema foundation).
 *
 * This task is schema-only: every domain table now carries a non-null
 * `workspaceId` FK, but there is no per-request tenant context yet (that's
 * EVT-40's job). Every pre-existing row — and, until EVT-40 lands, every
 * newly created row — belongs to a single "Default Workspace" created by the
 * EVT-39 migration (`prisma/migrations/20260820020000_workspace_schema_foundation`).
 *
 * Most call sites need no change at all: every `workspaceId` column has a
 * schema-level `@default(...)` pointing at this same id, so a plain
 * `prisma.item.create({ data: { ... } })` with no `workspaceId` in the
 * payload still lands in the Default Workspace via the DB column default —
 * see the schema-header note in `prisma/schema.prisma` for the full
 * rationale (three places the literal below must stay in sync).
 *
 * The handful of call sites that DO need this module are the ones whose
 * `where` clause used to target a now-composite unique key (e.g.
 * `TagsService.upsertByName` used to do `where: { name }`; `Tag.name` is now
 * `@@unique([workspaceId, name])`, so the lookup needs an explicit
 * `workspaceId` to build the compound key) — those import
 * `getDefaultWorkspaceId` below rather than hand-rolling the literal.
 */

import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Fixed, well-known id of the single workspace the EVT-39 migration creates
 * and backfills every pre-existing row into. Kept in sync with:
 *   - every `workspaceId` field's `@default(...)` in `prisma/schema.prisma`
 *   - the `INSERT INTO "Workspace"` statement in the EVT-39 migration
 * If this literal is ever changed, update all three together.
 */
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Module-level cache (EVT-39 scope: a single process-wide cache is
 * sufficient — there is exactly one workspace until EVT-40 introduces
 * per-request tenant resolution, at which point this whole module is
 * replaced rather than extended).
 */
let cachedDefaultWorkspaceId: string | null = null;

/** Minimal shape this module needs from a Prisma client — real `PrismaService` satisfies it. */
type WorkspaceLookupClient = Pick<PrismaClient, 'workspace'>;

/**
 * Resolves the Default Workspace's id, doing a single DB round-trip the
 * first time it's called per process and reusing the cached result on every
 * subsequent call. Throws if the migration hasn't run (or the row was
 * somehow deleted) — that's a startup-time configuration error, not
 * something callers should silently paper over.
 */
export async function getDefaultWorkspaceId(prisma: WorkspaceLookupClient): Promise<string> {
  if (cachedDefaultWorkspaceId) {
    return cachedDefaultWorkspaceId;
  }
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: DEFAULT_WORKSPACE_ID },
    select: { id: true },
  });
  cachedDefaultWorkspaceId = workspace.id;
  return cachedDefaultWorkspaceId;
}

/** Builds the compound `Tag` unique-where for the Default Workspace. */
export async function defaultWorkspaceTagWhere(
  prisma: WorkspaceLookupClient,
  name: string,
): Promise<Prisma.TagWhereUniqueInput> {
  const workspaceId = await getDefaultWorkspaceId(prisma);
  return { workspaceId_name: { workspaceId, name } };
}

/** Test-only: resets the module-level cache between test runs. */
export function __resetDefaultWorkspaceCacheForTests(): void {
  cachedDefaultWorkspaceId = null;
}
