import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole, UserStatus } from '@prisma/client';
import { AuthService, AUTH_COOKIE_NAME } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(cookies: Record<string, string> = {}): {
  context: ExecutionContext;
  request: { cookies: Record<string, string>; user?: unknown };
} {
  const request: { cookies: Record<string, string>; user?: unknown } = { cookies };
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'a@b.com',
    role: UserRole.user,
    status: UserStatus.approved,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { getUserFromToken: jest.Mock };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    authService = { getUserFromToken: jest.fn() };
    guard = new JwtAuthGuard(
      reflector as unknown as Reflector,
      authService as unknown as AuthService,
    );
  });

  // =========================================================================
  // @Public()
  // =========================================================================

  describe('@Public() routes', () => {
    it('allows the request without ever inspecting the cookie', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(true); // isPublic
      const { context } = makeContext({ [AUTH_COOKIE_NAME]: 'some-token' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(authService.getUserFromToken).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Default (no decorator) — requires a resolvable, non-rejected user
  // =========================================================================

  describe('default routes (no decorator)', () => {
    it('throws UnauthorizedException (401) when no cookie is presented', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
      authService.getUserFromToken.mockResolvedValue(null);
      const { context } = makeContext({});

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('throws UnauthorizedException (401) when the cookie is invalid', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
      authService.getUserFromToken.mockResolvedValue(null);
      const { context } = makeContext({ [AUTH_COOKIE_NAME]: 'garbage' });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('EVT-42: allows a resolvable pending user through (approval gate retired — see workspace membership)', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
      const user = makeUser({ status: UserStatus.pending });
      authService.getUserFromToken.mockResolvedValue(user);
      const { context, request } = makeContext({ [AUTH_COOKIE_NAME]: 'valid-token' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(user);
    });

    it('throws ForbiddenException (403) for a rejected user', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
      authService.getUserFromToken.mockResolvedValue(makeUser({ status: UserStatus.rejected }));
      const { context } = makeContext({ [AUTH_COOKIE_NAME]: 'valid-token' });

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an approved user and attaches request.user', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(false);
      const user = makeUser({ status: UserStatus.approved });
      authService.getUserFromToken.mockResolvedValue(user);
      const { context, request } = makeContext({ [AUTH_COOKIE_NAME]: 'valid-token' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(user);
    });
  });

  // =========================================================================
  // @AllowPending()
  // =========================================================================

  describe('@AllowPending() routes', () => {
    it('allows a pending user through (does not enforce approved)', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(true); // allowPending
      const user = makeUser({ status: UserStatus.pending });
      authService.getUserFromToken.mockResolvedValue(user);
      const { context, request } = makeContext({ [AUTH_COOKIE_NAME]: 'valid-token' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toEqual(user);
    });

    it('never throws when no cookie is presented — attaches null user', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(true);
      authService.getUserFromToken.mockResolvedValue(null);
      const { context, request } = makeContext({});

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeNull();
    });

    it('never throws when the cookie is invalid — attaches null user', async () => {
      reflector.getAllAndOverride.mockReturnValueOnce(false).mockReturnValueOnce(true);
      authService.getUserFromToken.mockResolvedValue(null);
      const { context, request } = makeContext({ [AUTH_COOKIE_NAME]: 'garbage' });

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeNull();
    });
  });
});
