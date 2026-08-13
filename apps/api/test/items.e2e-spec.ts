/**
 * Items API — end-to-end integration tests (supertest + real PostgreSQL)
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts.
 *
 * Coverage:
 *   AC1 — create → list → search hit/miss → filter by tag → filter by
 *          locationId subtree → patch tags → delete
 *   AC2 — by-qr returns an item, a location, or 404
 *   AC3 — search for a value stored ONLY in properties JSONB finds the item
 *   AC4 — invalid payloads (missing name, bad uuid) → 400 with messages
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
// Helpers
// ---------------------------------------------------------------------------

/** Creates a Location row directly via Prisma and returns it. */
async function createLocation(prisma: PrismaService, name: string, path: string) {
  return prisma.location.create({ data: { name, path } });
}

/** Creates a child location under `parent`. */
async function createChildLocation(
  prisma: PrismaService,
  name: string,
  path: string,
  parentId: string,
) {
  return prisma.location.create({ data: { name, path, parentId } });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Items API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  /** Authenticated as an approved admin (EVT-14) — see e2e-auth-helper.ts;
   * this suite exercises Items endpoints, not auth itself (that's
   * auth.e2e-spec.ts). */
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

  /** Clean all items (and their tags) before each test so tests are isolated. */
  beforeEach(async () => {
    await prisma.itemTag.deleteMany();
    await prisma.item.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.location.deleteMany();
    await prisma.category.deleteMany();
  });

  // =========================================================================
  // AC 4 — Invalid payloads → 400 with messages
  // =========================================================================

  describe('AC4: input validation', () => {
    it('POST /api/items — missing name → 400', async () => {
      const res = await http.post('/api/items').send({}).expect(400);
      expect(res.body.message).toBeDefined();
      // Should mention the name field
      const messages: string[] = Array.isArray(res.body.message)
        ? res.body.message
        : [res.body.message];
      expect(messages.some((m) => /name/i.test(m))).toBe(true);
    });

    it('POST /api/items — empty name → 400', async () => {
      const res = await http.post('/api/items').send({ name: '' }).expect(400);
      expect(res.body.message).toBeDefined();
    });

    it('POST /api/items — bad locationId (not a UUID) → 400', async () => {
      const res = await http
        .post('/api/items')
        .send({ name: 'Drill', locationId: 'not-a-uuid' })
        .expect(400);
      expect(res.body.message).toBeDefined();
    });

    it('PATCH /api/items/:id — bad UUID in path → 400', async () => {
      const res = await http.patch('/api/items/not-a-uuid').send({ name: 'X' }).expect(400);
      expect(res.body.message).toBeDefined();
    });

    it('GET /api/items/:id — bad UUID in path → 400', async () => {
      const res = await http.get('/api/items/not-a-uuid').expect(400);
      expect(res.body.message).toBeDefined();
    });
  });

  // =========================================================================
  // AC 1 — Full CRUD flow
  // =========================================================================

  describe('AC1: create → list → search hit/miss → filter by tag → filter by locationId subtree → patch tags → delete', () => {
    it('completes the full CRUD lifecycle', async () => {
      // ---- 1. CREATE -------------------------------------------------------
      const createRes = await http
        .post('/api/items')
        .send({
          name: 'Cordless Drill',
          description: 'A 20V drill',
          tags: ['power-tool'],
          quantity: 1,
        })
        .expect(201);

      const item = createRes.body;
      expect(item.id).toBeDefined();
      expect(item.name).toBe('Cordless Drill');
      expect(item.tags).toHaveLength(1);
      expect(item.tags[0].tag.name).toBe('power-tool');

      const itemId = item.id as string;

      // ---- 2. LIST ---------------------------------------------------------
      const listRes = await http.get('/api/items').expect(200);
      expect(listRes.body).toHaveLength(1);
      expect(listRes.body[0].id).toBe(itemId);

      // ---- 3. SEARCH HIT ---------------------------------------------------
      const searchHitRes = await http.get('/api/items?search=cordless').expect(200);
      expect(searchHitRes.body).toHaveLength(1);
      expect(searchHitRes.body[0].id).toBe(itemId);

      // ---- 4. SEARCH MISS --------------------------------------------------
      const searchMissRes = await http.get('/api/items?search=unicorn-xyz-missing').expect(200);
      expect(searchMissRes.body).toHaveLength(0);

      // ---- 5. FILTER BY TAG ------------------------------------------------
      const tagHitRes = await http.get('/api/items?tag=power-tool').expect(200);
      expect(tagHitRes.body).toHaveLength(1);
      expect(tagHitRes.body[0].id).toBe(itemId);

      const tagMissRes = await http.get('/api/items?tag=hand-tool').expect(200);
      expect(tagMissRes.body).toHaveLength(0);

      // ---- 6. FILTER BY LOCATION SUBTREE -----------------------------------
      const parent = await createLocation(prisma, 'Garage', 'garage');
      const child = await createChildLocation(prisma, 'Cabinet', 'garage.cabinet', parent.id);

      // Assign item to the child location
      await http.patch(`/api/items/${itemId}`).send({ locationId: child.id }).expect(200);

      // Querying by parent location should find items in child (subtree)
      const locHitRes = await http.get(`/api/items?locationId=${parent.id}`).expect(200);
      expect(locHitRes.body).toHaveLength(1);
      expect(locHitRes.body[0].id).toBe(itemId);

      // Querying by child directly
      const locChildRes = await http.get(`/api/items?locationId=${child.id}`).expect(200);
      expect(locChildRes.body).toHaveLength(1);

      // Querying by an unrelated location → 0 results
      const unrelated = await createLocation(prisma, 'Shed', 'shed');
      const locMissRes = await http.get(`/api/items?locationId=${unrelated.id}`).expect(200);
      expect(locMissRes.body).toHaveLength(0);

      // ---- 7. PATCH TAGS ---------------------------------------------------
      const patchRes = await http
        .patch(`/api/items/${itemId}`)
        .send({ tags: ['hand-tool', 'cordless'] })
        .expect(200);
      expect(patchRes.body.tags).toHaveLength(2);
      const tagNames = patchRes.body.tags.map((t: { tag: { name: string } }) => t.tag.name).sort();
      expect(tagNames).toEqual(['cordless', 'hand-tool']);

      // ---- 8. DELETE -------------------------------------------------------
      await http.delete(`/api/items/${itemId}`).expect(204);

      // Confirm it's gone
      await http.get(`/api/items/${itemId}`).expect(404);
      const afterDeleteList = await http.get('/api/items').expect(200);
      expect(afterDeleteList.body).toHaveLength(0);
    });
  });

  // =========================================================================
  // AC 2 — by-qr
  // =========================================================================

  describe('AC2: by-qr lookup', () => {
    it('returns { kind: "item" } for an item QR token', async () => {
      // Create an item first
      const createRes = await http.post('/api/items').send({ name: 'Screwdriver' }).expect(201);
      const itemId = createRes.body.id as string;
      const qrCode = createRes.body.qrCode as string;

      expect(qrCode).toBeDefined();

      const res = await http.get(`/api/items/by-qr/${qrCode}`).expect(200);
      expect(res.body.kind).toBe('item');
      expect(res.body.item.id).toBe(itemId);
    });

    it('returns { kind: "location" } for a location QR token', async () => {
      const loc = await createLocation(prisma, 'Workshop', 'workshop');
      const qrCode = loc.qrCode;

      const res = await http.get(`/api/items/by-qr/${qrCode}`).expect(200);
      expect(res.body.kind).toBe('location');
      expect(res.body.location.id).toBe(loc.id);
    });

    it('returns 404 for an unknown QR token', async () => {
      const res = await http.get('/api/items/by-qr/unknown-token-that-does-not-exist').expect(404);
      expect(res.body.message).toBeDefined();
    });
  });

  // =========================================================================
  // AC 3 — Search for a value stored ONLY in properties JSONB
  // =========================================================================

  describe('AC3: JSONB properties search', () => {
    it('finds an item whose search term appears ONLY in the properties column', async () => {
      // Create an item that has a UNIQUE string ONLY in properties, not in
      // name or description. This guarantees the ILIKE on properties::text is
      // what surfaces the result.
      const UNIQUE_MARKER = 'XRAY-MAKITA-UNIQUE-18V-VOLTAGE';

      await http
        .post('/api/items')
        .send({
          name: 'Generic Power Tool',
          description: 'No special value here',
          properties: { voltage: UNIQUE_MARKER, brand: 'SomeBrand' },
        })
        .expect(201);

      // Second item — should NOT match
      await http
        .post('/api/items')
        .send({ name: 'Different Item', description: 'No special properties' })
        .expect(201);

      const res = await http.get(`/api/items?search=${UNIQUE_MARKER}`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Generic Power Tool');
    });

    it('does NOT match an item when the search term is absent from all columns', async () => {
      await http
        .post('/api/items')
        .send({
          name: 'Hammer',
          properties: { color: 'red' },
        })
        .expect(201);

      const res = await http.get('/api/items?search=ZYXWVUTSRQPONML-nonexistent').expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('finds by partial match inside properties JSONB', async () => {
      await http
        .post('/api/items')
        .send({
          name: 'Tool X',
          properties: { model: 'DCD999B-SPECIAL' },
        })
        .expect(201);

      // Search for a substring that only appears in properties
      const res = await http.get('/api/items?search=DCD999B').expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('Tool X');
    });
  });

  // =========================================================================
  // EVT-25 — stock movement ledger
  // =========================================================================

  describe('EVT-25: stock movement ledger', () => {
    it('GET /api/items/:id/movements — 404 for an unknown item', async () => {
      await http.get('/api/items/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11/movements').expect(404);
    });

    it('AC 1/2: creating an item with a starting quantity writes one "add" movement', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Box of Screws', quantity: 25 })
        .expect(201);
      expect(createRes.body.quantity).toBe(25);

      const itemId = createRes.body.id as string;
      const movementsRes = await http.get(`/api/items/${itemId}/movements`).expect(200);

      expect(movementsRes.body.total).toBe(1);
      expect(movementsRes.body.data).toHaveLength(1);
      expect(movementsRes.body.data[0]).toMatchObject({ kind: 'add', delta: 25 });
    });

    it('a starting quantity of 0 writes no movement', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Empty Bin', quantity: 0 })
        .expect(201);

      const movementsRes = await http.get(`/api/items/${createRes.body.id}/movements`).expect(200);
      expect(movementsRes.body.total).toBe(0);
      expect(movementsRes.body.data).toEqual([]);
    });

    it('AC 3: editing quantity from N to M records an "adjust" movement with delta M-N', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Bag of Bolts', quantity: 10 })
        .expect(201);
      const itemId = createRes.body.id as string;

      const patchRes = await http.patch(`/api/items/${itemId}`).send({ quantity: 6 }).expect(200);
      expect(patchRes.body.quantity).toBe(6);

      const movementsRes = await http.get(`/api/items/${itemId}/movements`).expect(200);
      expect(movementsRes.body.total).toBe(2); // the initial "add" + this "adjust"
      // Newest first — the adjust is the most recent movement.
      expect(movementsRes.body.data[0]).toMatchObject({ kind: 'adjust', delta: -4 });
    });

    it('AC 4: moving an item to another location records a "move" movement carrying both location ids', async () => {
      const garage = await createLocation(prisma, 'Garage', 'garage');
      const shed = await createLocation(prisma, 'Shed', 'shed');

      const createRes = await http
        .post('/api/items')
        .send({ name: 'Ladder', locationId: garage.id })
        .expect(201);
      const itemId = createRes.body.id as string;

      await http.patch(`/api/items/${itemId}`).send({ locationId: shed.id }).expect(200);

      const movementsRes = await http.get(`/api/items/${itemId}/movements`).expect(200);
      const moveMovement = movementsRes.body.data.find((m: { kind: string }) => m.kind === 'move');
      expect(moveMovement).toMatchObject({
        kind: 'move',
        fromLocationId: garage.id,
        toLocationId: shed.id,
      });
      expect(moveMovement.fromLocation.name).toBe('Garage');
      expect(moveMovement.toLocation.name).toBe('Shed');
    });

    it('AC 5: returns pages newest-first', async () => {
      const createRes = await http
        .post('/api/items')
        .send({ name: 'Nails', quantity: 1 })
        .expect(201);
      const itemId = createRes.body.id as string;

      await http.patch(`/api/items/${itemId}`).send({ quantity: 2 }).expect(200);
      await http.patch(`/api/items/${itemId}`).send({ quantity: 5 }).expect(200);

      const movementsRes = await http
        .get(`/api/items/${itemId}/movements?page=1&pageSize=2`)
        .expect(200);
      expect(movementsRes.body.data).toHaveLength(2);
      expect(movementsRes.body.total).toBe(3);
      expect(movementsRes.body.totalPages).toBe(2);
      // Newest first: the last PATCH (2 -> 5, delta +3) comes before the
      // first PATCH (1 -> 2, delta +1).
      expect(movementsRes.body.data[0]).toMatchObject({ kind: 'adjust', delta: 3 });
      expect(movementsRes.body.data[1]).toMatchObject({ kind: 'adjust', delta: 1 });
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe('edge cases', () => {
    it('GET /api/items/:id returns 404 for a non-existent item', async () => {
      await http.get('/api/items/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11').expect(404);
    });

    it('PATCH /api/items/:id returns 404 for a non-existent item', async () => {
      await http
        .patch('/api/items/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .send({ name: 'X' })
        .expect(404);
    });

    it('DELETE /api/items/:id returns 404 for a non-existent item', async () => {
      await http.delete('/api/items/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11').expect(404);
    });

    it('GET /api/items?locationId= with non-existent locationId returns empty list', async () => {
      // Must be a valid UUID v4 to pass DTO validation; the location simply won't exist
      const res = await http
        .get('/api/items?locationId=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
        .expect(200);
      expect(res.body).toHaveLength(0);
    });

    it('list returns items newest-first', async () => {
      await http.post('/api/items').send({ name: 'Item A' }).expect(201);
      // Tiny delay to ensure different createdAt timestamps
      await new Promise((r) => setTimeout(r, 50));
      await http.post('/api/items').send({ name: 'Item B' }).expect(201);

      const res = await http.get('/api/items').expect(200);
      expect(res.body[0].name).toBe('Item B');
      expect(res.body[1].name).toBe('Item A');
    });
  });
});
