import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Route/controller-level guard for admin-only endpoints (`UsersController`).
 *
 * Relies on the global `JwtAuthGuard` having already run and attached
 * `request.user` — every route this guard protects has no `@Public()` /
 * `@AllowPending()` decorator, so `JwtAuthGuard` has already thrown for an
 * unresolvable or `rejected` caller before this guard's `canActivate` runs.
 *
 * EVT-42 round-2 security review, MAJOR: `JwtAuthGuard` no longer enforces
 * `status === approved` (see its doc comment — the retired global approval
 * gate) — a stale doc-comment claim here ("JwtAuthGuard has already
 * enforced status === approved") went FALSE the moment that landed. This
 * guard now explicitly checks `status === approved` itself, in addition to
 * `role === admin`: without it, an admin whose row was flipped to `pending`
 * (a legacy row predating this task, or any future/direct-DB state — note
 * `UpdateUserStatusDto` no longer even accepts `pending` as an admin
 * action, see its doc comment) would still pass on `role` alone and retain
 * full `/api/users` access, including the ability to re-promote themselves
 * back to `approved`.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user?.role !== UserRole.admin || request.user?.status !== UserStatus.approved) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}
