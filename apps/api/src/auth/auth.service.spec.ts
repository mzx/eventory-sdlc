import { UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_WORKSPACE_ID,
  __resetDefaultWorkspaceCacheForTests,
} from '../workspace/default-workspace';
import {
  AuthService,
  DEFAULT_JWT_SECRET,
  parseAdminAllowlist,
  resolveJwtSecret,
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
  const mock: {
    user: typeof user;
    workspace: { findUniqueOrThrow: jest.Mock };
    workspaceMember: { upsert: jest.Mock };
    $transaction: jest.Mock;
  } = {
    user,
    // EVT-40 — an admin+approved promotion also grants Default Workspace
    // membership; see ensureDefaultWorkspaceMembership.
    workspace: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DEFAULT_WORKSPACE_ID }) },
    workspaceMember: { upsert: jest.fn() },
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
    __resetDefaultWorkspaceCacheForTests();
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

    it('EVT-40: grants the first-ever (bootstrap admin) user Default Workspace ownership', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(0);
      const created = makeUser({ role: UserRole.admin, status: UserStatus.approved });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile(), {});

      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: DEFAULT_WORKSPACE_ID, userId: created.id } },
        update: {},
        create: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          userId: created.id,
          role: WorkspaceRole.owner,
        },
      });
    });

    it('EVT-40: does NOT grant workspace membership for a plain (non-promoted) new sign-in', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(1); // not the first user, no allowlist match
      const created = makeUser({ role: UserRole.user, status: UserStatus.pending });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile(), {});

      expect(prisma.workspaceMember.upsert).not.toHaveBeenCalled();
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

    it('creates the SECOND user as a plain pending user (no auto-approval)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.count.mockResolvedValue(1);
      const created = makeUser({ id: 'second-user' });
      prisma.user.create.mockResolvedValue(created);

      await service.upsertFromGoogleProfile(makeProfile({ googleId: 'google-id-2' }));

      const createArg = prisma.user.create.mock.calls[0][0];
      expect(createArg.data.role).toBeUndefined();
      expect(createArg.data.status).toBeUndefined();
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

    // ---------------------------------------------------------------------
    // EVT-40 round-2 review, finding 8 — self-healing membership grant: an
    // already-approved returning user gets the (idempotent) membership
    // upsert on EVERY login, not just at the moment they're promoted, so a
    // transient failure right after a prior promotion doesn't strand them
    // approved-but-membership-less with no retry path.
    // ---------------------------------------------------------------------

    it('EVT-40: self-heals membership for an already-approved returning user, even with no promotion this login', async () => {
      const existing = makeUser({ role: UserRole.user, status: UserStatus.approved });
      prisma.user.findUnique.mockResolvedValueOnce(existing); // matched by googleId
      const updated = { ...existing, lastLoginAt: new Date() };
      prisma.user.update.mockResolvedValue(updated);

      await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: DEFAULT_WORKSPACE_ID, userId: updated.id } },
        update: {},
        create: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          userId: updated.id,
          role: WorkspaceRole.member,
        },
      });
    });

    it('EVT-40: does NOT grant workspace membership on a login that leaves the user still pending', async () => {
      const existing = makeUser({ role: UserRole.user, status: UserStatus.pending });
      prisma.user.findUnique.mockResolvedValueOnce(existing);
      prisma.user.update.mockResolvedValue({ ...existing, lastLoginAt: new Date() });

      await service.upsertFromGoogleProfile(makeProfile());

      expect(prisma.workspaceMember.upsert).not.toHaveBeenCalled();
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
      // EVT-40 — retroactive promotion also grants Default Workspace ownership.
      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ role: WorkspaceRole.owner }) }),
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
