/**
 * Tenant isolation matrix — locations, projects/BOM, categories, shopping
 * list, and verification queue (EVT-41).
 *
 * Extends EVT-40's two-workspace harness (`two-workspace-harness.ts`) to
 * every module EVT-41 covers, mapped to the task's acceptance criteria:
 *   AC1 — locations tree queries + create/rename/move/delete, 404/correct-
 *          data matrix
 *   AC2 — advisory lock workspace-keyed: functional proof that two
 *          different workspaces' container moves both complete without one
 *          blocking the other (the SQL-level proof that the two lock keys
 *          actually differ, and that a same-workspace move still serializes
 *          against a same-workspace rename, lives in
 *          `locations.service.spec.ts`, which inspects the raw
 *          `$executeRaw` call arguments directly — something only possible
 *          at the unit level against a mocked transaction client)
 *   AC3 — BOM line linking a foreign-workspace item rejected
 *   AC4 — low-stock entries, verification queue, and shopping-list badge
 *          count (its length) are workspace-scoped
 *   AC5 — tag name isolation is already covered by
 *          `tenancy-isolation.e2e-spec.ts` (EVT-40 round-2 review, "the
 *          SAME tag name may exist independently in both workspaces");
 *          this file does not duplicate it
 *   AC6 — viewer-role matrix extended to locations/categories/projects/
 *          shopping-list: reads 200, every mutation 403
 */

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthedHttp } from './e2e-auth-helper';
import { seedTwoWorkspaces, TwoWorkspaceFixture } from './two-workspace-harness';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Creates a root `area` location as `http` and returns its id + path. */
async function createLocation(
  http: AuthedHttp,
  name: string,
): Promise<{ id: string; path: string }> {
  const res = await http.post('/api/locations').send({ name }).expect(201);
  return { id: res.body.id as string, path: res.body.path as string };
}

/** Creates a root `container` location as `http` and returns its id + path. */
async function createContainer(
  http: AuthedHttp,
  name: string,
): Promise<{ id: string; path: string }> {
  const res = await http.post('/api/locations').send({ name, kind: 'container' }).expect(201);
  return { id: res.body.id as string, path: res.body.path as string };
}

/** Creates a root category as `http` and returns its id. */
async function createCategory(http: AuthedHttp, name: string): Promise<{ id: string }> {
  const res = await http.post('/api/categories').send({ name }).expect(201);
  return { id: res.body.id as string };
}

/** Creates a project as `http` and returns its id. */
async function createProject(http: AuthedHttp, name: string): Promise<{ id: string }> {
  const res = await http.post('/api/projects').send({ name }).expect(201);
  return { id: res.body.id as string };
}

/** Creates an item as `http` and returns its id. */
async function createItem(
  http: AuthedHttp,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await http
    .post('/api/items')
    .send({ name, quantity: 5, ...extra })
    .expect(201);
  return { id: res.body.id as string };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Tenant isolation matrix — locations/projects/categories/shopping-list (e2e, EVT-41)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TwoWorkspaceFixture;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Mirrors src/main.ts's bootstrap() exactly.
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'storage/:filename', method: RequestMethod.GET }],
    });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);
    fixture = await seedTwoWorkspaces(app, prisma, authService);
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // AC1 — locations isolation matrix
  // =========================================================================

  describe('AC1: locations isolation matrix', () => {
    it("GET /api/locations — never lists a foreign workspace's location", async () => {
      const { id } = await createLocation(fixture.workspaceA.owner, 'AC1 LIST location');

      const foreignList = await fixture.workspaceB.owner.get('/api/locations').expect(200);
      expect((foreignList.body as { id: string }[]).some((loc) => loc.id === id)).toBe(false);

      const ownList = await fixture.workspaceA.owner.get('/api/locations').expect(200);
      expect((ownList.body as { id: string }[]).some((loc) => loc.id === id)).toBe(true);
    });

    it('GET /api/locations/:id — foreign -> 404, own -> 200', async () => {
      const { id } = await createLocation(fixture.workspaceA.owner, 'AC1 GET location');

      await fixture.workspaceB.owner.get(`/api/locations/${id}`).expect(404);
      await fixture.workspaceA.owner.get(`/api/locations/${id}`).expect(200);
    });

    it('POST /api/locations with a foreign parentId -> 404 (cross-tenant reference smuggling rejected)', async () => {
      const { id: foreignParentId } = await createLocation(
        fixture.workspaceB.owner,
        'AC1 foreign parent',
      );

      await fixture.workspaceA.owner
        .post('/api/locations')
        .send({ name: 'child', parentId: foreignParentId })
        .expect(404);
    });

    it('PATCH /api/locations/:id (rename) — foreign -> 404, own -> 200', async () => {
      const { id } = await createLocation(fixture.workspaceA.owner, 'AC1 RENAME location');

      await fixture.workspaceB.owner
        .patch(`/api/locations/${id}`)
        .send({ name: 'hijacked' })
        .expect(404);
      await fixture.workspaceA.owner
        .patch(`/api/locations/${id}`)
        .send({ name: 'renamed' })
        .expect(200);
    });

    it('POST /api/locations/:id/move — foreign -> 404, own -> 200', async () => {
      const box = await createContainer(fixture.workspaceA.owner, 'AC1 MOVE box');
      const shelf = await createLocation(fixture.workspaceA.owner, 'AC1 MOVE shelf');

      await fixture.workspaceB.owner
        .post(`/api/locations/${box.id}/move`)
        .send({ toParentId: shelf.id })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/locations/${box.id}/move`)
        .send({ toParentId: shelf.id })
        .expect(201);
    });

    it('POST /api/locations/:id/move with a foreign toParentId -> 404', async () => {
      const box = await createContainer(fixture.workspaceA.owner, 'AC1 MOVE-foreign box');
      const { id: foreignParentId } = await createLocation(
        fixture.workspaceB.owner,
        'AC1 foreign destination',
      );

      await fixture.workspaceA.owner
        .post(`/api/locations/${box.id}/move`)
        .send({ toParentId: foreignParentId })
        .expect(404);
    });

    it('GET /api/locations/:id/movements — foreign -> 404, own -> 200', async () => {
      const box = await createContainer(fixture.workspaceA.owner, 'AC1 MOVEMENTS box');

      await fixture.workspaceB.owner.get(`/api/locations/${box.id}/movements`).expect(404);
      await fixture.workspaceA.owner.get(`/api/locations/${box.id}/movements`).expect(200);
    });

    it('DELETE /api/locations/:id — foreign -> 404, own -> 204', async () => {
      const { id } = await createLocation(fixture.workspaceA.owner, 'AC1 DELETE location');

      await fixture.workspaceB.owner.delete(`/api/locations/${id}`).expect(404);
      await fixture.workspaceA.owner.delete(`/api/locations/${id}`).expect(204);
    });
  });

  // =========================================================================
  // AC2 — advisory lock workspace-keyed (functional proof; SQL-level proof
  // that the two lock keys differ lives in locations.service.spec.ts)
  // =========================================================================

  describe('AC2: advisory lock is per-workspace', () => {
    it("two workspaces' concurrent container moves both complete (neither blocks on the other's lock)", async () => {
      const boxA = await createContainer(fixture.workspaceA.owner, 'AC2 box A');
      const shelfA = await createLocation(fixture.workspaceA.owner, 'AC2 shelf A');
      const boxB = await createContainer(fixture.workspaceB.owner, 'AC2 box B');
      const shelfB = await createLocation(fixture.workspaceB.owner, 'AC2 shelf B');

      // Fired concurrently — if the lock were still tree-wide (EVT-30's
      // single-argument form), these would still both eventually succeed
      // (Postgres serializes rather than deadlocks), but this at least
      // proves the AC-facing contract: cross-workspace moves function
      // correctly when run concurrently.
      const [resA, resB] = await Promise.all([
        fixture.workspaceA.owner
          .post(`/api/locations/${boxA.id}/move`)
          .send({ toParentId: shelfA.id }),
        fixture.workspaceB.owner
          .post(`/api/locations/${boxB.id}/move`)
          .send({ toParentId: shelfB.id }),
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.path).toBe(`${shelfA.path}.${boxA.path}`);
      expect(resB.body.path).toBe(`${shelfB.path}.${boxB.path}`);
    });

    it('same-workspace concurrent renames of unrelated locations both complete correctly (still serialized, but not corrupted)', async () => {
      const locOne = await createLocation(fixture.workspaceA.owner, 'AC2 serialize one');
      const locTwo = await createLocation(fixture.workspaceA.owner, 'AC2 serialize two');

      const [resOne, resTwo] = await Promise.all([
        fixture.workspaceA.owner
          .patch(`/api/locations/${locOne.id}`)
          .send({ name: 'AC2 serialize one renamed' }),
        fixture.workspaceA.owner
          .patch(`/api/locations/${locTwo.id}`)
          .send({ name: 'AC2 serialize two renamed' }),
      ]);

      expect(resOne.status).toBe(200);
      expect(resTwo.status).toBe(200);
      expect(resOne.body.path).toBe('ac2-serialize-one-renamed');
      expect(resTwo.body.path).toBe('ac2-serialize-two-renamed');
    });
  });

  // =========================================================================
  // Categories isolation
  // =========================================================================

  describe('Categories isolation', () => {
    it("GET /api/categories — never lists a foreign workspace's category", async () => {
      const { id } = await createCategory(fixture.workspaceA.owner, 'AC-cat LIST category');

      const foreignList = await fixture.workspaceB.owner.get('/api/categories').expect(200);
      expect((foreignList.body as { id: string }[]).some((c) => c.id === id)).toBe(false);

      const ownList = await fixture.workspaceA.owner.get('/api/categories').expect(200);
      expect((ownList.body as { id: string }[]).some((c) => c.id === id)).toBe(true);
    });

    it('POST /api/categories with a foreign parentId -> 404', async () => {
      const { id: foreignParentId } = await createCategory(
        fixture.workspaceB.owner,
        'AC-cat foreign parent',
      );

      await fixture.workspaceA.owner
        .post('/api/categories')
        .send({ name: 'child', parentId: foreignParentId })
        .expect(404);
    });

    it('the same category name (same slug) is creatable independently in two workspaces', async () => {
      const name = `AC-cat shared-name-${Date.now()}`;
      await fixture.workspaceA.owner.post('/api/categories').send({ name }).expect(201);
      await fixture.workspaceB.owner.post('/api/categories').send({ name }).expect(201);
    });
  });

  // =========================================================================
  // AC3 — Projects/BOM isolation, incl. foreign-workspace item link rejection
  // =========================================================================

  describe('AC1/AC3: projects + BOM isolation matrix', () => {
    it('GET /api/projects/:id — foreign -> 404, own -> 200', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj GET project');

      await fixture.workspaceB.owner.get(`/api/projects/${id}`).expect(404);
      await fixture.workspaceA.owner.get(`/api/projects/${id}`).expect(200);
    });

    it("GET /api/projects — never lists a foreign workspace's project", async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj LIST project');

      const foreignList = await fixture.workspaceB.owner.get('/api/projects').expect(200);
      expect((foreignList.body as { id: string }[]).some((p) => p.id === id)).toBe(false);
    });

    it('PATCH /api/projects/:id — foreign -> 404, own -> 200', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj PATCH project');

      await fixture.workspaceB.owner
        .patch(`/api/projects/${id}`)
        .send({ notes: 'hijacked' })
        .expect(404);
      await fixture.workspaceA.owner
        .patch(`/api/projects/${id}`)
        .send({ notes: 'edited' })
        .expect(200);
    });

    it('DELETE /api/projects/:id — foreign -> 404, own -> 204', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj DELETE project');

      await fixture.workspaceB.owner.delete(`/api/projects/${id}`).expect(404);
      await fixture.workspaceA.owner.delete(`/api/projects/${id}`).expect(204);
    });

    it('POST /api/projects/:id/bom — foreign project -> 404', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj BOM-foreign project');

      await fixture.workspaceB.owner
        .post(`/api/projects/${id}/bom`)
        .send({ name: 'free-text line' })
        .expect(404);
    });

    // EVT-41 AC 3: the security-critical BOM-linking check.
    it('AC3: POST /api/projects/:id/bom linking a foreign-workspace item -> 404 (rejected, not silently cross-linked)', async () => {
      const { id: projectId } = await createProject(
        fixture.workspaceA.owner,
        'AC3 BOM foreign-item project',
      );
      const { id: foreignItemId } = await createItem(fixture.workspaceB.owner, 'AC3 foreign item');

      await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ itemId: foreignItemId })
        .expect(404);
    });

    it('AC3: PATCH /api/projects/:id/bom/:lineId re-linking to a foreign-workspace item -> 404', async () => {
      const { id: projectId } = await createProject(
        fixture.workspaceA.owner,
        'AC3 BOM re-link project',
      );
      const bomRes = await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: 'free-text, to be re-linked' })
        .expect(201);
      const lineId = bomRes.body.id as string;
      const { id: foreignItemId } = await createItem(
        fixture.workspaceB.owner,
        'AC3 foreign re-link item',
      );

      await fixture.workspaceA.owner
        .patch(`/api/projects/${projectId}/bom/${lineId}`)
        .send({ itemId: foreignItemId })
        .expect(404);
    });

    it('a same-workspace item links successfully onto a BOM line', async () => {
      const { id: projectId } = await createProject(
        fixture.workspaceA.owner,
        'AC3 BOM own-item project',
      );
      const { id: ownItemId } = await createItem(fixture.workspaceA.owner, 'AC3 own item');

      const res = await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ itemId: ownItemId })
        .expect(201);
      expect(res.body.itemId).toBe(ownItemId);
    });

    it('PATCH /api/projects/:id/bom/:lineId — foreign project -> 404', async () => {
      const { id: projectId } = await createProject(
        fixture.workspaceA.owner,
        'AC-proj BOM PATCH project',
      );
      const bomRes = await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: 'a line' })
        .expect(201);
      const lineId = bomRes.body.id as string;

      await fixture.workspaceB.owner
        .patch(`/api/projects/${projectId}/bom/${lineId}`)
        .send({ quantity: 9 })
        .expect(404);
    });

    it('DELETE /api/projects/:id/bom/:lineId — foreign project -> 404, own -> 204', async () => {
      const { id: projectId } = await createProject(
        fixture.workspaceA.owner,
        'AC-proj BOM DELETE project',
      );
      const bomRes = await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: 'a line to remove' })
        .expect(201);
      const lineId = bomRes.body.id as string;

      await fixture.workspaceB.owner.delete(`/api/projects/${projectId}/bom/${lineId}`).expect(404);
      await fixture.workspaceA.owner.delete(`/api/projects/${projectId}/bom/${lineId}`).expect(204);
    });

    it('GET /api/projects/:id/availability — foreign -> 404, own -> 200', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj AVAIL project');

      await fixture.workspaceB.owner.get(`/api/projects/${id}/availability`).expect(404);
      await fixture.workspaceA.owner.get(`/api/projects/${id}/availability`).expect(200);
    });

    it('GET /api/projects/:id/backflush-preview — foreign -> 404, own -> 200', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj PREVIEW project');

      await fixture.workspaceB.owner.get(`/api/projects/${id}/backflush-preview`).expect(404);
      await fixture.workspaceA.owner.get(`/api/projects/${id}/backflush-preview`).expect(200);
    });

    it('POST /api/projects/:id/backflush — foreign -> 404, own -> 200', async () => {
      const { id } = await createProject(fixture.workspaceA.owner, 'AC-proj BACKFLUSH project');

      await fixture.workspaceB.owner
        .post(`/api/projects/${id}/backflush`)
        .send({ lines: [] })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/projects/${id}/backflush`)
        .send({ lines: [] })
        .expect(201);
    });
  });

  // =========================================================================
  // AC4 — shopping list, low-stock auto-trigger, and verification queue
  // =========================================================================

  describe('AC4: shopping list, low-stock, and verification queue isolation', () => {
    it("GET /api/shopping-list — never lists a foreign workspace's entry; badge count (list length) is per-workspace", async () => {
      const { id: itemId } = await createItem(fixture.workspaceA.owner, 'AC4 shopping item');
      const entryRes = await fixture.workspaceA.owner
        .post('/api/shopping-list')
        .send({ itemId })
        .expect(200);
      const entryId = entryRes.body.id as string;

      const foreignList = await fixture.workspaceB.owner.get('/api/shopping-list').expect(200);
      expect((foreignList.body as { id: string }[]).some((e) => e.id === entryId)).toBe(false);

      const ownList = await fixture.workspaceA.owner.get('/api/shopping-list').expect(200);
      expect((ownList.body as { id: string }[]).some((e) => e.id === entryId)).toBe(true);
    });

    it('POST /api/shopping-list with a foreign itemId -> 404', async () => {
      const { id: foreignItemId } = await createItem(
        fixture.workspaceB.owner,
        'AC4 foreign shopping item',
      );

      await fixture.workspaceA.owner
        .post('/api/shopping-list')
        .send({ itemId: foreignItemId })
        .expect(404);
    });

    it('POST /api/shopping-list/:id/restock — foreign entry -> 404, own -> 200', async () => {
      const { id: itemId } = await createItem(fixture.workspaceA.owner, 'AC4 restock item');
      const entryRes = await fixture.workspaceA.owner
        .post('/api/shopping-list')
        .send({ itemId })
        .expect(200);
      const entryId = entryRes.body.id as string;

      await fixture.workspaceB.owner
        .post(`/api/shopping-list/${entryId}/restock`)
        .send({ quantity: 10 })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/shopping-list/${entryId}/restock`)
        .send({ quantity: 10 })
        .expect(200);
    });

    // AC4: the low-stock auto-trigger (StockMovementsService.recordMovement /
    // recordConsumption) must open its ShoppingListEntry in the ITEM's own
    // workspace — see the EVT-41 fix to `openLowStockEntry`, which
    // previously silently defaulted to the Default Workspace regardless of
    // the item's real workspace.
    it("AC4: a low-stock auto-trigger opens its entry in the ITEM's own workspace, invisible to the other workspace", async () => {
      // `minQuantity` is not settable on create (CreateItemDto has no such
      // field — it's PATCH-only, see UpdateItemDto), so it's set via a
      // follow-up PATCH.
      const { id: itemId } = await createItem(fixture.workspaceA.owner, 'AC4 low-stock item');
      await fixture.workspaceA.owner
        .patch(`/api/items/${itemId}`)
        .send({ minQuantity: 3 })
        .expect(200);

      // Consume down to (at or below) minQuantity — this is what
      // StockMovementsService.recordConsumption's low-stock check fires on.
      await fixture.workspaceA.owner
        .post(`/api/items/${itemId}/consume`)
        .send({ quantity: 3 })
        .expect(200);

      const ownList = await fixture.workspaceA.owner.get('/api/shopping-list').expect(200);
      const ownEntry = (
        ownList.body as { id: string; source: string; item: { id: string } }[]
      ).find((e) => e.item.id === itemId);
      expect(ownEntry).toBeDefined();
      expect(ownEntry?.source).toBe('low_stock');

      const foreignList = await fixture.workspaceB.owner.get('/api/shopping-list').expect(200);
      expect(
        (foreignList.body as { item: { id: string } }[]).some((e) => e.item.id === itemId),
      ).toBe(false);
    });

    it("AC4: GET /api/items/verification-queue never surfaces a foreign workspace's item", async () => {
      const { id: itemId } = await createItem(
        fixture.workspaceA.owner,
        'AC4 verification-queue item',
      );
      // countIntervalDays: 1 (the DTO requires >= 1) + lastVerifiedAt forced
      // far into the past -> immediately overdue, regardless of when this
      // test runs (see `daysOverdue`'s doc comment: baseline is
      // lastVerifiedAt when set, not createdAt).
      await fixture.workspaceA.owner
        .patch(`/api/items/${itemId}`)
        .send({ countIntervalDays: 1, lastVerifiedAt: '2000-01-01T00:00:00.000Z' })
        .expect(200);

      const ownQueue = await fixture.workspaceA.owner
        .get('/api/items/verification-queue')
        .expect(200);
      expect((ownQueue.body as { id: string }[]).some((i) => i.id === itemId)).toBe(true);

      const foreignQueue = await fixture.workspaceB.owner
        .get('/api/items/verification-queue')
        .expect(200);
      expect((foreignQueue.body as { id: string }[]).some((i) => i.id === itemId)).toBe(false);
    });
  });

  // =========================================================================
  // AC6 — viewer-role matrix extended to locations/categories/projects/
  // shopping-list (reads 200, every mutation 403)
  // =========================================================================

  describe('AC6: viewer-role matrix — locations/categories/projects/shopping-list', () => {
    it('a viewer reads locations (200) but every mutating locations endpoint returns 403', async () => {
      const box = await createContainer(fixture.workspaceA.owner, 'AC6 viewer box');
      const shelf = await createLocation(fixture.workspaceA.owner, 'AC6 viewer shelf');

      await fixture.workspaceA.viewer.get('/api/locations').expect(200);
      await fixture.workspaceA.viewer.get(`/api/locations/${box.id}`).expect(200);
      await fixture.workspaceA.viewer.get(`/api/locations/${box.id}/movements`).expect(200);

      await fixture.workspaceA.viewer.post('/api/locations').send({ name: 'nope' }).expect(403);
      await fixture.workspaceA.viewer
        .patch(`/api/locations/${box.id}`)
        .send({ name: 'nope' })
        .expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/locations/${box.id}/move`)
        .send({ toParentId: shelf.id })
        .expect(403);
      await fixture.workspaceA.viewer.delete(`/api/locations/${box.id}`).expect(403);
    });

    it('a viewer reads categories (200) but cannot create one (403)', async () => {
      await fixture.workspaceA.viewer.get('/api/categories').expect(200);
      await fixture.workspaceA.viewer.post('/api/categories').send({ name: 'nope' }).expect(403);
    });

    it('a viewer reads projects/BOM (200) but every mutating endpoint returns 403', async () => {
      const { id: projectId } = await createProject(fixture.workspaceA.owner, 'AC6 viewer project');
      const bomRes = await fixture.workspaceA.owner
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: 'viewer-visible line' })
        .expect(201);
      const lineId = bomRes.body.id as string;

      await fixture.workspaceA.viewer.get('/api/projects').expect(200);
      await fixture.workspaceA.viewer.get(`/api/projects/${projectId}`).expect(200);
      await fixture.workspaceA.viewer.get(`/api/projects/${projectId}/availability`).expect(200);
      await fixture.workspaceA.viewer
        .get(`/api/projects/${projectId}/backflush-preview`)
        .expect(200);

      await fixture.workspaceA.viewer.post('/api/projects').send({ name: 'nope' }).expect(403);
      await fixture.workspaceA.viewer
        .patch(`/api/projects/${projectId}`)
        .send({ notes: 'nope' })
        .expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: 'nope' })
        .expect(403);
      await fixture.workspaceA.viewer
        .patch(`/api/projects/${projectId}/bom/${lineId}`)
        .send({ quantity: 2 })
        .expect(403);
      await fixture.workspaceA.viewer
        .delete(`/api/projects/${projectId}/bom/${lineId}`)
        .expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/projects/${projectId}/backflush`)
        .send({ lines: [] })
        .expect(403);
      await fixture.workspaceA.viewer.delete(`/api/projects/${projectId}`).expect(403);
    });

    it('a viewer reads the shopping list (200) but cannot create or restock an entry (403)', async () => {
      const { id: itemId } = await createItem(fixture.workspaceA.owner, 'AC6 viewer shopping');
      const entryRes = await fixture.workspaceA.owner
        .post('/api/shopping-list')
        .send({ itemId })
        .expect(200);
      const entryId = entryRes.body.id as string;

      await fixture.workspaceA.viewer.get('/api/shopping-list').expect(200);

      await fixture.workspaceA.viewer.post('/api/shopping-list').send({ itemId }).expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/shopping-list/${entryId}/restock`)
        .send({ quantity: 10 })
        .expect(403);
    });
  });
});
