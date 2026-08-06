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
 *   AC1 — first user → admin+approved; second → pending, blocked from
 *          /api/items (403) but allowed /auth/me; after admin approves →
 *          allowed
 *   AC2 — /auth/me with no/invalid cookie → null, 200
 *   AC3 — admin endpoints reject non-admins; self-demotion/self-rejection
 *          rejected
 *   AC4 — GET /api/qr/:token remains public
 *   AC5 — guard sweep: every route discovered from Nest's ACTUAL route
 *          table (via `DiscoveryService`, not a hand-maintained list) that
 *          isn't `@Public()`/`@AllowPending()` returns 401 without a cookie
 */

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, ModulesContainer } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import cookieParser from 'cookie-parser';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { AUTH_COOKIE_NAME, AuthService } from '../src/auth/auth.service';
import { ALLOW_PENDING_KEY, IS_PUBLIC_KEY } from '../src/auth/decorators';
import { GoogleProfile } from '../src/auth/google.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
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
  // AC1 — first-user-admin, second-user-pending approval workflow
  // =========================================================================

  describe('AC1: approval workflow', () => {
    it('the FIRST-ever Google sign-in becomes admin + approved', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());

      expect(user.role).toBe(UserRole.admin);
      expect(user.status).toBe(UserStatus.approved);
    });

    it('the SECOND sign-in is a plain pending user, blocked from /api/items (403) but allowed /auth/me', async () => {
      await authService.upsertFromGoogleProfile(makeProfile());
      const pending = await authService.upsertFromGoogleProfile(makeProfile());

      expect(pending.role).toBe(UserRole.user);
      expect(pending.status).toBe(UserStatus.pending);

      const pendingHttp = wrapWithCookie(app, authService, pending);

      await pendingHttp.get('/api/items').expect(403);

      const meRes = await pendingHttp.get('/api/auth/me').expect(200);
      expect(meRes.body.id).toBe(pending.id);
      expect(meRes.body.status).toBe(UserStatus.pending);
    });

    it('after the admin approves the pending user, they are allowed through /api/items', async () => {
      const admin = await authService.upsertFromGoogleProfile(makeProfile());
      const pending = await authService.upsertFromGoogleProfile(makeProfile());

      const adminHttp = wrapWithCookie(app, authService, admin);
      await adminHttp
        .patch(`/api/users/${pending.id}/status`)
        .send({ status: UserStatus.approved })
        .expect(200);

      // Re-derive the client for `pending`'s id — JwtAuthGuard re-reads the
      // DB row by id on every request, so the JWT payload's stale
      // role/status never matter (see AuthService.getUserFromToken).
      const nowApprovedHttp = wrapWithCookie(app, authService, pending);
      await nowApprovedHttp.get('/api/items').expect(200);
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
});
