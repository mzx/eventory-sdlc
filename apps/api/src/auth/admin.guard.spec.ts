import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
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

  it('allows an admin user through', () => {
    const context = makeContext({ id: 'admin-1', role: UserRole.admin });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws ForbiddenException for a non-admin (approved) user', () => {
    const context = makeContext({ id: 'user-1', role: UserRole.user });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when no user is attached to the request', () => {
    const context = makeContext(undefined);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
