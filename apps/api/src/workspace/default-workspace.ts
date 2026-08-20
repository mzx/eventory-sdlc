/**
 * Default-workspace resolution (EVT-39 — workspace schema foundation).
 *
 * Every domain table carries a non-null `workspaceId` FK, and every
 * pre-existing row (plus everything created before EVT-42 self-service
 * workspace creation shipped) belongs to a single "Default Workspace"
 * created by the EVT-39 migration
 * (`prisma/migrations/20260820020000_workspace_schema_foundation`).
 *
 * Most call sites need no change at all: every `workspaceId` column has a
 * schema-level `@default(...)` pointing at this same id, so a plain
 * `prisma.item.create({ data: { ... } })` with no `workspaceId` in the
 * payload still lands in the Default Workspace via the DB column default —
 * see the schema-header note in `prisma/schema.prisma` for the full
 * rationale (three places the literal below must stay in sync).
 *
 * The handful of call sites that DO need this module are the ones that need
 * the Default Workspace's id explicitly. As of EVT-45, the only remaining
 * caller of `getDefaultWorkspaceId` itself is the e2e test suite
 * (`test/e2e-auth-helper.ts`), which seeds a `WorkspaceMember` row against
 * `DEFAULT_WORKSPACE_ID` directly for legacy fixtures. This comment used to
 * cite `TagsService.upsertByName`'s composite-unique `where` clause as an
 * example caller — that's stale: `upsertByName` takes an explicit
 * `workspaceId` parameter (scoped to the caller's actual workspace) as of
 * the EVT-40 tenancy work, and never reaches into this module at all.
 *
 * EVT-40 introduced a runtime self-heal, `ensureDefaultWorkspaceMembership`,
 * that auto-granted an approved-but-membership-less user a Default Workspace
 * membership. EVT-42 REMOVES it (binding carry-over from the EVT-40 round-3
 * security review): now that self-service workspace creation and invite
 * redemption exist (`WorkspacesService`), a zero-membership user is expected
 * to explicitly create or redeem, not be silently defaulted into the legacy
 * Default Workspace — and the self-heal's own safety gate ("only heal a user
 * with ZERO memberships anywhere") would otherwise resurrect a deliberate
 * EVT-42 membership revocation the moment the revoked user next logs in and
 * still holds no other membership.
 */

import { PrismaClient, UserRole, WorkspaceRole } from '@prisma/client';

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

/**
 * Maps a global `UserRole` to the `WorkspaceRole` a user should default to
 * in the Default Workspace — mirrors the EVT-39 migration's backfill:
 * `admin` -> `owner`, everyone else -> `member`. Still used by test fixtures
 * (`test/e2e-auth-helper.ts`) that seed a Default Workspace membership
 * directly; the runtime self-heal that used to call this
 * (`ensureDefaultWorkspaceMembership`) was removed in EVT-42 — see this
 * module's doc comment.
 */
export function defaultWorkspaceRoleForUserRole(role: UserRole): WorkspaceRole {
  return role === UserRole.admin ? WorkspaceRole.owner : WorkspaceRole.member;
}

/** Test-only: resets the module-level cache between test runs. */
export function __resetDefaultWorkspaceCacheForTests(): void {
  cachedDefaultWorkspaceId = null;
}
