import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AiService, STUB_ANALYSIS, stubAnalysis } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import {
  buildSearchTerms,
  escapeLikePattern,
  ItemsService,
  MAX_MATCHES,
  MAX_SEARCH_TERMS,
} from './items.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const LOC_ID = '22222222-2222-2222-2222-222222222222';
const TAG_ID = '33333333-3333-3333-3333-333333333333';
const QR_ITEM = 'qr-item-token';
const QR_LOC = 'qr-loc-token';

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    name: 'Cordless Drill',
    description: 'A drill',
    quantity: 1,
    unit: null,
    properties: {},
    qrCode: QR_ITEM,
    locationId: LOC_ID,
    categoryId: null,
    primaryPhotoId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    tags: [
      { itemId: ITEM_ID, tagId: TAG_ID, tag: { id: TAG_ID, name: 'power-tool', color: null } },
    ],
    location: { id: LOC_ID, name: 'Garage', path: 'garage' },
    primaryPhoto: null,
    ...overrides,
  };
}

function makeItemDetail(overrides: Record<string, unknown> = {}) {
  return {
    ...makeItemRow(overrides),
    category: null,
    photos: [],
  };
}

function makeLocationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: LOC_ID,
    name: 'Garage',
    path: 'garage',
    parentId: null,
    notes: null,
    ...overrides,
  };
}

function makePrismaMock() {
  return {
    item: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    location: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
  };
}

function makeTagsMock() {
  return {
    upsertMany: jest.fn(),
  };
}

function makeAiServiceMock() {
  return {
    analyzePhoto: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ItemsService', () => {
  let service: ItemsService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let tagsMock: ReturnType<typeof makeTagsMock>;
  let aiMock: ReturnType<typeof makeAiServiceMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    tagsMock = makeTagsMock();
    aiMock = makeAiServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TagsService, useValue: tagsMock },
        { provide: AiService, useValue: aiMock },
      ],
    }).compile();

    service = module.get<ItemsService>(ItemsService);
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('returns all items when no filters are provided', async () => {
      const rows = [makeItemRow()];
      prismaMock.item.findMany.mockResolvedValue(rows);

      const result = await service.list({});

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
      );
      expect(result).toBe(rows);
    });

    it('returns an empty array when no items exist', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      expect(await service.list({})).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // search filter
    // -----------------------------------------------------------------------

    it('search hit — calls $queryRaw and passes matching IDs to findMany', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: ITEM_ID }]);
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      const result = await service.list({ search: 'drill' });

      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [ITEM_ID] } } }),
      );
      expect(result).toHaveLength(1);
    });

    it('search miss — $queryRaw returns no IDs, findMany called with empty in array', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);

      const result = await service.list({ search: 'nonexistent-xyz' });

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [] } } }),
      );
      expect(result).toHaveLength(0);
    });

    // AC 3 — search in properties JSONB
    it('AC3: search for a value stored only in properties JSONB — $queryRaw is the mechanism', async () => {
      // The raw SQL query (ILIKE on properties::text) surfaces the item;
      // we verify the service passes the found IDs into findMany.
      prismaMock.$queryRaw.mockResolvedValue([{ id: ITEM_ID }]);
      prismaMock.item.findMany.mockResolvedValue([
        makeItemRow({ properties: { voltage: '18V', brand: 'Makita' } }),
      ]);

      const result = await service.list({ search: '18V' });

      // $queryRaw must have been called (searches JSONB)
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      // findMany must receive the IDs from $queryRaw
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: [ITEM_ID] } } }),
      );
      expect(result[0]).toMatchObject({ properties: { voltage: '18V', brand: 'Makita' } });
    });

    // Review round 2, finding 1c — the ?search= path must escape LIKE
    // metacharacters too, not just the searchByPhoto path.
    it('escapes LIKE metacharacters in the search term before querying', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);

      await service.list({ search: '50%_off\\path' });

      const [, patternArg] = prismaMock.$queryRaw.mock.calls[0];
      expect(patternArg).toBe('%50\\%\\_off\\\\path%');
    });

    // -----------------------------------------------------------------------
    // tag filter
    // -----------------------------------------------------------------------

    it('filter by tag — passes correct where clause to findMany', async () => {
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      await service.list({ tag: 'power-tool' });

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tags: { some: { tag: { name: 'power-tool' } } } },
        }),
      );
    });

    it('filter by tag — returns empty when no items have that tag', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      const result = await service.list({ tag: 'nonexistent-tag' });
      expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // locationId subtree filter
    // -----------------------------------------------------------------------

    it('filter by locationId — looks up location path then queries subtree', async () => {
      prismaMock.location.findUnique.mockResolvedValue({ id: LOC_ID, path: 'garage' });
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      await service.list({ locationId: LOC_ID });

      expect(prismaMock.location.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LOC_ID } }),
      );
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            location: {
              OR: [{ id: LOC_ID }, { path: { startsWith: 'garage.' } }],
            },
          },
        }),
      );
    });

    it('filter by locationId — returns empty array when locationId does not exist', async () => {
      prismaMock.location.findUnique.mockResolvedValue(null);
      const result = await service.list({ locationId: LOC_ID });
      expect(result).toEqual([]);
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // searchByPhoto (EVT-17)
  // =========================================================================

  describe('searchByPhoto', () => {
    const FILE_BUFFER = Buffer.from('fake-image-bytes');
    const MIME_TYPE = 'image/jpeg';

    function analysisWith(overrides: Record<string, unknown> = {}) {
      return {
        suggested_name: 'M4 hex bolt',
        description: '',
        tags: ['fastener'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: ['hex bolt', 'M4'],
        ...overrides,
      };
    }

    /** A row from the batched `matchingItemHitsForTerms` query. */
    function hitRow(id: string, term: string, createdAt = new Date('2026-01-01')) {
      return { id, term, createdAt };
    }

    // AC1: mocked vision output whose keywords match seeded items returns
    // ranked matches.
    it('AC1: keywords matching seeded items return ranked matches, most hits first', async () => {
      const analysis = analysisWith();
      aiMock.analyzePhoto.mockResolvedValue(analysis);

      // Terms (dedup order): "M4 hex bolt", "hex bolt", "M4", "fastener"
      // ITEM_ID matches all 4 terms; a second item matches only 1. Both hit
      // rows come back from the single batched query (review round 2,
      // finding 1b — no more one $queryRaw call per term).
      const OTHER_ID = '66666666-6666-6666-6666-666666666666';
      prismaMock.$queryRaw.mockResolvedValueOnce([
        hitRow(ITEM_ID, 'M4 hex bolt'),
        hitRow(ITEM_ID, 'hex bolt'),
        hitRow(OTHER_ID, 'hex bolt'),
        hitRow(ITEM_ID, 'M4'),
        hitRow(ITEM_ID, 'fastener'),
      ]);

      const bestMatch = makeItemRow({ id: ITEM_ID, name: 'M4 Hex Bolt (pack of 50)' });
      const weakMatch = makeItemRow({ id: OTHER_ID, name: 'Assorted hex bolts' });
      prismaMock.item.findMany.mockResolvedValue([weakMatch, bestMatch]);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(aiMock.analyzePhoto).toHaveBeenCalledWith(FILE_BUFFER, MIME_TYPE);
      expect(result.analysis).toBe(analysis);
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: [ITEM_ID, OTHER_ID] } },
        }),
      );
      expect(result.matches).toHaveLength(2);
      expect(result.matches[0].id).toBe(ITEM_ID);
      expect(result.matches[1].id).toBe(OTHER_ID);
    });

    // AC1: no-match returns empty list, 200 (200 itself is asserted at the
    // controller/e2e level — this asserts the service-level empty-array
    // contract the controller passes straight through).
    it('AC1: no-match returns an empty matches array', async () => {
      const analysis = analysisWith();
      aiMock.analyzePhoto.mockResolvedValue(analysis);
      prismaMock.$queryRaw.mockResolvedValue([]);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(result).toEqual({ analysis, matches: [] });
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });

    // Stub AI (no key) → empty keywords → empty matches, analysis echoed.
    it('stub analysis (no AI key) short-circuits to empty matches without querying', async () => {
      const stub = stubAnalysis();
      aiMock.analyzePhoto.mockResolvedValue(stub);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(result).toEqual({ analysis: stub, matches: [] });
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });

    it('matches item tags via the tag-name join, not just name/description/properties', async () => {
      const analysis = analysisWith({
        suggested_name: STUB_ANALYSIS.suggested_name,
        tags: ['power-tool'],
        search_keywords: [],
      });
      aiMock.analyzePhoto.mockResolvedValue(analysis);
      prismaMock.$queryRaw.mockResolvedValueOnce([hitRow(ITEM_ID, 'power-tool')]);
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.matches).toHaveLength(1);
    });

    // -----------------------------------------------------------------------
    // Review round 2, finding 1 — term cap, escaping, and response bound
    // -----------------------------------------------------------------------

    it('finding 1a/1b: caps the number of terms sent to the batched query at MAX_SEARCH_TERMS', async () => {
      const keywords = Array.from({ length: 30 }, (_, i) => `keyword-${i}`);
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({
          suggested_name: STUB_ANALYSIS.suggested_name,
          tags: [],
          search_keywords: keywords,
        }),
      );
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      const [, patternsArg] = prismaMock.$queryRaw.mock.calls[0] as [unknown, { values: string[] }];
      expect(patternsArg.values).toHaveLength(MAX_SEARCH_TERMS);
    });

    it('finding 1c: escapes a wildcard-only search term before it reaches the query', async () => {
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({ suggested_name: '%', tags: [], search_keywords: [] }),
      );
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      const [, patternsArg] = prismaMock.$queryRaw.mock.calls[0] as [unknown, { values: string[] }];
      // A raw '%' would match everything unescaped; escaped it only matches
      // a literal '%' character.
      expect(patternsArg.values).toEqual(['%\\%%']);
    });

    it('finding 1c: escapes an underscore-only search term before it reaches the query', async () => {
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({ suggested_name: '_', tags: [], search_keywords: [] }),
      );
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      const [, patternsArg] = prismaMock.$queryRaw.mock.calls[0] as [unknown, { values: string[] }];
      expect(patternsArg.values).toEqual(['%\\_%']);
    });

    it('finding 1d: caps the response to MAX_MATCHES even when far more items match', async () => {
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({
          suggested_name: STUB_ANALYSIS.suggested_name,
          tags: [],
          search_keywords: ['widget'],
        }),
      );

      const totalHits = MAX_MATCHES + 10;
      // Distinct createdAt per row (later index = newer) so ranking (equal
      // 1-hit counts, tie-broken by createdAt desc) is deterministic.
      const rows = Array.from({ length: totalHits }, (_, i) =>
        hitRow(
          `77770000-0000-0000-0000-${String(i).padStart(12, '0')}`,
          'widget',
          new Date(2026, 0, i + 1),
        ),
      );
      prismaMock.$queryRaw.mockResolvedValueOnce(rows);

      const expectedIds = [...rows]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, MAX_MATCHES)
        .map((r) => r.id);
      prismaMock.item.findMany.mockResolvedValue(expectedIds.map((id) => makeItemRow({ id })));

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: expectedIds } } }),
      );
      expect(result.matches).toHaveLength(MAX_MATCHES);
    });

    // -----------------------------------------------------------------------
    // Review round 2, finding 3 — ranking tie-break is a tested contract
    // -----------------------------------------------------------------------

    it('finding 3: ranking tie-break — equal distinct-hit counts fall back to createdAt desc', async () => {
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({
          suggested_name: STUB_ANALYSIS.suggested_name,
          tags: [],
          search_keywords: ['widget'],
        }),
      );

      const OLDER_ID = '77777777-7777-7777-7777-777777777777';
      const NEWER_ID = '88888888-8888-8888-8888-888888888888';
      prismaMock.$queryRaw.mockResolvedValueOnce([
        hitRow(OLDER_ID, 'widget', new Date('2026-01-01')),
        hitRow(NEWER_ID, 'widget', new Date('2026-02-01')),
      ]);
      // findMany returns them in an arbitrary order — the service must
      // re-sort by rank, not trust findMany's own ordering.
      prismaMock.item.findMany.mockResolvedValue([
        makeItemRow({ id: OLDER_ID }),
        makeItemRow({ id: NEWER_ID }),
      ]);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE);

      expect(result.matches.map((m) => m.id)).toEqual([NEWER_ID, OLDER_ID]);
    });
  });

  // =========================================================================
  // escapeLikePattern (EVT-17 review round 2, finding 1c)
  // =========================================================================

  describe('escapeLikePattern', () => {
    it('escapes backslash, percent, and underscore', () => {
      expect(escapeLikePattern('50%_off\\path')).toBe('50\\%\\_off\\\\path');
    });

    it('a lone "%" is escaped to a literal-match pattern, not a LIKE wildcard', () => {
      expect(escapeLikePattern('%')).toBe('\\%');
    });

    it('a lone "_" is escaped to a literal-match pattern, not a LIKE single-char wildcard', () => {
      expect(escapeLikePattern('_')).toBe('\\_');
    });

    it('leaves ordinary text untouched', () => {
      expect(escapeLikePattern('hex bolt')).toBe('hex bolt');
    });
  });

  // =========================================================================
  // buildSearchTerms (EVT-17)
  // =========================================================================

  describe('buildSearchTerms', () => {
    it('combines suggested_name, search_keywords, and tags', () => {
      const terms = buildSearchTerms({
        suggested_name: 'M4 hex bolt',
        description: '',
        tags: ['fastener'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: ['hex bolt'],
      });
      expect(terms).toEqual(['M4 hex bolt', 'hex bolt', 'fastener']);
    });

    it('excludes the bare stub suggested_name placeholder', () => {
      const terms = buildSearchTerms(stubAnalysis());
      expect(terms).toEqual([]);
    });

    it('dedupes case-insensitively and trims whitespace', () => {
      const terms = buildSearchTerms({
        suggested_name: '  M4 Bolt  ',
        description: '',
        tags: ['m4 bolt', 'Fastener'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [' ', 'fastener'],
      });
      expect(terms).toEqual(['M4 Bolt', 'fastener']);
    });

    // Review round 2, finding 1a
    it('caps the term list at MAX_SEARCH_TERMS, keeping suggested_name first then keywords/tags in order', () => {
      const keywords = Array.from({ length: 15 }, (_, i) => `keyword-${i}`);
      const terms = buildSearchTerms({
        suggested_name: 'Widget',
        description: '',
        tags: ['tag-a', 'tag-b'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: keywords,
      });

      expect(terms).toHaveLength(MAX_SEARCH_TERMS);
      expect(terms).toEqual(['Widget', ...keywords.slice(0, MAX_SEARCH_TERMS - 1)]);
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('returns the item when found', async () => {
      const detail = makeItemDetail();
      prismaMock.item.findUnique.mockResolvedValue(detail);

      const result = await service.findById(ITEM_ID);
      expect(result).toBe(detail);
      expect(prismaMock.item.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID } }),
      );
    });

    it('throws NotFoundException when item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(NotFoundException);
    });

    it('includes the item id in the NotFoundException message', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.findById('bad-id')).rejects.toThrow(/bad-id/);
    });
  });

  // =========================================================================
  // findByQr — AC 2
  // =========================================================================

  describe('findByQr', () => {
    it('AC2: returns { kind: "item", item } for an item QR token', async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);

      const result = await service.findByQr(QR_ITEM);

      expect(result.kind).toBe('item');
      expect(result.item).toBe(detail);
    });

    it('AC2: returns { kind: "location", location } for a location QR token', async () => {
      // Item lookup returns null; location lookup returns a location
      prismaMock.item.findUnique.mockResolvedValue(null);
      const loc = makeLocationRow({ qrCode: QR_LOC });
      prismaMock.location.findUnique.mockResolvedValue(loc);

      const result = await service.findByQr(QR_LOC);

      expect(result.kind).toBe('location');
      expect((result as { kind: 'location'; location: typeof loc }).location).toBe(loc);
    });

    it('AC2: throws NotFoundException for an unknown QR token (404)', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.findByQr('unknown-token')).rejects.toThrow(NotFoundException);
    });

    it('AC2: NotFoundException message mentions the unknown token', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.findByQr('mystery-qr')).rejects.toThrow(/mystery-qr/);
    });

    it('checks item table before location table', async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);
      // location.findUnique should NOT be called when item is found
      prismaMock.location.findUnique.mockResolvedValue(makeLocationRow());

      const result = await service.findByQr(QR_ITEM);

      expect(result.kind).toBe('item');
      expect(prismaMock.location.findUnique).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('creates an item and returns the detail', async () => {
      const detail = makeItemDetail();
      prismaMock.item.create.mockResolvedValue(detail);
      tagsMock.upsertMany.mockResolvedValue([]);

      const result = await service.create({ name: 'Cordless Drill' });

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ name: 'Cordless Drill' }),
        }),
      );
      expect(result).toBe(detail);
    });

    it('upserts tags and connects them to the item', async () => {
      tagsMock.upsertMany.mockResolvedValue([TAG_ID]);
      prismaMock.item.create.mockResolvedValue(makeItemDetail());

      await service.create({ name: 'Drill', tags: ['power-tool'] });

      expect(tagsMock.upsertMany).toHaveBeenCalledWith(['power-tool']);
      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: { create: [{ tagId: TAG_ID }] },
          }),
        }),
      );
    });

    it('sets the first photoId as primaryPhotoId', async () => {
      const photoId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      prismaMock.item.create.mockResolvedValue(makeItemDetail({ primaryPhotoId: photoId }));
      tagsMock.upsertMany.mockResolvedValue([]);

      await service.create({ name: 'Item', photoIds: [photoId] });

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ primaryPhotoId: photoId }),
        }),
      );
    });

    it('defaults properties to {} when not provided', async () => {
      prismaMock.item.create.mockResolvedValue(makeItemDetail());
      tagsMock.upsertMany.mockResolvedValue([]);

      await service.create({ name: 'Drill' });

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ properties: {} }),
        }),
      );
    });

    it('does not call tagsService when tags array is empty or omitted', async () => {
      prismaMock.item.create.mockResolvedValue(makeItemDetail());

      await service.create({ name: 'Drill' });
      expect(tagsMock.upsertMany).not.toHaveBeenCalled();

      await service.create({ name: 'Drill', tags: [] });
      expect(tagsMock.upsertMany).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // update — AC 1 (patch tags)
  // =========================================================================

  describe('update', () => {
    it('AC1 patch-tags: replaces tag list when tags array is provided', async () => {
      const NEW_TAG_ID = '44444444-4444-4444-4444-444444444444';
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      tagsMock.upsertMany.mockResolvedValue([NEW_TAG_ID]);
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { tags: ['hand-tool'] });

      expect(prismaMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ITEM_ID },
          data: expect.objectContaining({
            tags: expect.objectContaining({
              deleteMany: {},
              create: [{ tagId: NEW_TAG_ID }],
            }),
          }),
        }),
      );
    });

    it('clears all tags when tags is set to empty array', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { tags: [] });

      expect(prismaMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tags: expect.objectContaining({ deleteMany: {} }),
          }),
        }),
      );
      // upsertMany should NOT be called for an empty tag list
      expect(tagsMock.upsertMany).not.toHaveBeenCalled();
    });

    it('does not modify tags when tags field is omitted from the DTO', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { name: 'New Name' });

      // data should NOT contain a tags key
      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('tags');
    });

    it('throws NotFoundException when item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.update(ITEM_ID, { name: 'X' })).rejects.toThrow(NotFoundException);
    });

    it('returns the updated item', async () => {
      const updated = makeItemDetail({ name: 'Updated Drill' });
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(updated);

      const result = await service.update(ITEM_ID, { name: 'Updated Drill' });
      expect(result).toBe(updated);
    });
  });

  // =========================================================================
  // remove — AC 1 (delete)
  // =========================================================================

  describe('remove', () => {
    it('AC1 delete: deletes the item successfully', async () => {
      prismaMock.item.delete.mockResolvedValue(makeItemDetail());

      await service.remove(ITEM_ID);

      expect(prismaMock.item.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    });

    it('throws NotFoundException when item does not exist (P2025)', async () => {
      const p2025 = new Prisma.PrismaClientKnownRequestError('Record to delete not found', {
        code: 'P2025',
        clientVersion: '5.22.0',
      });
      prismaMock.item.delete.mockRejectedValue(p2025);

      await expect(service.remove('nonexistent-id')).rejects.toThrow(NotFoundException);
    });

    it('re-throws non-P2025 Prisma errors unchanged', async () => {
      const otherErr = new Prisma.PrismaClientKnownRequestError('Other error', {
        code: 'P2003',
        clientVersion: '5.22.0',
      });
      prismaMock.item.delete.mockRejectedValue(otherErr);

      await expect(service.remove(ITEM_ID)).rejects.toThrow(otherErr);
    });

    it('re-throws generic errors unchanged', async () => {
      const err = new Error('DB connection lost');
      prismaMock.item.delete.mockRejectedValue(err);

      await expect(service.remove(ITEM_ID)).rejects.toThrow(err);
    });
  });

  // =========================================================================
  // AC 1: Full CRUD flow (create → list → search → tag filter → location
  //         filter → patch tags → delete)
  // =========================================================================

  describe('AC1: full CRUD flow', () => {
    it('create → list → search hit → search miss → tag filter → location filter → patch tags → delete', async () => {
      // ---- 1. CREATE -------------------------------------------------------
      const created = makeItemDetail();
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([TAG_ID]);

      const item = await service.create({ name: 'Cordless Drill', tags: ['power-tool'] });
      expect(item.id).toBe(ITEM_ID);

      // ---- 2. LIST ---------------------------------------------------------
      prismaMock.item.findMany.mockResolvedValue([created]);
      const listed = await service.list({});
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(ITEM_ID);

      // ---- 3. SEARCH HIT ---------------------------------------------------
      prismaMock.$queryRaw.mockResolvedValue([{ id: ITEM_ID }]);
      prismaMock.item.findMany.mockResolvedValue([created]);
      const hits = await service.list({ search: 'drill' });
      expect(hits).toHaveLength(1);

      // ---- 4. SEARCH MISS --------------------------------------------------
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);
      const misses = await service.list({ search: 'unicorn' });
      expect(misses).toHaveLength(0);

      // ---- 5. TAG FILTER ---------------------------------------------------
      prismaMock.item.findMany.mockResolvedValue([created]);
      const byTag = await service.list({ tag: 'power-tool' });
      expect(byTag).toHaveLength(1);
      expect(prismaMock.item.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { tags: { some: { tag: { name: 'power-tool' } } } },
        }),
      );

      // ---- 6. LOCATION SUBTREE FILTER --------------------------------------
      prismaMock.location.findUnique.mockResolvedValue({ id: LOC_ID, path: 'garage' });
      prismaMock.item.findMany.mockResolvedValue([created]);
      const byLoc = await service.list({ locationId: LOC_ID });
      expect(byLoc).toHaveLength(1);

      // ---- 7. PATCH TAGS ---------------------------------------------------
      const NEW_TAG_ID = '55555555-5555-5555-5555-555555555555';
      prismaMock.item.findUnique.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([NEW_TAG_ID]);
      prismaMock.item.update.mockResolvedValue(
        makeItemDetail({
          tags: [
            {
              itemId: ITEM_ID,
              tagId: NEW_TAG_ID,
              tag: { id: NEW_TAG_ID, name: 'hand-tool', color: null },
            },
          ],
        }),
      );
      const patched = await service.update(ITEM_ID, { tags: ['hand-tool'] });
      expect(patched.tags[0].tag.name).toBe('hand-tool');

      // ---- 8. DELETE -------------------------------------------------------
      prismaMock.item.delete.mockResolvedValue(undefined);
      await service.remove(ITEM_ID);
      expect(prismaMock.item.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    });
  });
});
