import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';

/**
 * Full Prisma `User` row attached to `request.user` by `JwtAuthGuard` once a
 * valid session cookie resolves to a DB row. `null`/`undefined` on routes
 * marked `@AllowPending()` when no valid cookie was presented (e.g. `GET
 * /api/auth/me` when signed out) — every other route either has a user
 * attached or the guard has already thrown before the handler runs.
 */
export type AuthenticatedUser = User;

// ---------------------------------------------------------------------------
// @Public() — bypasses JwtAuthGuard entirely (no cookie is even inspected).
// ---------------------------------------------------------------------------

export const IS_PUBLIC_KEY = 'eventory:isPublic';

/**
 * Marks a route (or an entire controller) as exempt from the global
 * `JwtAuthGuard`. Used for health, the Google OAuth redirect/callback/logout
 * routes, and `GET /api/qr/:token` (native camera scans hit this
 * unauthenticated).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

// ---------------------------------------------------------------------------
// @AllowPending() — requires a resolvable session (when one is presented),
// but does not require `status === approved`, and does not throw when no
// cookie is presented at all.
// ---------------------------------------------------------------------------

export const ALLOW_PENDING_KEY = 'eventory:allowPending';

/**
 * Marks a route as reachable by `pending`/`rejected` users (not just
 * `approved`), and — unlike the default guard behaviour — never throws when
 * no cookie (or an invalid one) is presented; the route itself is
 * responsible for handling an absent user. Used exclusively by `GET
 * /api/auth/me`, which must always resolve 200 with `null` rather than 401.
 */
export const AllowPending = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PENDING_KEY, true);

// ---------------------------------------------------------------------------
// @CurrentUser() — pulls the user JwtAuthGuard attached to the request.
// ---------------------------------------------------------------------------

type RequestWithAuthenticatedUser = Omit<Request, 'user'> & { user?: AuthenticatedUser | null };

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser | null => {
    const request = ctx.switchToHttp().getRequest<RequestWithAuthenticatedUser>();
    return request.user ?? null;
  },
);
