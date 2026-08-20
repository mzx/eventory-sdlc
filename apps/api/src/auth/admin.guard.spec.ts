import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { AdminGuard } from './admin.guard';

function makeContext(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  let guard: AdminGuard;

  beforeEach(() => {
    guard = new AdminGuard();
  });

  it('allows an admin + approved user through', () => {
    const context = makeContext({
      id: 'admin-1',
      role: UserRole.admin,
      status: UserStatus.approved,
    });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException for a non-admin (approved) user', () => {
    const context = makeContext({
      id: 'user-1',
      role: UserRole.user,
      status: UserStatus.approved,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when no user is attached to the request', () => {
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  // EVT-42 round-2 security review, MAJOR — an admin whose status isn't
  // `approved` (e.g. a legacy `pending` row, or `rejected` reachable via
  // e.g. a route that predates JwtAuthGuard's global rejected-block) must
  // NOT retain admin access on `role` alone.
  it('EVT-42: throws ForbiddenException for an admin whose status is `pending`', () => {
    const context = makeContext({
      id: 'admin-1',
      role: UserRole.admin,
      status: UserStatus.pending,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('EVT-42: throws ForbiddenException for an admin whose status is `rejected`', () => {
    const context = makeContext({
      id: 'admin-1',
      role: UserRole.admin,
      status: UserStatus.rejected,
    });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
