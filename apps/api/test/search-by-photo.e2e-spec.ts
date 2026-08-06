/**
 * POST /api/items/search-by-photo — end-to-end integration tests
 * (supertest + real PostgreSQL). `AiService` is overridden with a mock so
 * these tests exercise real Prisma matching/ranking against a real DB
 * without making a real (billed) Anthropic call.
 *
 * Coverage (EVT-17):
 *   AC1 — mocked vision output whose keywords match seeded items returns
 *          ranked matches; a no-match search returns an empty list, 200.
 *   AC2 — the uploaded search photo is never persisted: no `Photo` row is
 *          created, and no file appears under `STORAGE_DIR`.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { readdirSync } from 'fs';
import supertest from 'supertest';
import { AiService } from '../src/ai/ai.service';
import { AppModule } from '../src/app.module';
import { STORAGE_DIR } from '../src/photos/photos.service';
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

describe('POST /api/items/search-by-photo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof supertest>;
  const analyzePhotoMock = jest.fn();

  beforeAll(async () => {
    // Must be set BEFORE the NestJS module is compiled so PrismaClient uses
    // the test database connection string.
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiService)
      .useValue({ analyzePhoto: analyzePhotoMock })
      .compile();

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

  beforeEach(async () => {
    analyzePhotoMock.mockReset();
    await prisma.itemTag.deleteMany();
    await prisma.item.deleteMany();
    await prisma.tag.deleteMany();
    await prisma.photo.deleteMany();
  });

  // =========================================================================
  // AC1 — mocked vision output whose keywords match seeded items
  // =========================================================================

  describe('AC1: ranked matches from mocked vision output', () => {
    it('returns items ranked by distinct search-term hit count, most hits first', async () => {
      analyzePhotoMock.mockResolvedValue({
        suggested_name: 'M4 hex bolt',
        description: '',
        tags: ['fastener'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: ['hex bolt'],
      });

      const bestMatch = await http
        .post('/api/items')
        .send({ name: 'M4 Hex Bolt (pack of 50)', tags: ['fastener'] })
        .expect(201);
      const weakMatch = await http
        .post('/api/items')
        .send({ name: 'Assorted hex bolts', description: 'mixed sizes' })
        .expect(201);
      await http.post('/api/items').send({ name: 'Unrelated hammer' }).expect(201);

      const res = await http
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);

      expect(res.body.analysis.suggested_name).toBe('M4 hex bolt');
      expect(res.body.matches.map((m: { id: string }) => m.id)).toEqual([
        bestMatch.body.id,
        weakMatch.body.id,
      ]);
    });

    it('returns an empty matches array (200) when nothing in inventory matches', async () => {
      analyzePhotoMock.mockResolvedValue({
        suggested_name: 'Exotic gadget',
        description: '',
        tags: ['xyz-nonexistent-marker'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [],
      });
      await http.post('/api/items').send({ name: 'Unrelated hammer' }).expect(201);

      const res = await http
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);

      expect(res.body.matches).toEqual([]);
      expect(res.body.analysis.suggested_name).toBe('Exotic gadget');
    });

    it('stub AI output (empty keywords/tags) echoes the analysis with empty matches', async () => {
      analyzePhotoMock.mockResolvedValue({
        suggested_name: 'Unknown item',
        description: '',
        tags: [],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [],
      });
      await http.post('/api/items').send({ name: 'Some item' }).expect(201);

      const res = await http
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);

      expect(res.body).toEqual({
        analysis: {
          suggested_name: 'Unknown item',
          description: '',
          tags: [],
          color: null,
          quantity: null,
          unit: null,
          properties: {},
          search_keywords: [],
        },
        matches: [],
      });
    });
  });

  // =========================================================================
  // AC2 — the uploaded search photo is NEVER persisted
  // =========================================================================

  describe('AC2: the search photo is not persisted to storage or the DB', () => {
    it('creates no Photo row and leaves no file under STORAGE_DIR', async () => {
      analyzePhotoMock.mockResolvedValue({
        suggested_name: 'Unknown item',
        description: '',
        tags: [],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [],
      });

      const filesBefore = readdirSync(STORAGE_DIR).length;

      await http
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);

      expect(await prisma.photo.count()).toBe(0);
      expect(readdirSync(STORAGE_DIR).length).toBe(filesBefore);
    });

    it('rejects an unsupported mimetype with 415 without calling AiService', async () => {
      await http
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('not an image'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        })
        .expect(415);

      expect(analyzePhotoMock).not.toHaveBeenCalled();
    });

    it('rejects a file over the 5 MB analysis ceiling with 400', async () => {
      const oversized = Buffer.alloc(6 * 1024 * 1024, 1);

      await http
        .post('/api/items/search-by-photo')
        .attach('file', oversized, { filename: 'huge.jpg', contentType: 'image/jpeg' })
        .expect(400);
    });

    it('rejects a request with no file with 400', async () => {
      await http.post('/api/items/search-by-photo').expect(400);
    });
  });
});
