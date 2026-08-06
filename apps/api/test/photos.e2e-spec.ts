/**
 * Photos API — end-to-end integration tests (supertest + real PostgreSQL +
 * real disk writes under apps/api/storage/).
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts, the
 * same way items.e2e-spec.ts does.
 *
 * Coverage:
 *   AC1 — upload a real PNG → 201 with url; GET that url returns the bytes
 *          with the correct content-type
 *   AC2 — oversized (>20 MB) and wrong-type files are rejected with 400/415
 *   AC3 — width/height populated for a real test image
 *
 * AC4 (docker compose down/up volume persistence) is a deployment property
 * of the `eventory-photo-storage` named volume added to docker-compose.yml
 * in this change — it is not practical to exercise from a jest suite and is
 * verified operationally, not here.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { rmSync } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import supertest from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { STORAGE_DIR, STORAGE_URL_PREFIX } from '../src/photos/photos.service';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_IMAGE_WIDTH = 64;
const TEST_IMAGE_HEIGHT = 48;

/** A real, decodable PNG buffer with known dimensions. */
function makeTestPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: TEST_IMAGE_WIDTH,
      height: TEST_IMAGE_HEIGHT,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Photos API (e2e)', () => {
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

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    // Mirror the static-asset wiring done in src/main.ts's bootstrap().
    (app as NestExpressApplication).useStaticAssets(STORAGE_DIR, { prefix: STORAGE_URL_PREFIX });
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    http = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  /** Clean all photos before each test so tests are isolated. */
  beforeEach(async () => {
    const photos = await prisma.photo.findMany({ select: { filename: true } });
    await prisma.photo.deleteMany();
    for (const { filename } of photos) {
      rmSync(path.join(STORAGE_DIR, filename), { force: true });
    }
  });

  // =========================================================================
  // AC1 — upload → 201 with url; GET url returns bytes with correct content-type
  // =========================================================================

  describe('AC1: upload then fetch the served file', () => {
    it('POST /api/photos/upload with a PNG returns 201 + url, and GET that url serves it', async () => {
      const png = await makeTestPng();

      const uploadRes = await http
        .post('/api/photos/upload')
        .attach('file', png, { filename: 'test.png', contentType: 'image/png' })
        .expect(201);

      expect(uploadRes.body.id).toBeDefined();
      expect(uploadRes.body.mimeType).toBe('image/png');
      expect(uploadRes.body.sizeBytes).toBe(png.length);
      expect(uploadRes.body.aiAnalysis).toBeNull();
      expect(uploadRes.body.url).toMatch(/^\/storage\/.+\.png$/);

      const fileRes = await http.get(uploadRes.body.url as string).expect(200);
      expect(fileRes.headers['content-type']).toMatch(/^image\/png/);
      expect(Buffer.compare(fileRes.body as Buffer, png)).toBe(0);
    });

    it('GET /api/photos/:id returns the metadata row', async () => {
      const png = await makeTestPng();
      const uploadRes = await http
        .post('/api/photos/upload')
        .attach('file', png, { filename: 'test.png', contentType: 'image/png' })
        .expect(201);

      const res = await http.get(`/api/photos/${uploadRes.body.id}`).expect(200);
      expect(res.body.id).toBe(uploadRes.body.id);
      expect(res.body.url).toBe(uploadRes.body.url);
    });

    it('GET /api/photos/:id returns 404 for a non-existent photo', async () => {
      await http.get('/api/photos/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11').expect(404);
    });

    it('links the photo to an item when itemId is provided', async () => {
      const item = await prisma.item.create({ data: { name: 'Drill' } });
      const png = await makeTestPng();

      const uploadRes = await http
        .post('/api/photos/upload')
        .field('itemId', item.id)
        .attach('file', png, { filename: 'test.png', contentType: 'image/png' })
        .expect(201);

      expect(uploadRes.body.itemId).toBe(item.id);
      await prisma.item.delete({ where: { id: item.id } });
    });
  });

  // =========================================================================
  // AC2 — oversized and wrong-type rejection
  // =========================================================================

  describe('AC2: rejection of oversized / wrong-type files', () => {
    it('rejects a file over the 20 MB limit with 400', async () => {
      const oversized = Buffer.alloc(21 * 1024 * 1024, 1);

      await http
        .post('/api/photos/upload')
        .attach('file', oversized, { filename: 'huge.png', contentType: 'image/png' })
        .expect(400);
    });

    it('rejects an unsupported mimetype with 415', async () => {
      await http
        .post('/api/photos/upload')
        .attach('file', Buffer.from('not an image'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        })
        .expect(415);
    });

    it('rejects an upload with no file with 400', async () => {
      await http.post('/api/photos/upload').expect(400);
    });
  });

  // =========================================================================
  // AC3 — width/height populated for a real test image
  // =========================================================================

  describe('AC3: width/height extraction', () => {
    it('reads width/height from a real PNG via sharp metadata', async () => {
      const png = await makeTestPng();

      const uploadRes = await http
        .post('/api/photos/upload')
        .attach('file', png, { filename: 'sized.png', contentType: 'image/png' })
        .expect(201);

      expect(uploadRes.body.width).toBe(TEST_IMAGE_WIDTH);
      expect(uploadRes.body.height).toBe(TEST_IMAGE_HEIGHT);
    });
  });
});
