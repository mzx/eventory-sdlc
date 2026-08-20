/**
 * Per-request tenant context (EVT-40).
 *
 * `WorkspaceContextGuard` (registered globally, alongside `JwtAuthGuard`)
 * resolves the caller's active workspace membership and attaches it to
 * `request.workspace`; `@CurrentWorkspace()` below is the read side, mirroring
 * `@CurrentUser()`'s `request.user` pattern in `auth/decorators.ts`.
 */

import { createParamDecorator, ExecutionContext, ForbiddenException } from '@nestjs/common';
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
   * - `null` — the guard ran but found no resolvable workspace: no
   *   `X-Workspace-Id` header AND the caller has zero memberships (or the
   *   route is `@AllowPending()` and the caller isn't `approved` yet).
   * - `WorkspaceContext` — resolved membership (from the header or the
   *   caller's first/default membership).
   */
  workspace?: WorkspaceContext | null;
};

/**
 * Pulls the resolved `WorkspaceContext` off the request.
 *
 * Throws `ForbiddenException` when `request.workspace` is `null` (guard ran,
 * found nothing) — this is what turns "no workspace access" into a 403 for
 * every handler that declares this param, without each handler needing its
 * own `if (!workspace)` check. A handler that legitimately doesn't need a
 * resolved workspace (e.g. the QR scan-landing lookup, which authorizes
 * against the SCANNED resource's own workspace rather than the caller's
 * current context — see `ItemsService.findByQr`) simply omits this
 * decorator and reads `@CurrentUser()` instead.
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
