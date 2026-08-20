/**
 * Auth API — end-to-end integration tests (supertest + real PostgreSQL).
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts, the
 * same way items.e2e-spec.ts / photos.e2e-spec.ts do.
 *
 * The real Google OAuth handshake is NOT exercised here (no network call to
 * Google) — `AuthService.upsertFromGoogleProfile` is called directly with a
 * mocked profile, exactly what `AuthController.googleCallback` does with
 * the profile passport hands it after a real handshake. This mirrors the
 * task's requirement that tests "must not require... real Google OAuth".
 *
 * Coverage:
 *   AC1 — first user → admin+approved; second → ALSO approved immediately
 *          (EVT-42 auth rework: the global pending gate is retired), but
 *          starts with ZERO workspace memberships → blocked from
 *          /api/items (403 via workspace context, not status) though still
 *          allowed /auth/me; granted a workspace → allowed
 *   AC2 — /auth/me with no/invalid cookie → null, 200
 *   AC3 — admin endpoints reject non-admins; self-demotion/self-rejection
 *          rejected
 *   AC4 — GET /api/qr/:token remains public
 *   AC5 — guard sweep: every route discovered from Nest's ACTUAL route
 *          table (via `DiscoveryService`, not a hand-maintained list) that
 *          isn't `@Public()`/`@AllowPending()` returns 401 without a cookie
 *   AC6 (EVT-45) — sign-in allowlist: a non-allowlisted BRAND-NEW sign-in is
 *          refused (SignInNotAllowedError, no User row created); allowlisted
 *          email/@domain entries, an EVENTORY_ADMIN_EMAILS match, a valid
 *          pending invite token, the zero-user bootstrap sign-in, and any
 *          EXISTING account all admit regardless of the allowlist's current
 *          contents; GET /api/auth/google?invite=<token> forwards the token
 *          as the OAuth `state` param (no real Google network call needed
 *          for this leg — it's pure authorization-URL construction)
 */

import { randomBytes } from 'crypto';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { InviteStatus, UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { AUTH_COOKIE_NAME, AuthService, SignInNotAllowedError } from '../src/auth/auth.service';
import { ALLOW_PENDING_KEY, IS_PUBLIC_KEY } from '../src/auth/decorators';
import { GoogleProfile } from '../src/auth/google.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../src/workspace/default-workspace';
import { hashInviteToken } from '../src/workspace/workspaces.service';
import { wrapWithCookie } from './e2e-auth-helper';

// ---------------------------------------------------------------------------
// Route-table discovery (AC5) — see the describe block below for rationale.
// ---------------------------------------------------------------------------

type SupportedMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

const METHOD_NAME_BY_REQUEST_METHOD: Partial<Record<RequestMethod, SupportedMethod>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

function toPathArray(pathMeta: string | string[] | undefined): string[] {
  if (!pathMeta) {
    return [''];
  }
  return Array.isArray(pathMeta) ? pathMeta : [pathMeta];
}

function joinPaths(...parts: string[]): string {
  const joined = parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

/**
 * Guards run before pipes in Nest's request lifecycle, so any placeholder
 * satisfies a `:id` / `:qr` / `:token` param for the purposes of exercising
 * `JwtAuthGuard` — the route handler (and any `ParseUUIDPipe`) never runs
 * when the guard rejects the request first.
 */
function withPlaceholderParams(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'placeholder-value' : segment))
    .join('/');
}

/**
 * Walks Nest's ACTUAL route table (via `DiscoveryService`, the same
 * discovery mechanism Nest uses internally — not Express router-stack
 * scraping) and returns every registered route that is neither `@Public()`
 * nor `@AllowPending()`, i.e. every route `JwtAuthGuard` is expected to
 * reject without a cookie.
 *
 * Deliberately NOT a hand-maintained list (EVT-14 review round 2, finding
 * 3): a hardcoded `PROTECTED_ROUTES` array silently omitted several real
 * routes (PATCH/DELETE /api/items/:id, /api/locations/:id, etc.) because
 * nobody remembered to add them when those controllers were built. Deriving
 * from the route table means a future controller/route is covered
 * automatically the next time this suite runs — no test file edit needed.
 */
function discoverProtectedRoutes(
  app: INestApplication,
): { method: SupportedMethod; path: string }[] {
  const modulesContainer = app.get(ModulesContainer);
  const discovery = new DiscoveryService(modulesContainer);
  const metadataScanner = new MetadataScanner();

  const routes: { method: SupportedMethod; path: string }[] = [];

  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) {
      continue;
    }
    const prototype = Object.getPrototypeOf(instance);
    const controllerPaths = toPathArray(Reflect.getMetadata(PATH_METADATA, metatype));
    const controllerIsPublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, metatype));
    const controllerAllowsPending = Boolean(Reflect.getMetadata(ALLOW_PENDING_KEY, metatype));

    for (const methodName of metadataScanner.getAllMethodNames(prototype)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const handler = (prototype as any)[methodName];
      const requestMethod: RequestMethod | undefined = Reflect.getMetadata(
        METHOD_METADATA,
        handler,
      );
      if (requestMethod === undefined) {
        continue; // not a route handler — a plain helper method on the controller
      }

      const methodIsPublicMeta = Reflect.getMetadata(IS_PUBLIC_KEY, handler);
      const isPublic =
        methodIsPublicMeta !== undefined ? Boolean(methodIsPublicMeta) : controllerIsPublic;
      const methodAllowsPendingMeta = Reflect.getMetadata(ALLOW_PENDING_KEY, handler);
      const allowsPending =
        methodAllowsPendingMeta !== undefined
          ? Boolean(methodAllowsPendingMeta)
          : controllerAllowsPending;

      if (isPublic || allowsPending) {
        continue;
      }

      const supportedMethod = METHOD_NAME_BY_REQUEST_METHOD[requestMethod];
      if (!supportedMethod) {
        continue; // ALL/OPTIONS/HEAD/SEARCH — unused in this API, nothing to assert
      }

      const methodPaths = toPathArray(Reflect.getMetadata(PATH_METADATA, handler));
      for (const controllerPath of controllerPaths) {
        for (const methodPath of methodPaths) {
          routes.push({
            method: supportedMethod,
            path: withPlaceholderParams(joinPaths('/api', controllerPath, methodPath)),
          });
        }
      }
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let profileCounter = 0;

function makeProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  const n = profileCounter++;
  return {
    googleId: `google-id-${n}`,
    email: `user-${n}@example.com`,
    name: `User ${n}`,
    picture: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Auth API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  /** Unauthenticated client — no cookie ever set. */
  let http: ReturnType<typeof supertest>;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    // Mirror src/main.ts's bootstrap() — JwtAuthGuard reads `req.cookies`,
    // which only exists once this middleware has run (EVT-14).
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    authService = moduleFixture.get<AuthService>(AuthService);
    http = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  /** Clean everything auth touches before each test so tests are isolated. */
  beforeEach(async () => {
    await prisma.itemTag.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.item.deleteMany();
    await prisma.location.deleteMany();
    await prisma.category.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.user.deleteMany();
  });

  // =========================================================================
  // AC1 — first-user-admin; EVT-42 auth rework: second sign-in is ALSO
  // approved immediately, gated instead by workspace membership
  // =========================================================================

  describe('AC1: sign-in / workspace-membership gating (EVT-42 auth rework)', () => {
    it('the FIRST-ever Google sign-in becomes admin + approved', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());

      expect(user.role).toBe(UserRole.admin);
      expect(user.status).toBe(UserStatus.approved);
    });

    it('EVT-42: the SECOND sign-in is ALSO approved immediately (no pending gate) — but starts with ZERO workspace memberships, so /api/items is 403 while /auth/me stays 200', async () => {
      await authService.upsertFromGoogleProfile(makeProfile());
      const second = await authService.upsertFromGoogleProfile(makeProfile());

      expect(second.role).toBe(UserRole.user);
      expect(second.status).toBe(UserStatus.approved);

      const secondHttp = wrapWithCookie(app, authService, second);

      // Blocked by WorkspaceContextGuard/@CurrentWorkspace() (zero
      // memberships), NOT by JwtAuthGuard/status.
      await secondHttp.get('/api/items').expect(403);

      const meRes = await secondHttp.get('/api/auth/me').expect(200);
      expect(meRes.body.id).toBe(second.id);
      expect(meRes.body.status).toBe(UserStatus.approved);
    });

    it('EVT-42: once the user creates (or redeems into) a workspace, they are allowed through /api/items — no admin action required', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      await http.get('/api/items').expect(403);

      await http.post('/api/workspaces').send({ name: 'My Workspace' }).expect(201);

      await http.get('/api/items').expect(200);
    });
  });

  // =========================================================================
  // AC2 — cookie + /auth/me semantics
  // =========================================================================

  describe('AC2: /auth/me is always 200, never 401', () => {
    it('with no cookie → null, 200', async () => {
      const res = await http.get('/api/auth/me').expect(200);
      expect(res.body).toBeNull();
    });

    it('with an invalid/garbage cookie → null, 200', async () => {
      const res = await http
        .get('/api/auth/me')
        .set('Cookie', `${AUTH_COOKIE_NAME}=not-a-valid-jwt`)
        .expect(200);
      expect(res.body).toBeNull();
    });

    it('with a valid cookie → the sanitized user (no googleId), 200', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const authedHttp = wrapWithCookie(app, authService, user);

      const res = await authedHttp.get('/api/auth/me').expect(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.email).toBe(user.email);
      expect(res.body).not.toHaveProperty('googleId');
    });
  });

  // =========================================================================
  // AC3 — admin endpoints
  // =========================================================================

  describe('AC3: admin endpoints', () => {
    it('reject a non-admin (approved) user with 403', async () => {
      const admin = await authService.upsertFromGoogleProfile(makeProfile());
      const other = await authService.upsertFromGoogleProfile(makeProfile());

      const adminHttp = wrapWithCookie(app, authService, admin);
      await adminHttp
        .patch(`/api/users/${other.id}/status`)
        .send({ status: UserStatus.approved })
        .expect(200);

      const otherHttp = wrapWithCookie(app, authService, other);
      await otherHttp.get('/api/users').expect(403);
    });

    it('self-demotion is rejected (admin cannot demote themself via /role)', async () => {
      const admin = await authService.upsertFromGoogleProfile(makeProfile());
      const adminHttp = wrapWithCookie(app, authService, admin);

      await adminHttp
        .patch(`/api/users/${admin.id}/role`)
        .send({ role: UserRole.user })
        .expect(403);

      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(fresh.role).toBe(UserRole.admin);
    });

    it('self-rejection is rejected (admin cannot reject/un-approve themself via /status)', async () => {
      const admin = await authService.upsertFromGoogleProfile(makeProfile());
      const adminHttp = wrapWithCookie(app, authService, admin);

      await adminHttp
        .patch(`/api/users/${admin.id}/status`)
        .send({ status: UserStatus.rejected })
        .expect(403);

      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(fresh.status).toBe(UserStatus.approved);
    });

    it('an admin CAN approve/promote a different user', async () => {
      const admin = await authService.upsertFromGoogleProfile(makeProfile());
      const other = await authService.upsertFromGoogleProfile(makeProfile());
      const adminHttp = wrapWithCookie(app, authService, admin);

      await adminHttp
        .patch(`/api/users/${other.id}/role`)
        .send({ role: UserRole.admin })
        .expect(200);

      const fresh = await prisma.user.findUniqueOrThrow({ where: { id: other.id } });
      expect(fresh.role).toBe(UserRole.admin);
    });
  });

  // =========================================================================
  // AC4 — GET /api/qr/:token remains public
  // =========================================================================

  describe('AC4: GET /api/qr/:token remains public', () => {
    it('resolves without any cookie (404 for an unknown token proves the handler ran, not a 401/403)', async () => {
      await http.get('/api/qr/some-nonexistent-token').expect(404);
    });
  });

  // =========================================================================
  // AC5 — guard sweep: every route except @Public returns 401 without a cookie
  // =========================================================================

  describe('AC5: guard sweep', () => {
    let discoveredRoutes: { method: SupportedMethod; path: string }[];

    beforeAll(() => {
      discoveredRoutes = discoverProtectedRoutes(app);
      // Sanity-check the crawl actually found real routes — guards against
      // a discovery bug (e.g. a metadata-key typo) silently returning an
      // empty list, which would make the sweep below vacuously pass. The
      // hand-curated list this replaced had 12 entries and MISSED several
      // real routes; the discovered set should comfortably exceed it.
      expect(discoveredRoutes.length).toBeGreaterThanOrEqual(15);
    });

    it('every route discovered from the real Nest route table returns 401 without a cookie', async () => {
      for (const { method, path } of discoveredRoutes) {
        const res = await http[method](path);
        if (res.status !== 401) {
          throw new Error(
            `expected 401 for ${method.toUpperCase()} ${path} (no cookie), got ${res.status}. ` +
              'A route was added without protecting it, or without an explicit @Public()/@AllowPending().',
          );
        }
      }
    });

    it('GET /api/health is never 401 (@Public)', async () => {
      const res = await http.get('/api/health');
      expect(res.status).not.toBe(401);
    });

    it('GET /api/auth/me is never 401 (@AllowPending) — always 200', async () => {
      await http.get('/api/auth/me').expect(200);
    });

    it('GET /api/qr/:token is never 401 (@Public)', async () => {
      const res = await http.get('/api/qr/some-token');
      expect(res.status).not.toBe(401);
    });

    it('GET /api/auth/logout is never 401 (@Public) — redirects', async () => {
      const res = await http.get('/api/auth/logout');
      expect(res.status).not.toBe(401);
    });
  });

  // =========================================================================
  // AC6 (EVT-45) — sign-in allowlist
  // =========================================================================

  describe('AC6 (EVT-45): sign-in allowlist', () => {
    it('REFUSES a brand-new, non-allowlisted sign-in and persists NO User row', async () => {
      // Bootstrap the instance first so this isn't accidentally the
      // zero-user case — the FIRST-ever sign-in below is meant to test the
      // allowlist gate, not the bootstrap carve-out.
      await authService.upsertFromGoogleProfile(makeProfile());

      const profile = makeProfile({ email: 'stranger@example.com' });
      await expect(
        authService.upsertFromGoogleProfile(profile, {
          EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com',
        }),
      ).rejects.toThrow(SignInNotAllowedError);

      const row = await prisma.user.findUnique({ where: { googleId: profile.googleId } });
      expect(row).toBeNull();
    });

    it('admits an exact-email allowlist match', async () => {
      await authService.upsertFromGoogleProfile(makeProfile()); // bootstrap first

      const profile = makeProfile({ email: 'alice@example.com' });
      const user = await authService.upsertFromGoogleProfile(profile, {
        EVENTORY_ALLOWED_SIGNINS: 'alice@example.com',
      });

      expect(user.email).toBe('alice@example.com');
    });

    it('admits an `@domain` allowlist match', async () => {
      await authService.upsertFromGoogleProfile(makeProfile());

      const profile = makeProfile({ email: 'anyone@family.example.com' });
      const user = await authService.upsertFromGoogleProfile(profile, {
        EVENTORY_ALLOWED_SIGNINS: '@family.example.com',
      });

      expect(user.email).toBe('anyone@family.example.com');
    });

    it('the zero-user bootstrap sign-in is admitted regardless of the allowlist', async () => {
      // No prior sign-in in this test — genuinely zero users.
      const profile = makeProfile({ email: 'stranger@example.com' });

      const user = await authService.upsertFromGoogleProfile(profile, {
        EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com',
      });

      expect(user.role).toBe(UserRole.admin);
      expect(user.status).toBe(UserStatus.approved);
    });

    it('admits a non-allowlisted email presenting a valid, pending invite token', async () => {
      await authService.upsertFromGoogleProfile(makeProfile()); // bootstrap first

      const rawToken = randomBytes(32).toString('hex');
      await prisma.workspaceInvite.create({
        data: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          tokenHash: hashInviteToken(rawToken),
          role: WorkspaceRole.member,
          status: InviteStatus.pending,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const profile = makeProfile({ email: 'invitee@example.com' });
      const user = await authService.upsertFromGoogleProfile(
        profile,
        { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
        rawToken,
      );

      expect(user.email).toBe('invitee@example.com');

      // Validating the invite does NOT redeem it — still pending, still
      // redeemable via the normal POST /api/invites/redeem flow.
      const invite = await prisma.workspaceInvite.findUnique({
        where: { tokenHash: hashInviteToken(rawToken) },
      });
      expect(invite?.status).toBe(InviteStatus.pending);
    });

    it('REFUSES a non-allowlisted email presenting an EXPIRED invite token', async () => {
      await authService.upsertFromGoogleProfile(makeProfile());

      const rawToken = randomBytes(32).toString('hex');
      await prisma.workspaceInvite.create({
        data: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          tokenHash: hashInviteToken(rawToken),
          role: WorkspaceRole.member,
          status: InviteStatus.pending,
          expiresAt: new Date(Date.now() - 60_000), // expired
        },
      });

      const profile = makeProfile({ email: 'stranger@example.com' });
      await expect(
        authService.upsertFromGoogleProfile(
          profile,
          { EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com' },
          rawToken,
        ),
      ).rejects.toThrow(SignInNotAllowedError);
    });

    it('does NOT gate an EXISTING account signing back in, even when the allowlist would now refuse them', async () => {
      const profile = makeProfile({ email: 'previously-open@example.com' });
      const first = await authService.upsertFromGoogleProfile(profile, {}); // open registration

      // The operator tightens the allowlist AFTER this account already exists.
      const second = await authService.upsertFromGoogleProfile(profile, {
        EVENTORY_ALLOWED_SIGNINS: 'someone-else@example.com',
      });

      expect(second.id).toBe(first.id);
    });

    it('GET /api/auth/google?invite=<token> forwards the token as the OAuth `state` param (no Google network call for this leg)', async () => {
      const res = await http.get('/api/auth/google?invite=my-raw-invite-token');

      expect(res.status).toBe(302);
      const location = res.headers.location as string;
      expect(location).toContain('state=my-raw-invite-token');
    });
  });
});
