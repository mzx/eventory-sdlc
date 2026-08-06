/**
 * Projects + BOM API — end-to-end integration tests (supertest + real
 * PostgreSQL), following the same convention as items.e2e-spec.ts and
 * photos.e2e-spec.ts.
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts, so
 * they exercise the ACTUAL migration's DB-level foreign key behavior — this
 * is the round-2 review's headline finding: no test previously proved
 * `onDelete: Cascade` (Project → BomLine) or `onDelete: SetNull`
 * (Item → BomLine.itemId) at the database level; the unit-test mocks in
 * projects.service.spec.ts only simulate the *shape* Prisma would return
 * after the DB has already applied those rules.
 *
 * Coverage:
 *   - Core CRUD: create → list → findOne → update → delete a project
 *   - Add-line-from-item name-copy flow (itemId provided → name copied,
 *     any `name` in the body ignored)
 *   - AC 3 — deleting the linked Item leaves the BOM line with its copied
 *     name and itemId null, enforced by the migration's `onDelete: SetNull`
 *     foreign key, NOT by application code
 *   - Deleting a Project cascades (deletes) its BOM lines, enforced by the
 *     migration's `onDelete: Cascade` foreign key
 *   - Validation: empty-string startedAt/completedAt clears the field
 *     end-to-end through the real HTTP + ValidationPipe + Prisma stack
 *   - Validation: itemId: null unlinks a BOM line via PATCH
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Projects + BOM API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof supertest>;

  beforeAll(async () => {
    // Must be set BEFORE the NestJS module is compiled so PrismaClient uses
    // the test database connection string.
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    http = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  /** Clean all projects/items before each test so tests are isolated. */
  beforeEach(async () => {
    await prisma.bomLine.deleteMany();
    await prisma.project.deleteMany();
    await prisma.itemTag.deleteMany();
    await prisma.item.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.location.deleteMany();
    await prisma.category.deleteMany();
  });

  // =========================================================================
  // Core CRUD + add-line-from-item name-copy flow
  // =========================================================================

  describe('core CRUD + add-line-from-item name-copy flow', () => {
    it('completes create → list → findOne → update → add linked line → delete', async () => {
      // ---- CREATE PROJECT ---------------------------------------------------
      const createRes = await http
        .post('/api/projects')
        .send({ name: 'Garage workbench', description: 'Build a workbench' })
        .expect(201);
      const project = createRes.body;
      expect(project.id).toBeDefined();
      expect(project.status).toBe('planned');
      const projectId = project.id as string;

      // ---- LIST ---------------------------------------------------------------
      const listRes = await http.get('/api/projects').expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toMatchObject({ id: projectId, lineCount: 0 });

      // ---- CREATE AN INVENTORY ITEM TO LINK ------------------------------------
      const itemRes = await http.post('/api/items').send({ name: 'Cordless Drill' }).expect(201);
      const itemId = itemRes.body.id as string;

      // ---- ADD A LINKED BOM LINE (name copied from item, body name ignored) ----
      const addLineRes = await http
        .post(`/api/projects/${projectId}/bom`)
        .send({ itemId, name: 'Wrong name should be ignored', quantity: 2, unit: 'pcs' })
        .expect(201);
      expect(addLineRes.body.name).toBe('Cordless Drill');
      expect(addLineRes.body.itemId).toBe(itemId);
      expect(addLineRes.body.item).toMatchObject({ id: itemId, name: 'Cordless Drill' });
      const lineId = addLineRes.body.id as string;

      // ---- ADD A FREE-TEXT BOM LINE ---------------------------------------------
      await http
        .post(`/api/projects/${projectId}/bom`)
        .send({ name: '2x4 lumber', quantity: 4 })
        .expect(201);

      // ---- FIND ONE — BOM lines with linked item summary -------------------------
      const findRes = await http.get(`/api/projects/${projectId}`).expect(200);
      expect(findRes.body.bomLines).toHaveLength(2);

      // ---- UPDATE PROJECT SCALAR FIELDS -------------------------------------------
      const updateRes = await http
        .patch(`/api/projects/${projectId}`)
        .send({ status: 'in_progress' })
        .expect(200);
      expect(updateRes.body.status).toBe('in_progress');

      // ---- UPDATE BOM LINE (quantity/unit) -------------------------------------
      const updateLineRes = await http
        .patch(`/api/projects/${projectId}/bom/${lineId}`)
        .send({ quantity: 3 })
        .expect(200);
      expect(updateLineRes.body.quantity).toBe(3);

      // ---- LIST NOW SHOWS lineCount = 2 -------------------------------------------
      const listAfter = await http.get('/api/projects').expect(200);
      expect(listAfter.body[0].lineCount).toBe(2);

      // ---- DELETE THE PROJECT ---------------------------------------------------
      await http.delete(`/api/projects/${projectId}`).expect(204);
      await http.get(`/api/projects/${projectId}`).expect(404);
    });
  });

  // =========================================================================
  // Cascade / SetNull — proved at the DB level, not mocked
  // =========================================================================

  describe('DB-level onDelete behavior (migration 20260806131854_feat_projects_bom)', () => {
    it('deleting a Project cascades and deletes its BOM lines (onDelete: Cascade)', async () => {
      const project = await prisma.project.create({ data: { name: 'Deck build' } });
      const line1 = await prisma.bomLine.create({
        data: { projectId: project.id, name: 'Deck boards', quantity: 20 },
      });
      const line2 = await prisma.bomLine.create({
        data: { projectId: project.id, name: 'Joist hangers', quantity: 12 },
      });

      // Sanity: lines exist before delete.
      expect(await prisma.bomLine.findUnique({ where: { id: line1.id } })).not.toBeNull();
      expect(await prisma.bomLine.findUnique({ where: { id: line2.id } })).not.toBeNull();

      await http.delete(`/api/projects/${project.id}`).expect(204);

      // Both BOM lines must be gone — proves the FK's ON DELETE CASCADE,
      // not any application-level cleanup code (ProjectsService.remove()
      // only calls prisma.project.delete()).
      expect(await prisma.bomLine.findUnique({ where: { id: line1.id } })).toBeNull();
      expect(await prisma.bomLine.findUnique({ where: { id: line2.id } })).toBeNull();
      expect(await prisma.bomLine.count({ where: { projectId: project.id } })).toBe(0);
    });

    it('deleting a linked Item leaves the BOM line with its copied name and itemId null (AC 3, onDelete: SetNull)', async () => {
      const itemRes = await http.post('/api/items').send({ name: 'Torque Wrench' }).expect(201);
      const itemId = itemRes.body.id as string;

      const projectRes = await http.post('/api/projects').send({ name: 'Engine rebuild' });
      const projectId = projectRes.body.id as string;

      const lineRes = await http
        .post(`/api/projects/${projectId}/bom`)
        .send({ itemId, quantity: 1 })
        .expect(201);
      const lineId = lineRes.body.id as string;
      expect(lineRes.body.name).toBe('Torque Wrench');
      expect(lineRes.body.itemId).toBe(itemId);

      // Delete the linked inventory item directly (not through the BOM API).
      await http.delete(`/api/items/${itemId}`).expect(204);

      // The BOM line still exists — itemId is SET NULL, name is untouched
      // because it was denormalized (copied) at link time, not looked up
      // live from the (now-deleted) Item row.
      const line = await prisma.bomLine.findUnique({ where: { id: lineId } });
      expect(line).not.toBeNull();
      expect(line?.itemId).toBeNull();
      expect(line?.name).toBe('Torque Wrench');

      // Same assertion through the HTTP API's findOne, which is what the
      // web UI actually renders.
      const findRes = await http.get(`/api/projects/${projectId}`).expect(200);
      const returnedLine = findRes.body.bomLines.find((l: { id: string }) => l.id === lineId);
      expect(returnedLine).toMatchObject({ itemId: null, name: 'Torque Wrench', item: null });
    });
  });

  // =========================================================================
  // Validation — empty-string date clearing (round-2 major finding)
  // =========================================================================

  describe('PATCH /projects/:id — startedAt/completedAt empty-string clearing', () => {
    it('clears startedAt when patched with an empty string (previously 400)', async () => {
      const createRes = await http
        .post('/api/projects')
        .send({ name: 'Kitchen remodel', startedAt: '2026-01-15T00:00:00.000Z' })
        .expect(201);
      expect(createRes.body.startedAt).not.toBeNull();
      const projectId = createRes.body.id as string;

      const patchRes = await http
        .patch(`/api/projects/${projectId}`)
        .send({ startedAt: '' })
        .expect(200);
      expect(patchRes.body.startedAt).toBeNull();
    });

    it('clears completedAt when patched with an empty string (previously 400)', async () => {
      const createRes = await http
        .post('/api/projects')
        .send({ name: 'Bathroom remodel', completedAt: '2026-02-01T00:00:00.000Z' })
        .expect(201);
      const projectId = createRes.body.id as string;

      const patchRes = await http
        .patch(`/api/projects/${projectId}`)
        .send({ completedAt: '' })
        .expect(200);
      expect(patchRes.body.completedAt).toBeNull();
    });

    it('still rejects a non-empty, invalid date string with 400', async () => {
      const createRes = await http.post('/api/projects').send({ name: 'Fence repair' }).expect(201);
      const projectId = createRes.body.id as string;

      await http.patch(`/api/projects/${projectId}`).send({ startedAt: 'not-a-date' }).expect(400);
    });
  });

  // =========================================================================
  // Validation — unlink a BOM line via itemId: null (round-2 minor finding)
  // =========================================================================

  describe('PATCH /projects/:id/bom/:lineId — itemId: null unlinks', () => {
    it('unlinks a BOM line, keeping its copied name, and setting item to null', async () => {
      const itemRes = await http.post('/api/items').send({ name: 'Impact Driver' }).expect(201);
      const itemId = itemRes.body.id as string;

      const projectRes = await http.post('/api/projects').send({ name: 'Deck build' });
      const projectId = projectRes.body.id as string;

      const lineRes = await http
        .post(`/api/projects/${projectId}/bom`)
        .send({ itemId })
        .expect(201);
      const lineId = lineRes.body.id as string;
      expect(lineRes.body.itemId).toBe(itemId);

      const unlinkRes = await http
        .patch(`/api/projects/${projectId}/bom/${lineId}`)
        .send({ itemId: null })
        .expect(200);

      expect(unlinkRes.body.itemId).toBeNull();
      expect(unlinkRes.body.item).toBeNull();
      expect(unlinkRes.body.name).toBe('Impact Driver');

      // The underlying inventory item is untouched by the unlink.
      await http.get(`/api/items/${itemId}`).expect(200);
    });
  });
});
