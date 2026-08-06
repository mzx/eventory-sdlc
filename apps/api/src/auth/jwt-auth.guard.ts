import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { AuthService, AUTH_COOKIE_NAME } from './auth.service';
import { ALLOW_PENDING_KEY, AuthenticatedUser, IS_PUBLIC_KEY } from './decorators';

export type RequestWithUser = Omit<Request, 'user'> & { user?: AuthenticatedUser | null };

/**
 * Global guard (registered as `APP_GUARD` in `AppModule`) — every route
 * requires an `approved` user by default.
 *
 * - `@Public()` routes skip this guard entirely (no cookie is inspected,
 *   `request.user` is never set).
 * - `@AllowPending()` routes resolve whatever user the cookie points to
 *   (any status), and — unlike every other route — do NOT throw when no
 *   cookie is presented or it doesn't resolve to a user; the route itself
 *   handles an absent user (used exclusively by `GET /api/auth/me`, which
 *   must always return 200).
 * - Every other route: no resolvable user → 401; a resolvable user whose
 *   `status !== approved` → 403.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = request.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
    const user = await this.authService.getUserFromToken(token);
    request.user = user;

    if (!user) {
      if (allowPending) {
        return true;
      }
      throw new UnauthorizedException('Sign in required');
    }

    if (allowPending) {
      return true;
    }

    if (user.status !== UserStatus.approved) {
      throw new ForbiddenException('Your account is not approved yet');
    }

    return true;
  }
}
