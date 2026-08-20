import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { InviteStatus, UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashInviteToken } from '../workspace/workspaces.service';
import {
  AuthService,
  DEFAULT_JWT_SECRET,
  isAllowlistConfigured,
  isEmailAllowed,
  parseAdminAllowlist,
  parseAllowedSignins,
  resolveJwtSecret,
  SignInNotAllowedError,
  toPublicUser,
} from './auth.service';
import { GoogleProfile } from './google.strategy';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_ID = '11111111-1111-1111-1111-111111111111';

function makePrismaMock() {
  const user = {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  const workspaceInvite = {
    findUnique: jest.fn().mockResolvedValue(null),
  };
  const mock: {
    user: typeof user;
    workspaceInvite: typeof workspaceInvite;
    $transaction: jest.Mock;
  } = {
    user,
    workspaceInvite,
    // Mimics Prisma's interactive `$transaction(async (tx) => ...)` by
    // handing the callback this same mock — `tx.user.count()` /
    // `tx.user.create()` hit the exact jest mocks the test configured.
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(mock)),
  };
  return mock;
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
    it('creates the FIRST-ever (OAuth) user as admin + approved on an otherwise-empty table (AC5)', async () => {
      prisma.user.findUnique.mockResolvedValue(null); // neither googleId nor email match
      prisma.user.count.mockResolvedValue(0);
      const created = makeUser({ role: UserRole.admin, status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      const result = await service.upsertFromGoogleProfile(makeProfile(), {});

      expect(prisma.$transaction).toHaveBeenCalled();
      // AC2: the first-user count only counts rows that have signed in via
      // Google (have a googleId) — never a bare row count.
      expect(prisma.user.count).toHaveBeenCalledWith({ where: { googleId: { not: null } } });
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

    it('AC5: a seeded row with NO googleId does not count as "first user" — a real OAuth sign-in still gets promoted', async () => {
      prisma.user.findUnique.mockResolvedValue(null); // no match by googleId or email
      // Simulates a table that already has one row (the seeded fixture with
      // no googleId), but the googleId-scoped count still sees zero real
      // OAuth sign-ins.
      prisma.user.count.mockResolvedValue(0);
      const created = makeUser({ role: UserRole.admin, status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile(), {});

      expect(prisma.user.count).toHaveBeenCalledWith({ where: { googleId: { not: null } } });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.admin, status: UserStatus.approved }),
        }),
      );
    });

    it('AC5: a non-allowlisted first (OAuth) user on an empty table still gets first-user promotion', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      const created = makeUser({ role: UserRole.admin, status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(
        makeProfile({ email: 'not-on-the-allowlist@example.com' }),
        { EVENTORY_ADMIN_EMAILS: 'someone-else@example.com' },
      );

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ role: UserRole.admin, status: UserStatus.approved }),
        }),
      );
    });

    // -------------------------------------------------------------------------
    // EVT-42 auth rework — the global "pending until an admin approves" gate
    // is retired: EVERY new sign-in (promoted or not) is created `approved`
    // immediately. Only `role`/`approvedAt` stay conditional on promotion.
    // -------------------------------------------------------------------------

    it('EVT-42: creates a SECOND (non-promoted) user as approved immediately — no pending gate, no auto-admin', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(1);
      const created = makeUser({ id: 'second-user', status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile({ googleId: 'google-id-2' }));

      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.status).toBe(UserStatus.approved);
      expect(createArg.data.role).toBeUndefined();
      expect(createArg.data.approvedAt).toBeUndefined();
    });

    it('the first-user count+create runs inside the SAME $transaction callback (race-safe)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      prisma.user.create.mockResolvedValue(makeUser());

      await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // Called via the `tx` handed to the transaction callback, not a
      // standalone top-level call outside the transaction.
      expect(prisma.user.count).toHaveBeenCalledTimes(1);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
    });

    it('updates an existing user (matched by googleId) and stamps lastLoginAt, WITHOUT creating', async () => {
      const existing = makeUser();
      prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
      const updated = { ...existing, lastLoginAt: new Date() };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { googleId: 'google-id-1' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('binds googleId to an existing row matched by email ONLY when that row has no googleId yet', async () => {
      const existing = makeUser({ googleId: null as unknown as string });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // no match by googleId
        .mockResolvedValueOnce(existing); // matched by email
      prisma.user.update.mockResolvedValue({ ...existing, googleId: 'fresh-google-id' });

      await service.upsertFromGoogleProfile(makeProfile({ googleId: 'fresh-google-id' }));

      expect(prisma.user.findUnique).toHaveBeenNthCalledWith(1, {
        where: { googleId: 'fresh-google-id' },
      });
      expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, {
        where: { email: 'alice@example.com' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: expect.objectContaining({ googleId: 'fresh-google-id' }),
        }),
      );
    });

    it('REFUSES to rebind an email-matched row that already has a DIFFERENT googleId (account-takeover guard)', async () => {
      const existing = makeUser({ googleId: 'legitimate-owner-google-id' });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // no match by the incoming googleId
        .mockResolvedValueOnce(existing); // matched by email, but a DIFFERENT googleId is already bound

      await expect(
        service.upsertFromGoogleProfile(makeProfile({ googleId: 'attacker-google-id' })),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    // =======================================================================
    // EVENTORY_ADMIN_EMAILS bootstrap allowlist (EVT-20 AC1 / AC5)
    // =======================================================================

    it('AC1/AC5: an allowlisted email becomes admin + approved on FIRST creation even with pre-existing rows', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      // Pre-existing rows already consumed the count-based "first user"
      // slot — the allowlist must still win.
      prisma.user.count.mockResolvedValue(3);
      const created = makeUser({
        email: 'operator@example.com',
        role: UserRole.admin,
        status: UserStatus.approved,
      });
      prisma.user.create.mockResolvedValue(created);

      const result = await service.upsertFromGoogleProfile(
        makeProfile({ email: 'operator@example.com' }),
        { EVENTORY_ADMIN_EMAILS: 'someone@example.com, Operator@Example.com ' },
      );

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

    it('AC1: retroactively promotes an allowlisted email matched by googleId that is still pending', async () => {
      const existing = makeUser({
        email: 'operator@example.com',
        status: UserStatus.pending,
        role: UserRole.user,
      });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
      prisma.user.update.mockResolvedValue({
        ...existing,
        role: UserRole.admin,
        status: UserStatus.approved,
      });

      await service.upsertFromGoogleProfile(makeProfile({ email: 'operator@example.com' }), {
        EVENTORY_ADMIN_EMAILS: 'operator@example.com',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: expect.objectContaining({
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('AC1: retroactively promotes an allowlisted email matched by email (no googleId yet) that is still pending', async () => {
      const existing = makeUser({
        email: 'operator@example.com',
        googleId: null as unknown as string,
        status: UserStatus.pending,
        role: UserRole.user,
      });
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // no match by googleId
        .mockResolvedValueOnce(existing); // matched by email
      prisma.user.update.mockResolvedValue({
        ...existing,
        googleId: 'fresh-google-id',
        role: UserRole.admin,
        status: UserStatus.approved,
      });

      await service.upsertFromGoogleProfile(
        makeProfile({ email: 'operator@example.com', googleId: 'fresh-google-id' }),
        { EVENTORY_ADMIN_EMAILS: 'operator@example.com' },
      );

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id },
          data: expect.objectContaining({
            googleId: 'fresh-google-id',
            role: UserRole.admin,
            status: UserStatus.approved,
            approvedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('AC1: does NOT re-stamp approvedAt / touch role/status for an allowlisted email that is already admin + approved', async () => {
      const existing = makeUser({
        email: 'operator@example.com',
        status: UserStatus.approved,
        role: UserRole.admin,
      });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
      prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });

      await service.upsertFromGoogleProfile(makeProfile({ email: 'operator@example.com' }), {
        EVENTORY_ADMIN_EMAILS: 'operator@example.com',
      });

      const updateArg = prisma.user.update.mock.calls[0][0];
      expect(updateArg.data.approvedAt).toBeUndefined();
      expect(updateArg.data.role).toBeUndefined();
      expect(updateArg.data.status).toBeUndefined();
    });

    it('leaves a non-allowlisted, non-first, returning user’s role/status untouched', async () => {
      const existing = makeUser({ status: UserStatus.pending, role: UserRole.user });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
      prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });

      await service.upsertFromGoogleProfile(makeProfile(), {});

      const updateArg = prisma.user.update.mock.calls[0][0];
      expect(updateArg.data.role).toBeUndefined();
      expect(updateArg.data.status).toBeUndefined();
    });

    // =======================================================================
    // EVENTORY_ALLOWED_SIGNINS sign-in allowlist (EVT-45)
    // =======================================================================

    describe('EVT-45 sign-in allowlist', () => {
      it('REFUSES a brand-new, non-allowlisted sign-in with SignInNotAllowedError and creates NO row', async () => {
        prisma.user.findUnique.mockResolvedValue(null); // no match by googleId or email
        prisma.user.count.mockResolvedValue(1); // not the bootstrap case

        await expect(
          service.upsertFromGoogleProfile(makeProfile({ email: 'stranger@example.com' }), {
            EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com',
          }),
        ).rejects.toThrow(SignInNotAllowedError);

        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it('admits an exact-email allowlist match', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.user.create.mockResolvedValue(makeUser({ email: 'alice@example.com' }));

        await service.upsertFromGoogleProfile(makeProfile({ email: 'alice@example.com' }), {
          EVENTORY_ALLOWED_SIGNINS: 'alice@example.com',
        });

        expect(prisma.user.create).toHaveBeenCalled();
      });

      it('admits an `@domain` allowlist match', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.user.create.mockResolvedValue(makeUser({ email: 'anyone@family.example.com' }));

        await service.upsertFromGoogleProfile(makeProfile({ email: 'anyone@family.example.com' }), {
          EVENTORY_ALLOWED_SIGNINS: '@family.example.com',
        });

        expect(prisma.user.create).toHaveBeenCalled();
      });

      it('admits a non-allowlisted email that IS EVENTORY_ADMIN_EMAILS-allowlisted', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.user.create.mockResolvedValue(makeUser({ email: 'operator@example.com' }));

        await service.upsertFromGoogleProfile(makeProfile({ email: 'operator@example.com' }), {
          EVENTORY_ALLOWED_SIGNINS: 'nobody@example.com',
          EVENTORY_ADMIN_EMAILS: 'operator@example.com',
        });

        expect(prisma.user.create).toHaveBeenCalled();
      });

      it('the zero-user bootstrap sign-in is admitted regardless of the allowlist', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(0); // bootstrap
        prisma.user.create.mockResolvedValue(
          makeUser({ role: UserRole.admin, status: UserStatus.approved }),
        );

        await service.upsertFromGoogleProfile(makeProfile({ email: 'stranger@example.com' }), {
          EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com',
        });

        expect(prisma.user.create).toHaveBeenCalled();
      });

      it('admits a non-allowlisted email presenting a valid, pending, unexpired invite token', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.user.create.mockResolvedValue(makeUser({ email: 'invitee@example.com' }));
        const rawToken = 'a'.repeat(64);
        prisma.workspaceInvite.findUnique.mockResolvedValue({
          id: 'invite-1',
          tokenHash: hashInviteToken(rawToken),
          status: InviteStatus.pending,
          role: WorkspaceRole.member,
          expiresAt: new Date(Date.now() + 60_000),
        });

        await service.upsertFromGoogleProfile(
          makeProfile({ email: 'invitee@example.com' }),
          { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
          rawToken,
        );

        expect(prisma.workspaceInvite.findUnique).toHaveBeenCalledWith({
          where: { tokenHash: hashInviteToken(rawToken) },
        });
        expect(prisma.user.create).toHaveBeenCalled();
      });

      it('REFUSES a non-allowlisted email presenting an EXPIRED invite token', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        const rawToken = 'b'.repeat(64);
        prisma.workspaceInvite.findUnique.mockResolvedValue({
          id: 'invite-1',
          tokenHash: hashInviteToken(rawToken),
          status: InviteStatus.pending,
          role: WorkspaceRole.member,
          expiresAt: new Date(Date.now() - 60_000), // expired
        });

        await expect(
          service.upsertFromGoogleProfile(
            makeProfile({ email: 'stranger@example.com' }),
            { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
            rawToken,
          ),
        ).rejects.toThrow(SignInNotAllowedError);
        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it('REFUSES a non-allowlisted email presenting an already-REDEEMED invite token', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        const rawToken = 'c'.repeat(64);
        prisma.workspaceInvite.findUnique.mockResolvedValue({
          id: 'invite-1',
          tokenHash: hashInviteToken(rawToken),
          status: InviteStatus.redeemed,
          role: WorkspaceRole.member,
          expiresAt: new Date(Date.now() + 60_000),
        });

        await expect(
          service.upsertFromGoogleProfile(
            makeProfile({ email: 'stranger@example.com' }),
            { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
            rawToken,
          ),
        ).rejects.toThrow(SignInNotAllowedError);
      });

      it('an UNKNOWN invite token does not admit a non-allowlisted sign-in', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.workspaceInvite.findUnique.mockResolvedValue(null);

        await expect(
          service.upsertFromGoogleProfile(
            makeProfile({ email: 'stranger@example.com' }),
            { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
            'not-a-real-token',
          ),
        ).rejects.toThrow(SignInNotAllowedError);
      });

      it('does NOT gate an EXISTING account matched by googleId, even when the allowlist would refuse them', async () => {
        const existing = makeUser({ email: 'stranger@example.com' });
        prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
        prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });

        const result = await service.upsertFromGoogleProfile(
          makeProfile({ email: 'stranger@example.com' }),
          { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
        );

        expect(result).toEqual({ ...existing, lastLoginAt: expect.any(Date) });
        expect(prisma.user.create).not.toHaveBeenCalled();
      });

      it('does NOT gate when EVENTORY_ALLOWED_SIGNINS is unset (open registration, pre-EVT-45 default)', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.user.count.mockResolvedValue(1);
        prisma.user.create.mockResolvedValue(makeUser({ email: 'anyone@example.com' }));

        await service.upsertFromGoogleProfile(makeProfile({ email: 'anyone@example.com' }), {});

        expect(prisma.user.create).toHaveBeenCalled();
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
// resolveJwtSecret
// ---------------------------------------------------------------------------

describe('resolveJwtSecret', () => {
  it('returns a configured, non-default JWT_SECRET as-is', () => {
    expect(resolveJwtSecret({ JWT_SECRET: 'a-real-production-secret' })).toBe(
      'a-real-production-secret',
    );
  });

  it('falls back to the dev default when JWT_SECRET is unset outside production', () => {
    expect(resolveJwtSecret({ NODE_ENV: 'test' })).toBe(DEFAULT_JWT_SECRET);
    expect(resolveJwtSecret({ NODE_ENV: 'development' })).toBe(DEFAULT_JWT_SECRET);
    expect(resolveJwtSecret({})).toBe(DEFAULT_JWT_SECRET);
  });

  it('falls back to the dev default when JWT_SECRET is explicitly the default outside production', () => {
    expect(resolveJwtSecret({ JWT_SECRET: DEFAULT_JWT_SECRET, NODE_ENV: 'test' })).toBe(
      DEFAULT_JWT_SECRET,
    );
  });

  it('THROWS at bootstrap when JWT_SECRET is unset and NODE_ENV=production', () => {
    expect(() => resolveJwtSecret({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
  });

  it('THROWS at bootstrap when JWT_SECRET is explicitly the default and NODE_ENV=production', () => {
    expect(() =>
      resolveJwtSecret({ JWT_SECRET: DEFAULT_JWT_SECRET, NODE_ENV: 'production' }),
    ).toThrow(/JWT_SECRET/);
  });

  it('does NOT throw in production when a real JWT_SECRET is configured', () => {
    expect(
      resolveJwtSecret({ JWT_SECRET: 'a-real-production-secret', NODE_ENV: 'production' }),
    ).toBe('a-real-production-secret');
  });

  // EVT-19 review round 2, finding 1: the historical `.env.prod.example`
  // placeholder must be rejected the same way as DEFAULT_JWT_SECRET, so a
  // `.env.prod` copied before that example shipped an empty value still
  // fails closed in production.
  it('falls back to the dev default when JWT_SECRET is the historical .env.prod.example placeholder outside production', () => {
    expect(
      resolveJwtSecret({ JWT_SECRET: 'change-me-to-a-long-random-secret', NODE_ENV: 'test' }),
    ).toBe(DEFAULT_JWT_SECRET);
  });

  it('THROWS at bootstrap when JWT_SECRET is the historical .env.prod.example placeholder and NODE_ENV=production', () => {
    expect(() =>
      resolveJwtSecret({
        JWT_SECRET: 'change-me-to-a-long-random-secret',
        NODE_ENV: 'production',
      }),
    ).toThrow(/JWT_SECRET/);
  });
});

// ---------------------------------------------------------------------------
// parseAdminAllowlist
// ---------------------------------------------------------------------------

describe('parseAdminAllowlist', () => {
  it('returns an empty set when unset', () => {
    expect(parseAdminAllowlist(undefined)).toEqual(new Set());
  });

  it('returns an empty set for an empty string', () => {
    expect(parseAdminAllowlist('')).toEqual(new Set());
  });

  it('splits on commas, trims whitespace, and lowercases', () => {
    expect(parseAdminAllowlist(' Alice@Example.com, bob@example.com ,charlie@example.com')).toEqual(
      new Set(['alice@example.com', 'bob@example.com', 'charlie@example.com']),
    );
  });

  it('ignores empty entries from trailing/double commas', () => {
    expect(parseAdminAllowlist('alice@example.com,,')).toEqual(new Set(['alice@example.com']));
  });
});

// ---------------------------------------------------------------------------
// parseAllowedSignins / isEmailAllowed / isAllowlistConfigured (EVT-45)
// ---------------------------------------------------------------------------

describe('parseAllowedSignins', () => {
  it('returns empty sets when unset or empty', () => {
    expect(parseAllowedSignins(undefined)).toEqual({ emails: new Set(), domains: new Set() });
    expect(parseAllowedSignins('')).toEqual({ emails: new Set(), domains: new Set() });
  });

  it('splits emails and @domain entries into separate sets, trimmed and lowercased', () => {
    const result = parseAllowedSignins(
      ' Alice@Example.com, @Family.Example.com ,bob@example.com,,',
    );
    expect(result).toEqual({
      emails: new Set(['alice@example.com', 'bob@example.com']),
      domains: new Set(['family.example.com']),
    });
  });

  it('ignores a bare "@" entry (empty domain)', () => {
    expect(parseAllowedSignins('@,alice@example.com')).toEqual({
      emails: new Set(['alice@example.com']),
      domains: new Set(),
    });
  });
});

describe('isAllowlistConfigured', () => {
  it('is false for an empty allowlist', () => {
    expect(isAllowlistConfigured(parseAllowedSignins(undefined))).toBe(false);
  });

  it('is true once at least one email or domain is present', () => {
    expect(isAllowlistConfigured(parseAllowedSignins('alice@example.com'))).toBe(true);
    expect(isAllowlistConfigured(parseAllowedSignins('@example.com'))).toBe(true);
  });
});

describe('isEmailAllowed', () => {
  it('matches an exact (case-insensitive) email entry', () => {
    const allowlist = parseAllowedSignins('alice@example.com');
    expect(isEmailAllowed('Alice@Example.com', allowlist)).toBe(true);
    expect(isEmailAllowed('bob@example.com', allowlist)).toBe(false);
  });

  it('matches any address at an allowlisted @domain entry', () => {
    const allowlist = parseAllowedSignins('@family.example.com');
    expect(isEmailAllowed('anyone@family.example.com', allowlist)).toBe(true);
    expect(isEmailAllowed('anyone@other.example.com', allowlist)).toBe(false);
  });

  it('does NOT match a subdomain of an allowlisted domain (exact match only)', () => {
    const allowlist = parseAllowedSignins('@example.com');
    expect(isEmailAllowed('someone@sub.example.com', allowlist)).toBe(false);
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
