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
 * The handful of call sites that DO need this module are the ones that need
 * the Default Workspace's id explicitly — e.g. `ensureDefaultWorkspaceMembership`
 * below, granted on user approval/promotion since EVT-40's global
 * `WorkspaceContextGuard` requires a resolvable membership.
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
 * `admin` -> `owner`, everyone else -> `member`. Shared by every call site
 * that grants Default Workspace membership (`ensureDefaultWorkspaceMembership`
 * callers in `AuthService` and `UsersService`).
 */
export function defaultWorkspaceRoleForUserRole(role: UserRole): WorkspaceRole {
  return role === UserRole.admin ? WorkspaceRole.owner : WorkspaceRole.member;
}

/** Minimal shape {@link ensureDefaultWorkspaceMembership} needs from a Prisma client. */
type MembershipClient = WorkspaceLookupClient & Pick<PrismaClient, 'workspaceMember'>;

/**
 * Grants `userId` a `WorkspaceMember` row in the Default Workspace,
 * idempotently (a no-op if they already have one) — EVT-40's
 * `WorkspaceContextGuard` is global, so an `approved` user with ZERO
 * workspace memberships is locked out of every tenant-scoped route
 * (items/photos/QR). Full membership management (inviting a user to a
 * SPECIFIC, non-default workspace) is EVT-42's job; this narrower helper
 * only keeps the pre-EVT-40, single-household-workspace deployment target
 * working without that machinery existing yet. Every code path that makes a
 * user `approved` calls this:
 *   - `UsersService.updateStatus` (an admin approving a pending user)
 *   - `AuthService.upsertFromGoogleProfile`'s three auto-promotion branches
 *     (first-ever sign-in, and the `EVENTORY_ADMIN_EMAILS` allowlist)
 */
export async function ensureDefaultWorkspaceMembership(
  prisma: MembershipClient,
  userId: string,
  role: WorkspaceRole,
): Promise<void> {
  const workspaceId = await getDefaultWorkspaceId(prisma);
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    update: {},
    create: { workspaceId, userId, role },
  });
}

/** Test-only: resets the module-level cache between test runs. */
export function __resetDefaultWorkspaceCacheForTests(): void {
  cachedDefaultWorkspaceId = null;
}
