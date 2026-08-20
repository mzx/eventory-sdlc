/**
 * Tenant isolation matrix — end-to-end (EVT-40).
 *
 * Seeds TWO fully independent workspaces (see `two-workspace-harness.ts`,
 * reused by EVT-41) and proves, for every endpoint this task touches, that
 * a caller in Workspace B can never read or write Workspace A's data (and
 * vice versa), and that a `viewer` can read but never write.
 *
 * Coverage (mapped to the task's acceptance criteria):
 *   AC1 — tenant context: default resolution, explicit header resolution,
 *          non-member header -> 403
 *   AC2 — items: GET/PATCH/DELETE/consume/count/movements, foreign -> 404,
 *          own -> correct; list() never leaks a foreign item
 *   (round-2 review finding 1) — GET /api/tags, pulled into this task's
 *          scope after review: unscoped before the fix, now proven scoped
 *   AC3 — photo metadata (GET /api/photos/:id) AND raw file serving
 *          (GET /storage/:filename), foreign -> 404, own -> 200
 *   AC4 — QR scan-landing (GET /api/items/by-qr/:qr): a member of the
 *          scanned item's workspace resolves it; a non-member gets the same
 *          neutral 404 as an unknown token
 *   AC5 — viewer-role matrix: full 200 on reads, 403 on every mutating
 *          endpoint in the items/photos modules
 */

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { WORKSPACE_HEADER } from '../src/workspace/workspace-context';
import { AuthedHttp } from './e2e-auth-helper';
import { seedTwoWorkspaces, TwoWorkspaceFixture } from './two-workspace-harness';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestPng(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
}

/** Creates an item as `http` and returns its id + qrCode. */
async function createItem(http: AuthedHttp, name: string): Promise<{ id: string; qrCode: string }> {
  const res = await http.post('/api/items').send({ name, quantity: 5 }).expect(201);
  return { id: res.body.id as string, qrCode: res.body.qrCode as string };
}

/** Uploads a photo as `http` and returns its id, filename, and public url. */
async function uploadPhoto(
  http: AuthedHttp,
): Promise<{ id: string; filename: string; url: string }> {
  const png = await makeTestPng();
  const res = await http
    .post('/api/photos/upload')
    .attach('file', png, { filename: 'iso.png', contentType: 'image/png' })
    .expect(201);
  return {
    id: res.body.id as string,
    filename: res.body.filename as string,
    url: res.body.url as string,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Tenant isolation matrix (e2e, EVT-40)', () => {
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
  // AC1 — tenant context resolution
  // =========================================================================

  describe('AC1: tenant context resolution', () => {
    it("with no X-Workspace-Id header, resolves the caller's own (default) workspace", async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC1 default-resolution item');
      const res = await fixture.workspaceA.owner.get(`/api/items/${id}`).expect(200);
      expect(res.body.id).toBe(id);
    });

    it("an explicit X-Workspace-Id header for the caller's OWN workspace resolves the same as the default", async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC1 explicit-own-header item');
      await fixture.workspaceA.owner
        .get(`/api/items/${id}`)
        .set(WORKSPACE_HEADER, fixture.workspaceA.id)
        .expect(200);
    });

    it('AC1: a X-Workspace-Id header for a workspace the caller is NOT a member of -> 403', async () => {
      await fixture.workspaceA.owner
        .get('/api/items')
        .set(WORKSPACE_HEADER, fixture.workspaceB.id)
        .expect(403);
    });

    it('AC1: a malformed X-Workspace-Id header -> 403', async () => {
      await fixture.workspaceA.owner
        .get('/api/items')
        .set(WORKSPACE_HEADER, 'not-a-uuid')
        .expect(403);
    });
  });

  // =========================================================================
  // AC2 — items isolation matrix
  // =========================================================================

  describe('AC2: items isolation matrix', () => {
    it('GET /api/items/:id — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 GET item');

      await fixture.workspaceB.owner.get(`/api/items/${id}`).expect(404);
      await fixture.workspaceA.owner.get(`/api/items/${id}`).expect(200);
    });

    it("GET /api/items — never lists a foreign workspace's item", async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 LIST item');

      const foreignList = await fixture.workspaceB.owner.get('/api/items').expect(200);
      expect((foreignList.body as { id: string }[]).some((item) => item.id === id)).toBe(false);

      const ownList = await fixture.workspaceA.owner.get('/api/items').expect(200);
      expect((ownList.body as { id: string }[]).some((item) => item.id === id)).toBe(true);
    });

    it('PATCH /api/items/:id — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 PATCH item');

      await fixture.workspaceB.owner
        .patch(`/api/items/${id}`)
        .send({ name: 'hijacked' })
        .expect(404);
      await fixture.workspaceA.owner
        .patch(`/api/items/${id}`)
        .send({ name: 'renamed' })
        .expect(200);
    });

    it('DELETE /api/items/:id — foreign -> 404, own -> 204', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 DELETE item');

      await fixture.workspaceB.owner.delete(`/api/items/${id}`).expect(404);
      await fixture.workspaceA.owner.delete(`/api/items/${id}`).expect(204);
    });

    it('POST /api/items/:id/consume — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 CONSUME item');

      await fixture.workspaceB.owner
        .post(`/api/items/${id}/consume`)
        .send({ quantity: 1 })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/items/${id}/consume`)
        .send({ quantity: 1 })
        .expect(200);
    });

    it('POST /api/items/:id/count — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 COUNT item');

      await fixture.workspaceB.owner
        .post(`/api/items/${id}/count`)
        .send({ quantity: 3 })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/items/${id}/count`)
        .send({ quantity: 3 })
        .expect(200);
    });

    it('POST /api/items/:id/receive — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 RECEIVE item');

      await fixture.workspaceB.owner
        .post(`/api/items/${id}/receive`)
        .send({ quantity: 2 })
        .expect(404);
      await fixture.workspaceA.owner
        .post(`/api/items/${id}/receive`)
        .send({ quantity: 2 })
        .expect(200);
    });

    it('GET /api/items/:id/movements — foreign -> 404, own -> 200', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC2 MOVEMENTS item');

      await fixture.workspaceB.owner.get(`/api/items/${id}/movements`).expect(404);
      await fixture.workspaceA.owner.get(`/api/items/${id}/movements`).expect(200);
    });
  });

  // =========================================================================
  // Tags isolation (EVT-40 round-2 review, security finding 1) —
  // GET /api/tags was completely unscoped before this fix; a tag name
  // created via an item's `tags` field in one workspace must never appear
  // in another workspace's GET /api/tags response.
  // =========================================================================

  describe('Tags isolation (round-2 review finding 1)', () => {
    it('GET /api/tags — a tag created in workspace A is invisible to workspace B, visible to workspace A', async () => {
      const tagName = `iso-tag-${Date.now()}`;
      await fixture.workspaceA.owner
        .post('/api/items')
        .send({ name: 'Tagged item', tags: [tagName] })
        .expect(201);

      const foreignTags = await fixture.workspaceB.owner.get('/api/tags').expect(200);
      expect((foreignTags.body as { name: string }[]).some((t) => t.name === tagName)).toBe(false);

      const ownTags = await fixture.workspaceA.owner.get('/api/tags').expect(200);
      expect((ownTags.body as { name: string }[]).some((t) => t.name === tagName)).toBe(true);
    });

    it('the SAME tag name may exist independently in both workspaces without colliding', async () => {
      const tagName = `iso-shared-name-${Date.now()}`;
      await fixture.workspaceA.owner
        .post('/api/items')
        .send({ name: 'Workspace A item', tags: [tagName] })
        .expect(201);
      await fixture.workspaceB.owner
        .post('/api/items')
        .send({ name: 'Workspace B item', tags: [tagName] })
        .expect(201);

      const aTags = (await fixture.workspaceA.owner.get('/api/tags').expect(200)).body as {
        name: string;
        itemCount: number;
      }[];
      const bTags = (await fixture.workspaceB.owner.get('/api/tags').expect(200)).body as {
        name: string;
        itemCount: number;
      }[];

      expect(aTags.find((t) => t.name === tagName)?.itemCount).toBe(1);
      expect(bTags.find((t) => t.name === tagName)?.itemCount).toBe(1);
    });

    it('a viewer can read GET /api/tags (200) — it is a read, not a write', async () => {
      await fixture.workspaceA.viewer.get('/api/tags').expect(200);
    });
  });

  // =========================================================================
  // AC3 — photo metadata and raw /storage isolation
  // =========================================================================

  describe('AC3: photos + storage isolation', () => {
    it('GET /api/photos/:id — foreign -> 404, own -> 200', async () => {
      const photo = await uploadPhoto(fixture.workspaceA.owner);

      await fixture.workspaceB.owner.get(`/api/photos/${photo.id}`).expect(404);
      await fixture.workspaceA.owner.get(`/api/photos/${photo.id}`).expect(200);
    });

    it('GET /storage/:filename — the guessed-URL surface: foreign -> 404, own -> 200 with bytes', async () => {
      const photo = await uploadPhoto(fixture.workspaceA.owner);

      await fixture.workspaceB.owner.get(photo.url).expect(404);
      const ownRes = await fixture.workspaceA.owner.get(photo.url).expect(200);
      expect(ownRes.headers['content-type']).toMatch(/^image\/png/);
      expect(ownRes.headers['x-content-type-options']).toBe('nosniff');
    });

    it('DELETE /api/photos/:id — foreign -> 404, own -> 204', async () => {
      const photo = await uploadPhoto(fixture.workspaceA.owner);

      await fixture.workspaceB.owner.delete(`/api/photos/${photo.id}`).expect(404);
      await fixture.workspaceA.owner.delete(`/api/photos/${photo.id}`).expect(204);
    });

    it('POST /api/photos/upload with a foreign itemId -> 400 (cross-tenant reference smuggling is rejected)', async () => {
      const { id: foreignItemId } = await createItem(fixture.workspaceB.owner, 'AC3 foreign-item');
      const png = await makeTestPng();

      await fixture.workspaceA.owner
        .post('/api/photos/upload')
        .field('itemId', foreignItemId)
        .attach('file', png, { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
    });
  });

  // =========================================================================
  // AC4 — QR scan-landing
  // =========================================================================

  describe('AC4: QR scan-landing', () => {
    it("a member of the item's workspace resolves it via GET /api/items/by-qr/:qr", async () => {
      const { qrCode } = await createItem(fixture.workspaceA.member, 'AC4 QR item');

      const res = await fixture.workspaceA.owner.get(`/api/items/by-qr/${qrCode}`).expect(200);
      expect(res.body.kind).toBe('item');
      expect(res.body.item.id).toBeDefined();
    });

    it("a non-member of the item's workspace gets the same neutral 404 as an unknown token", async () => {
      const { qrCode } = await createItem(fixture.workspaceA.member, 'AC4 QR foreign item');

      await fixture.workspaceB.owner.get(`/api/items/by-qr/${qrCode}`).expect(404);
      await fixture.workspaceB.owner.get('/api/items/by-qr/totally-unknown-token').expect(404);
    });
  });

  // =========================================================================
  // AC5 — viewer-role matrix (reads 200, writes 403)
  // =========================================================================

  describe('AC5: viewer-role matrix', () => {
    it('a viewer reads items (200) but every mutating items endpoint returns 403', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC5 viewer item');

      // Reads: full 200.
      await fixture.workspaceA.viewer.get('/api/items').expect(200);
      await fixture.workspaceA.viewer.get(`/api/items/${id}`).expect(200);
      await fixture.workspaceA.viewer.get(`/api/items/${id}/movements`).expect(200);

      // Writes: 403, via the shared WorkspaceWriteGuard.
      await fixture.workspaceA.viewer.post('/api/items').send({ name: 'nope' }).expect(403);
      await fixture.workspaceA.viewer.patch(`/api/items/${id}`).send({ name: 'nope' }).expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/items/${id}/consume`)
        .send({ quantity: 1 })
        .expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/items/${id}/count`)
        .send({ quantity: 1 })
        .expect(403);
      await fixture.workspaceA.viewer
        .post(`/api/items/${id}/receive`)
        .send({ quantity: 1 })
        .expect(403);
      await fixture.workspaceA.viewer.delete(`/api/items/${id}`).expect(403);
    });

    it('a viewer reads photo metadata (200) but cannot upload or delete photos (403)', async () => {
      const photo = await uploadPhoto(fixture.workspaceA.owner);

      await fixture.workspaceA.viewer.get(`/api/photos/${photo.id}`).expect(200);

      const png = await makeTestPng();
      await fixture.workspaceA.viewer
        .post('/api/photos/upload')
        .attach('file', png, { filename: 'viewer.png', contentType: 'image/png' })
        .expect(403);
      await fixture.workspaceA.viewer.delete(`/api/photos/${photo.id}`).expect(403);
    });

    it('a viewer CAN read the raw /storage file (GET is not a write)', async () => {
      const photo = await uploadPhoto(fixture.workspaceA.owner);
      await fixture.workspaceA.viewer.get(photo.url).expect(200);
    });

    it('a member (not just an owner) has full write access — the viewer restriction is role-specific, not blanket', async () => {
      const { id } = await createItem(fixture.workspaceA.owner, 'AC5 member-write item');
      await fixture.workspaceA.member
        .patch(`/api/items/${id}`)
        .send({ name: 'member edit' })
        .expect(200);
    });
  });
});
