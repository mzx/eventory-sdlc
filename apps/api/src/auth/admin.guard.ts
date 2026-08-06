import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Route/controller-level guard for admin-only endpoints (`UsersController`).
 *
 * Relies on the global `JwtAuthGuard` having already run and attached
 * `request.user` — every route this guard protects has no `@Public()` /
 * `@AllowPending()` decorator, so `JwtAuthGuard` has already enforced
 * `status === approved` and populated `request.user` before this guard's
 * `canActivate` runs. This guard only adds the `role === admin` check.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.role !== UserRole.admin) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
