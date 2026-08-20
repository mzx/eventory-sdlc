import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { ALLOW_PENDING_KEY, IS_PUBLIC_KEY } from '../auth/decorators';
import type { RequestWithUser } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RequestWithWorkspace, WORKSPACE_HEADER } from './workspace-context';

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
 *   workspace they joined) as the default. If they have NO membership at
 *   all, `request.workspace` is set to `null` rather than throwing here —
 *   some protected routes (e.g. the QR scan-landing lookup) don't need a
 *   resolved workspace at all; `@CurrentWorkspace()` is what turns a `null`
 *   into a 403 for the routes that DO need one (see its doc comment).
 *
 * Skipped entirely (mirrors `JwtAuthGuard`'s own carve-outs) for `@Public()`
 * routes, and resolves to `null` without a DB lookup for an `@AllowPending()`
 * route when the caller isn't `approved` yet (a pending user has no
 * workspace membership — see the EVT-39 migration's backfill, which only
 * grants memberships to already-`approved` users).
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

    const user = request.user;
    if (!user) {
      // Only reachable on an @AllowPending() route with no resolvable
      // session (e.g. GET /auth/me signed out) — JwtAuthGuard already threw
      // for every other route with no user by the time this guard runs.
      request.workspace = null;
      return true;
    }

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
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
    request.workspace = defaultMembership
      ? { id: defaultMembership.workspaceId, role: defaultMembership.role }
      : null;
    return true;
  }
}
