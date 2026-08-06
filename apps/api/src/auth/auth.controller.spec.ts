import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import type { Request, Response } from 'express';
import { AuthController } from './auth.controller';
import { AUTH_COOKIE_NAME, AuthService } from './auth.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    email: 'alice@example.com',
    name: 'Alice',
    picture: null,
    googleId: 'google-1',
    status: UserStatus.approved,
    role: UserRole.user,
    approvedAt: null,
    approvedById: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeResMock(): jest.Mocked<
  Pick<Response, 'cookie' | 'redirect' | 'clearCookie' | 'status' | 'json'>
> {
  const res = {
    cookie: jest.fn(),
    redirect: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  } as never;
  (res as { status: jest.Mock }).status.mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthController', () => {
  let controller: AuthController;
  let authService: {
    upsertFromGoogleProfile: jest.Mock;
    signToken: jest.Mock;
    cookieOptions: jest.Mock;
    webBase: jest.Mock;
  };

  beforeEach(async () => {
    authService = {
      upsertFromGoogleProfile: jest.fn(),
      signToken: jest.fn(),
      cookieOptions: jest.fn().mockReturnValue({ httpOnly: true, secure: true, sameSite: 'lax' }),
      webBase: jest.fn().mockReturnValue('https://web.example.com'),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  // =========================================================================
  // googleCallback
  // =========================================================================

  describe('googleCallback', () => {
    it('upserts the user, sets the session cookie, and redirects to WEB_BASE for an approved user', async () => {
      const user = makeUser({ status: UserStatus.approved });
      authService.upsertFromGoogleProfile.mockResolvedValue(user);
      authService.signToken.mockReturnValue('signed-jwt');
      const res = makeResMock();
      const req = {
        user: { googleId: 'google-1', email: 'alice@example.com', name: 'Alice', picture: null },
      } as unknown as Request;

      await controller.googleCallback(req, res as unknown as Response);

      expect(authService.upsertFromGoogleProfile).toHaveBeenCalledWith(req.user);
      expect(res.cookie).toHaveBeenCalledWith(
        AUTH_COOKIE_NAME,
        'signed-jwt',
        expect.objectContaining({ httpOnly: true, secure: true }),
      );
      expect(res.redirect).toHaveBeenCalledWith('https://web.example.com');
    });

    it('redirects to /pending for a pending user', async () => {
      const user = makeUser({ status: UserStatus.pending });
      authService.upsertFromGoogleProfile.mockResolvedValue(user);
      authService.signToken.mockReturnValue('signed-jwt');
      const res = makeResMock();
      const req = { user: {} } as unknown as Request;

      await controller.googleCallback(req, res as unknown as Response);

      expect(res.redirect).toHaveBeenCalledWith('https://web.example.com/pending');
    });

    it('redirects to /rejected for a rejected user', async () => {
      const user = makeUser({ status: UserStatus.rejected });
      authService.upsertFromGoogleProfile.mockResolvedValue(user);
      authService.signToken.mockReturnValue('signed-jwt');
      const res = makeResMock();
      const req = { user: {} } as unknown as Request;

      await controller.googleCallback(req, res as unknown as Response);

      expect(res.redirect).toHaveBeenCalledWith('https://web.example.com/rejected');
    });
  });

  // =========================================================================
  // me
  // =========================================================================

  describe('me', () => {
    it('sends a literal JSON null when signed out (no user) — not an empty body', () => {
      const res = makeResMock();

      controller.me(null, res as unknown as Response);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(null);
    });

    it('sends a sanitized (no googleId) user when signed in', () => {
      const user = makeUser({ status: UserStatus.pending });
      const res = makeResMock();

      controller.me(user as never, res as unknown as Response);

      expect(res.json).toHaveBeenCalledWith({
        id: user.id,
        email: user.email,
        name: user.name,
        picture: user.picture,
        status: user.status,
        role: user.role,
        createdAt: user.createdAt,
      });
      const sentBody = res.json.mock.calls[0][0];
      expect(sentBody).not.toHaveProperty('googleId');
    });
  });

  // =========================================================================
  // logout
  // =========================================================================

  describe('logout', () => {
    it('clears the session cookie and redirects to WEB_BASE', () => {
      const res = makeResMock();

      controller.logout(res as unknown as Response);

      expect(res.clearCookie).toHaveBeenCalledWith(AUTH_COOKIE_NAME, { path: '/' });
      expect(res.redirect).toHaveBeenCalledWith('https://web.example.com');
    });
  });
});
