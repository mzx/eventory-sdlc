/**
 * Per-request tenant context (EVT-40).
 *
 * `WorkspaceContextGuard` (registered globally, alongside `JwtAuthGuard`)
 * resolves the caller's active workspace membership and attaches it to
 * `request.workspace`; `@CurrentWorkspace()` below is the read side, mirroring
 * `@CurrentUser()`'s `request.user` pattern in `auth/decorators.ts`.
 */

import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import type { WorkspaceRole } from '@prisma/client';
import type { Request } from 'express';

/** The resolved tenant context for the current request. */
export interface WorkspaceContext {
  /** The active `Workspace.id`. */
  id: string;
  /** The caller's `WorkspaceMember.role` within that workspace. */
  role: WorkspaceRole;
}

/** Header a caller sends to select a non-default workspace (see the guard's doc comment). */
export const WORKSPACE_HEADER = 'x-workspace-id';

export type RequestWithWorkspace = Omit<Request, 'workspace'> & {
  /**
   * Populated by `WorkspaceContextGuard`:
   * - `undefined` — the guard did not run at all (the route is `@Public()`).
   * - `null` — the guard ran but found no resolvable workspace, AND the
   *   route opted out of the default fail-closed requirement (`@AllowPending()`
   *   with a non-approved/absent caller, or `@AllowMissingWorkspace()`).
   * - `WorkspaceContext` — resolved membership (from the header or the
   *   caller's first/default membership).
   *
   * EVT-42 round-2 security review (CRITICAL): every OTHER route now gets a
   * 403 straight from the guard when no workspace resolves, rather than
   * reaching the handler with `request.workspace === null` — see
   * `WorkspaceContextGuard`'s doc comment.
   */
  workspace?: WorkspaceContext | null;
};

/**
 * Pulls the resolved `WorkspaceContext` off the request.
 *
 * `request.workspace` is only ever `null` here on a route that opted out of
 * workspace resolution (`@AllowPending()`/`@AllowMissingWorkspace()`) and
 * ALSO declares this decorator — a contradiction that just means "no
 * workspace access" for that request, same as before. Every other route
 * that reaches its handler is guaranteed to already have a resolved
 * `request.workspace` (the guard itself now throws otherwise).
 */
export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const request = ctx.switchToHttp().getRequest<RequestWithWorkspace>();
    if (!request.workspace) {
      throw new ForbiddenException('No workspace access');
    }
    return request.workspace;
  },
);

// ---------------------------------------------------------------------------
// @AllowMissingWorkspace() — EVT-42 round-2 security review, CRITICAL
// ---------------------------------------------------------------------------

export const ALLOW_MISSING_WORKSPACE_KEY = 'eventory:allowMissingWorkspace';

/**
 * Opts a route (or controller) OUT of `WorkspaceContextGuard`'s default
 * fail-closed behavior: normally, resolving no workspace (zero memberships,
 * and no/mismatched `X-Workspace-Id` header) throws `ForbiddenException`
 * straight from the guard, before the handler ever runs. This decorator is
 * for the small, explicit set of routes that legitimately serve a caller
 * with no workspace at all:
 *   - `POST /api/workspaces` / `GET /api/workspaces` (`WorkspacesController`
 *     create/listMine) — a zero-membership user must be able to create or
 *     see their (empty) workspace list.
 *   - `POST /api/invites/redeem` (`InvitesController`) — a zero-membership
 *     invitee must be able to redeem their very first invite.
 *   - `GET /api/items/by-qr/:qr` (`ItemsController.findByQr`) — authorizes
 *     against the SCANNED resource's own workspace, not the caller's
 *     ambient context; a zero-membership caller must still get the same
 *     neutral 404 as an unknown token, not a 403 that reveals they have no
 *     workspace at all.
 *   - `UsersController` (class-level, EVT-14 instance-admin management —
 *     `GET /api/users`, `PATCH /api/users/:id/status`/`:id/role`) — entirely
 *     orthogonal to `Workspace` membership; an admin managing OTHER users'
 *     approval status must not themselves need to belong to a workspace
 *     (e.g. the very first admin, before they've created one). Added after
 *     an e2e regression surfaced this the round this decorator was
 *     introduced — a reminder that this list needs auditing whenever a NEW
 *     controller is added, not just trusted to be complete by inspection.
 *
 * `GET /api/auth/me` does NOT need this — it's already `@AllowPending()`,
 * which the guard treats as "never require a workspace" independent of this
 * decorator (see the guard's doc comment).
 *
 * A route decorated with this (and, unusually, ALSO reading
 * `@CurrentWorkspace()`) still gets a 403 from that decorator when no
 * workspace resolved — this only controls whether the GUARD itself throws
 * before the handler runs, not `@CurrentWorkspace()`'s own null-check.
 */
export const AllowMissingWorkspace = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_MISSING_WORKSPACE_KEY, true);
