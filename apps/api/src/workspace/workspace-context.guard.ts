import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { ALLOW_PENDING_KEY, IS_PUBLIC_KEY } from '../auth/decorators';
import type { RequestWithUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import {
  ALLOW_MISSING_WORKSPACE_KEY,
  RequestWithWorkspace,
  WORKSPACE_HEADER,
} from './workspace-context';

/** Matches a well-formed UUID — cheap pre-check before hitting the DB with a header value. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Constant 403 message (EVT-40 round-2 review, security suggestion 7) — the
 * previous version interpolated the raw `X-Workspace-Id` header value back
 * into the response body. Never reflect caller-supplied input into an error
 * message; a fixed string carries the same information the caller needs
 * ("you're not in the workspace you asked for") without echoing anything
 * back.
 */
const NOT_A_MEMBER_MESSAGE = 'Not a member of the requested workspace';

/** 403 message for the "resolved no workspace at all" fail-closed path (EVT-42 round-2). */
const NO_WORKSPACE_MESSAGE = 'No workspace access';

/**
 * Global guard (registered as `APP_GUARD` in `AppModule`, AFTER `JwtAuthGuard`
 * so `request.user` is already populated) — resolves the caller's active
 * `Workspace` and attaches `{ id, role }` to `request.workspace` (EVT-40).
 *
 * Resolution:
 * - `X-Workspace-Id` header present: must be a workspace the caller is a
 *   member of, or this throws `ForbiddenException` (403) — a non-member
 *   header is always rejected, whether the workspace exists or not (never
 *   distinguishes "doesn't exist" from "not yours").
 * - Header absent: falls back to the caller's oldest membership (first
 *   workspace they joined) as the default.
 *
 * **FAIL CLOSED (EVT-42 round-2 security review, CRITICAL).** If NO
 * workspace resolves at all (zero memberships, no usable header) this guard
 * now THROWS `ForbiddenException` itself, before the handler ever runs —
 * UNLESS the route is `@AllowPending()` with a non-approved/absent caller
 * (unchanged — `request.workspace = null`, handled by the route itself,
 * e.g. `GET /api/auth/me`) or explicitly decorated `@AllowMissingWorkspace()`
 * (see that decorator's doc comment for the exhaustive list of routes that
 * legitimately need this).
 *
 * This closes a material gap the pre-fix version had: `request.workspace =
 * null; return true` let the request continue into the handler regardless,
 * so any controller module whose author forgot to declare
 * `@CurrentWorkspace()` on every route (as of this task, `LocationsController`,
 * `CategoriesController`, `ProjectsController`, `ShoppingListController` —
 * EVT-41's scope, not yet landed) was silently reachable, full stop, by a
 * zero-membership caller — including a throwaway Google account with no
 * allowlisting required, once EVT-42 made JwtAuthGuard stop blocking on
 * `status`. Failing closed at THIS guard, rather than relying on every
 * controller remembering `@CurrentWorkspace()`, permanently removes that bug
 * class regardless of what an individual route does or doesn't declare.
 *
 * Skipped entirely (mirrors `JwtAuthGuard`'s own carve-outs) for `@Public()`
 * routes.
 */
@Injectable()
export class WorkspaceContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser & RequestWithWorkspace>();

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const user = request.user;
    if (!user) {
      // Only reachable on an @AllowPending() route with no resolvable
      // session (e.g. GET /auth/me signed out) — JwtAuthGuard already threw
      // for every other route with no user by the time this guard runs.
      request.workspace = null;
      return true;
    }

    if (allowPending && user.status !== UserStatus.approved) {
      request.workspace = null;
      return true;
    }

    const headerRaw = request.headers[WORKSPACE_HEADER];
    const headerWorkspaceId = Array.isArray(headerRaw) ? headerRaw[0] : headerRaw;

    if (headerWorkspaceId) {
      if (!UUID_RE.test(headerWorkspaceId)) {
        throw new ForbiddenException(NOT_A_MEMBER_MESSAGE);
      }
      const membership = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: headerWorkspaceId, userId: user.id } },
        select: { workspaceId: true, role: true },
      });
      if (!membership) {
        throw new ForbiddenException(NOT_A_MEMBER_MESSAGE);
      }
      request.workspace = { id: membership.workspaceId, role: membership.role };
      return true;
    }

    const defaultMembership = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      select: { workspaceId: true, role: true },
    });
    if (defaultMembership) {
      request.workspace = { id: defaultMembership.workspaceId, role: defaultMembership.role };
      return true;
    }

    // No resolvable workspace at all. `@AllowPending()` routes never require
    // one (GET /auth/me must always resolve, regardless of workspace state)
    // — every other route fails closed unless explicitly opted out.
    request.workspace = null;
    if (allowPending) {
      return true;
    }
    const allowMissingWorkspace = this.reflector.getAllAndOverride<boolean>(
      ALLOW_MISSING_WORKSPACE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowMissingWorkspace) {
      return true;
    }
    throw new ForbiddenException(NO_WORKSPACE_MESSAGE);
  }
}
