/**
 * Shopping List / min-level replenishment — end-to-end integration tests
 * (supertest + real PostgreSQL, EVT-26).
 *
 * Runs against the real Docker Postgres container (see global-setup.ts) so
 * the partial unique index added by the EVT-26 migration — the actual
 * mechanism guaranteeing "at most one open entry per item" — is exercised
 * for real, not just simulated via a mocked Prisma client.
 *
 * Coverage:
 *   AC1 — the migration's partial unique index rejects a second concurrent
 *          open row for the same item at the DB level
 *   AC2 — a movement dropping quantity to <= minQuantity opens exactly one
 *          low-stock entry; a further drop does not duplicate it
 *   AC3 — the "Running low" one-tap manual trigger is idempotent
 *   AC4 — GET /api/shopping-list lists open entries with item/location shape
 *   AC5 — restock records an "add" movement and closes the entry
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthedHttp, createAuthedHttp } from './e2e-auth-helper';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

describe('Shopping List API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: AuthedHttp;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);
    http = await createAuthedHttp(app, prisma, authService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.shoppingListEntry.deleteMany();
    await prisma.stockMovement.deleteMany();
    await prisma.itemTag.deleteMany();
    await prisma.item.deleteMany();
    await prisma.location.deleteMany();
  });

  // =========================================================================
  // AC 2 — auto-trigger + idempotency
  // =========================================================================

  describe('AC2: low-stock auto-trigger', () => {
    it('a movement dropping quantity to <= minQuantity opens exactly one open low-stock entry, and a further drop does not duplicate it', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Box of M3 Screws', quantity: 10 })
        .expect(201);
      const itemId = createRes.body.id as string;
      // minQuantity is set via PATCH — CreateItemDto deliberately doesn't
      // accept it (EVT-26 scope: set the threshold once the item exists).
      await http.patch(`/api/items/${itemId}`).send({ minQuantity: 5 }).expect(200);

      // Drop to exactly minQuantity (10 -> 5) — should open one entry.
      await http.patch(`/api/items/${itemId}`).send({ quantity: 5 }).expect(200);

      let listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0]).toMatchObject({ itemId, status: 'open', source: 'low_stock' });

      // Drop further (5 -> 2) — must NOT create a second open entry.
      await http.patch(`/api/items/${itemId}`).send({ quantity: 2 }).expect(200);

      listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].item.quantity).toBe(2);

      // The DB-level invariant: at most one OPEN row for this item, ever.
      const openRows = await prisma.shoppingListEntry.findMany({
        where: { itemId, status: 'open' },
      });
      expect(openRows).toHaveLength(1);
    });

    it('does not trigger when the item has no minQuantity set', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Untracked Widget', quantity: 3 })
        .expect(201);
      const itemId = createRes.body.id as string;

      await http.patch(`/api/items/${itemId}`).send({ quantity: 0 }).expect(200);

      const listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(0);
    });
  });

  // =========================================================================
  // AC 1 — partial unique index (DB-level invariant)
  // =========================================================================

  describe('AC1: partial unique index — at most one open entry per item', () => {
    it('rejects a second concurrent OPEN row for the same item at the DB level', async () => {
      const createRes = await http.post('/api/items').send({ name: 'Fasteners' }).expect(201);
      const itemId = createRes.body.id as string;

      await prisma.shoppingListEntry.create({
        data: { itemId, status: 'open', source: 'manual' },
      });

      await expect(
        prisma.shoppingListEntry.create({ data: { itemId, status: 'open', source: 'manual' } }),
      ).rejects.toThrow();

      // A `done` row for the same item is NOT blocked by the partial index.
      await expect(
        prisma.shoppingListEntry.create({ data: { itemId, status: 'done', source: 'manual' } }),
      ).resolves.toBeDefined();
    });
  });

  // =========================================================================
  // AC 3 — the "Running low" one-tap manual trigger
  // =========================================================================

  describe('AC3: manual "Running low" trigger', () => {
    it('creates a manual entry with one tap, and a second tap is idempotent', async () => {
      const createRes = await http.post('/api/items').send({ name: 'Zip Ties' }).expect(201);
      const itemId = createRes.body.id as string;

      const firstRes = await http.post('/api/shopping-list').send({ itemId }).expect(200);
      expect(firstRes.body).toMatchObject({ itemId, status: 'open', source: 'manual' });

      const secondRes = await http.post('/api/shopping-list').send({ itemId }).expect(200);
      expect(secondRes.body.id).toBe(firstRes.body.id);

      const listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(1);
    });

    it('404s for an unknown item', async () => {
      await http
        .post('/api/shopping-list')
        .send({ itemId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' })
        .expect(404);
    });
  });

  // =========================================================================
  // AC 4 — list shape
  // =========================================================================

  describe('AC4: GET /api/shopping-list list shape', () => {
    it('includes item name, on-hand/min, and location', async () => {
      const location = await prisma.location.create({ data: { name: 'Garage', path: 'garage' } });
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Wing Nuts', quantity: 2, locationId: location.id })
        .expect(201);
      const itemId = createRes.body.id as string;
      await http.patch(`/api/items/${itemId}`).send({ minQuantity: 5 }).expect(200);
      await http.patch(`/api/items/${itemId}`).send({ quantity: 1 }).expect(200);

      const listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].item).toMatchObject({
        id: itemId,
        name: 'Wing Nuts',
        quantity: 1,
        minQuantity: 5,
        location: { id: location.id, name: 'Garage' },
      });
    });

    it('empty when there are no open entries', async () => {
      const listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toEqual([]);
    });
  });

  // =========================================================================
  // AC 5 — restock
  // =========================================================================

  describe('AC5: restock', () => {
    it('records an "add" movement, closes the entry, and the item quantity updates', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Hex Bolts', quantity: 2 })
        .expect(201);
      const itemId = createRes.body.id as string;
      const entry = await prisma.shoppingListEntry.create({
        data: { itemId, status: 'open', source: 'manual' },
      });

      const restockRes = await http
        .post(`/api/shopping-list/${entry.id}/restock`)
        .send({ quantity: 50 })
        .expect(200);
      expect(restockRes.body).toMatchObject({ id: entry.id, status: 'done' });
      expect(restockRes.body.resolvedAt).toBeDefined();

      const itemRes = await http.get(`/api/items/${itemId}`).expect(200);
      expect(itemRes.body.quantity).toBe(50);

      const movementsRes = await http.get(`/api/items/${itemId}/movements`).expect(200);
      expect(movementsRes.body.data[0]).toMatchObject({ kind: 'add', delta: 48 });

      const listRes = await http.get('/api/shopping-list').expect(200);
      expect(listRes.body).toHaveLength(0);
    });

    it('404s for an unknown entry', async () => {
      await http
        .post('/api/shopping-list/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/restock')
        .send({ quantity: 10 })
        .expect(404);
    });

    it('409s when restocking an already-resolved entry', async () => {
      const createRes = await http.post('/api/items').send({ name: 'Washers' }).expect(201);
      const itemId = createRes.body.id as string;
      const entry = await prisma.shoppingListEntry.create({
        data: { itemId, status: 'done', source: 'manual', resolvedAt: new Date() },
      });

      await http.post(`/api/shopping-list/${entry.id}/restock`).send({ quantity: 10 }).expect(409);
    });
  });
});
