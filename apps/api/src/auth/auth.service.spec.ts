import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService, toPublicUser } from './auth.service';
import { GoogleProfile } from './google.strategy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makePrismaMock() {
  return {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
}

function makeProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  return {
    googleId: 'google-id-1',
    email: 'alice@example.com',
    name: 'Alice',
    picture: 'https://example.com/pic.png',
    ...overrides,
  };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: USER_ID,
    email: 'alice@example.com',
    name: 'Alice',
    picture: 'https://example.com/pic.png',
    googleId: 'google-id-1',
    status: UserStatus.pending,
    role: UserRole.user,
    approvedAt: null,
    approvedById: null,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let jwtService: { sign: jest.Mock; verifyAsync: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    jwtService = { sign: jest.fn(), verifyAsync: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    delete process.env.WEB_BASE;
  });

  // =========================================================================
  // upsertFromGoogleProfile
  // =========================================================================

  describe('upsertFromGoogleProfile', () => {
    it('creates the FIRST-ever user as admin + approved', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      const created = makeUser({ role: UserRole.admin, status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      const result = await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: expect.any(Date),
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('creates the SECOND user as a plain pending user (no auto-approval)', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(1);
      const created = makeUser({ id: 'second-user' });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile({ googleId: 'google-id-2' }));

      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.role).toBeUndefined();
      expect(createArg.data.status).toBeUndefined();
    });

    it('updates an existing user (matched by googleId) and stamps lastLoginAt', async () => {
      const existing = makeUser();
      prisma.user.findFirst.mockResolvedValue(existing);
      const updated = { ...existing, lastLoginAt: new Date() };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
      expect(result).toEqual(updated);
    });

    it('matches an existing user by email as a fallback when googleId differs', async () => {
      const existing = makeUser({ googleId: 'stale-google-id' });
      prisma.user.findFirst.mockResolvedValue(existing);
      prisma.user.update.mockResolvedValue(existing);

      await service.upsertFromGoogleProfile(makeProfile({ googleId: 'fresh-google-id' }));

      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { OR: [{ googleId: 'fresh-google-id' }, { email: 'alice@example.com' }] },
      });
    });
  });

  // =========================================================================
  // signToken / verifyToken / getUserFromToken
  // =========================================================================

  describe('signToken', () => {
    it('signs a JWT carrying sub/email/role/status', () => {
      jwtService.sign.mockReturnValue('signed.jwt.token');
      const user = makeUser({ role: UserRole.admin, status: UserStatus.approved });

      const token = service.signToken(user);

      expect(token).toBe('signed.jwt.token');
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: user.id, email: user.email, role: user.role, status: user.status },
        expect.objectContaining({ expiresIn: '30d' }),
      );
    });
  });

  describe('verifyToken', () => {
    it('returns the decoded payload for a valid token', async () => {
      const payload = {
        sub: USER_ID,
        email: 'a@b.com',
        role: UserRole.user,
        status: UserStatus.approved,
      };
      jwtService.verifyAsync.mockResolvedValue(payload);

      expect(await service.verifyToken('valid-token')).toEqual(payload);
    });

    it('returns null (never throws) for an invalid/expired token', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('invalid signature'));

      await expect(service.verifyToken('garbage')).resolves.toBeNull();
    });
  });

  describe('getUserFromToken', () => {
    it('returns null when no token is provided', async () => {
      expect(await service.getUserFromToken(undefined)).toBeNull();
      expect(jwtService.verifyAsync).not.toHaveBeenCalled();
    });

    it('returns null when the token fails verification', async () => {
      jwtService.verifyAsync.mockRejectedValue(new Error('bad'));
      expect(await service.getUserFromToken('bad-token')).toBeNull();
    });

    it('re-reads the user row from the DB rather than trusting the payload', async () => {
      const payload = {
        sub: USER_ID,
        email: 'a@b.com',
        role: UserRole.user,
        status: UserStatus.pending,
      };
      jwtService.verifyAsync.mockResolvedValue(payload);
      // DB row now shows `approved` — simulates an admin approving the user
      // after the JWT was minted.
      const freshRow = makeUser({ status: UserStatus.approved });
      prisma.user.findUnique.mockResolvedValue(freshRow);

      const result = await service.getUserFromToken('token');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: USER_ID } });
      expect(result).toEqual(freshRow);
    });

    it('returns null when the payload sub no longer resolves to a user', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'deleted-user',
        email: 'x',
        role: UserRole.user,
        status: UserStatus.approved,
      });
      prisma.user.findUnique.mockResolvedValue(null);

      expect(await service.getUserFromToken('token')).toBeNull();
    });
  });

  // =========================================================================
  // cookieOptions
  // =========================================================================

  describe('cookieOptions', () => {
    it('is httpOnly, secure, and SameSite=Lax', () => {
      const opts = service.cookieOptions();
      expect(opts.httpOnly).toBe(true);
      expect(opts.secure).toBe(true);
      expect(opts.sameSite).toBe('lax');
    });
  });

  // =========================================================================
  // webBase
  // =========================================================================

  describe('webBase', () => {
    it('falls back to the dev default when WEB_BASE is unset', () => {
      delete process.env.WEB_BASE;
      expect(service.webBase()).toBe('http://localhost:5173');
    });

    it('uses WEB_BASE when configured', () => {
      process.env.WEB_BASE = 'https://eventory.example.com';
      expect(service.webBase()).toBe('https://eventory.example.com');
    });
  });
});

// ---------------------------------------------------------------------------
// toPublicUser
// ---------------------------------------------------------------------------

describe('toPublicUser', () => {
  it('strips googleId and approval bookkeeping fields', () => {
    const user = makeUser({ approvedById: 'admin-id' });
    const publicUser = toPublicUser(user as never);

    expect(publicUser).toEqual({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      status: user.status,
      role: user.role,
      createdAt: user.createdAt,
    });
    expect(publicUser).not.toHaveProperty('googleId');
    expect(publicUser).not.toHaveProperty('approvedById');
  });
});
