/**
 * Locations API — end-to-end integration tests (supertest + real PostgreSQL),
 * following the same convention as items.e2e-spec.ts and projects.e2e-spec.ts.
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts, so
 * they exercise the ACTUAL migration's DB-level foreign key behavior — this
 * is the round-3 review's TEST-COVERAGE finding: no test previously proved
 * `StockMovement.containerId` uses `onDelete: SetNull` (not `Cascade`) at the
 * database level; the unit-test mocks in stock-movements.service.spec.ts and
 * locations.service.spec.ts only simulate the *shape* Prisma would return
 * after the DB has already applied that rule.
 *
 * Coverage:
 *   - DB-level onDelete behavior (migration
 *     20260813120000_add_location_kind_and_container_movement): deleting a
 *     container Location preserves its StockMovement ledger rows, with
 *     `containerId` set to `null` (SetNull, not Cascade) — the "immutable
 *     audit trail" contract (EVT-25) surviving a later container deletion.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthedHttp, createAuthedHttp } from './e2e-auth-helper';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Locations API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: AuthedHttp;

  beforeAll(async () => {
    // Must be set BEFORE the NestJS module is compiled so PrismaClient uses
    // the test database connection string.
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
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);
    http = await createAuthedHttp(app, prisma, authService);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Clean all locations (and dependents) before each test so tests are isolated. */
  beforeEach(async () => {
    await prisma.stockMovement.deleteMany();
    await prisma.itemTag.deleteMany();
    await prisma.item.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.location.deleteMany();
    await prisma.category.deleteMany();
  });

  // =========================================================================
  // Cascade / SetNull — proved at the DB level, not mocked
  // =========================================================================

  describe('DB-level onDelete behavior (migration 20260813120000_add_location_kind_and_container_movement)', () => {
    it('deleting a container Location preserves its StockMovement ledger rows with containerId: null (onDelete: SetNull)', async () => {
      // ---- SET UP: an area, and a container underneath it ---------------------
      const areaRes = await http.post('/api/locations').send({ name: 'Garage' }).expect(201);
      const areaId = areaRes.body.id as string;

      const containerRes = await http
        .post('/api/locations')
        .send({ name: 'Red toolbox', parentId: areaId, kind: 'container' })
        .expect(201);
      const containerId = containerRes.body.id as string;
      expect(containerRes.body.kind).toBe('container');

      // ---- MOVE THE CONTAINER — records exactly one movement row --------------
      await http.post(`/api/locations/${containerId}/move`).send({ toParentId: null }).expect(201);

      const movementsBeforeDelete = await prisma.stockMovement.findMany({
        where: { containerId },
      });
      expect(movementsBeforeDelete).toHaveLength(1);
      const movementId = movementsBeforeDelete[0].id;
      expect(movementsBeforeDelete[0]).toMatchObject({
        containerId,
        itemId: null,
        kind: 'move',
        delta: 0,
        toLocationId: null,
      });

      // ---- DELETE THE CONTAINER (now parentless, so it has no children) -------
      await http.delete(`/api/locations/${containerId}`).expect(204);
      await http.get(`/api/locations/${containerId}`).expect(404);

      // ---- THE MOVEMENT ROW SURVIVES — containerId is SET NULL, not cascaded --
      // If `StockMovement.container` used `onDelete: Cascade` (as `item` does),
      // this row would be gone entirely, silently erasing a slice of the
      // audit trail. The migration deliberately uses `SetNull` instead (EVT-30
      // review round 2, finding 4) — proved here at the real Postgres FK
      // level, not via a Prisma mock.
      const movementAfterDelete = await prisma.stockMovement.findUnique({
        where: { id: movementId },
      });
      expect(movementAfterDelete).not.toBeNull();
      expect(movementAfterDelete?.containerId).toBeNull();
      // The denormalized note is the only remaining human-readable trace of
      // which container this row was about, once containerId is nulled out.
      expect(movementAfterDelete?.note).toContain('Red toolbox');
    });
  });
});
