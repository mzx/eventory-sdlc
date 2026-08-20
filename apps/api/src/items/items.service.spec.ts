import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { AiService, STUB_ANALYSIS, stubAnalysis } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { TagsService } from '../tags/tags.service';
import {
  buildSearchTerms,
  daysOverdue,
  escapeLikePattern,
  ItemsService,
  MAX_MATCHES,
  MAX_SEARCH_TERMS,
  OPPORTUNISTIC_PROMPT_FLOOR,
  VERIFICATION_QUEUE_CAP,
} from './items.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const LOC_ID = '22222222-2222-2222-2222-222222222222';
const TAG_ID = '33333333-3333-3333-3333-333333333333';
const QR_ITEM = 'qr-item-token';
const QR_LOC = 'qr-loc-token';
const WORKSPACE_ID = '77777777-7777-7777-7777-777777777777';
const OTHER_WORKSPACE_ID = '88888888-8888-8888-8888-888888888888';
const USER_FOR_QR = '99999999-9999-9999-9999-999999999999';

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
    workspaceId: WORKSPACE_ID,
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
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

function makePrismaMock() {
  const mock = {
    item: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    location: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    // EVT-40 write-path workspace-consistency guards.
    category: {
      findFirst: jest.fn(),
    },
    photo: {
      count: jest.fn(),
    },
    // EVT-40 QR scan-landing membership check.
    workspaceMember: {
      findUnique: jest.fn(),
    },
    $queryRaw: jest.fn(),
    // EVT-44: `findByQr` issues `tx.$executeRaw` (the `app.rls_bypass_read`
    // RLS flag) as the first statement of its own `$transaction` — see that
    // method's doc comment.
    $executeRaw: jest.fn(),
    // `create`/`update` (EVT-25) run inside `this.prisma.$transaction(...)`
    // so the movement + item writes are atomic. The mock just invokes the
    // callback with itself as `tx` — every `tx.item.*` call inside the
    // callback lands on the exact same jest.fn()s asserted on below.
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((cb: (tx: typeof mock) => unknown) => cb(mock));
  return mock;
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

function makeStockMovementsMock() {
  return {
    recordMovement: jest.fn(),
    recordConsumption: jest.fn(),
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
  let stockMovementsMock: ReturnType<typeof makeStockMovementsMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    tagsMock = makeTagsMock();
    aiMock = makeAiServiceMock();
    stockMovementsMock = makeStockMovementsMock();

    // EVT-40 write-path workspace-consistency guards default to "found /
    // in-workspace" — the handful of tests that exercise the foreign-
    // reference 404 paths override these per-test.
    prismaMock.location.findFirst.mockResolvedValue({ id: LOC_ID });
    prismaMock.category.findFirst.mockResolvedValue({ id: 'category-1' });
    // `assertPhotosInWorkspace` compares `count !== photoIds.length` — this
    // default makes that check pass for ANY photoIds array by construction
    // (count always equals what was queried), so tests that pass photoIds
    // incidentally (not to test workspace scoping itself) don't need their
    // own mock.
    prismaMock.photo.count.mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => args.where.id.in.length,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TagsService, useValue: tagsMock },
        { provide: AiService, useValue: aiMock },
        { provide: StockMovementsService, useValue: stockMovementsMock },
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

      const result = await service.list({}, WORKSPACE_ID);

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: WORKSPACE_ID },
          orderBy: { createdAt: 'desc' },
        }),
      );
      expect(result).toBe(rows);
    });

    it('returns an empty array when no items exist', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      expect(await service.list({}, WORKSPACE_ID)).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // search filter
    // -----------------------------------------------------------------------

    it('search hit — calls $queryRaw and passes matching IDs to findMany', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ id: ITEM_ID }]);
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      const result = await service.list({ search: 'drill' }, WORKSPACE_ID);

      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, id: { in: [ITEM_ID] } } }),
      );
      expect(result).toHaveLength(1);
    });

    it('search miss — $queryRaw returns no IDs, findMany called with empty in array', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);

      const result = await service.list({ search: 'nonexistent-xyz' }, WORKSPACE_ID);

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, id: { in: [] } } }),
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

      const result = await service.list({ search: '18V' }, WORKSPACE_ID);

      // $queryRaw must have been called (searches JSONB)
      expect(prismaMock.$queryRaw).toHaveBeenCalled();
      // findMany must receive the IDs from $queryRaw
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, id: { in: [ITEM_ID] } } }),
      );
      expect(result[0]).toMatchObject({ properties: { voltage: '18V', brand: 'Makita' } });
    });

    // Review round 2, finding 1c — the ?search= path must escape LIKE
    // metacharacters too, not just the searchByPhoto path.
    it('escapes LIKE metacharacters in the search term before querying', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);

      await service.list({ search: '50%_off\\path' }, WORKSPACE_ID);

      const queryArgs = prismaMock.$queryRaw.mock.calls[0];
      expect(queryArgs).toContain('%50\\%\\_off\\\\path%');
    });

    // EVT-40 — the raw search query itself is scoped, not just the outer
    // `where.workspaceId` findMany filter (defense in depth: this is what
    // the review round explicitly calls "any unscoped query is critical").
    it('EVT-40: scopes the raw search query to workspaceId', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);

      await service.list({ search: 'drill' }, WORKSPACE_ID);

      const queryArgs = prismaMock.$queryRaw.mock.calls[0];
      expect(queryArgs).toContain(WORKSPACE_ID);
    });

    // -----------------------------------------------------------------------
    // tag filter
    // -----------------------------------------------------------------------

    it('filter by tag — passes correct where clause to findMany', async () => {
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      await service.list({ tag: 'power-tool' }, WORKSPACE_ID);

      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: WORKSPACE_ID,
            tags: { some: { tag: { name: 'power-tool' } } },
          },
        }),
      );
    });

    it('filter by tag — returns empty when no items have that tag', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      const result = await service.list({ tag: 'nonexistent-tag' }, WORKSPACE_ID);
      expect(result).toEqual([]);
    });

    // -----------------------------------------------------------------------
    // locationId subtree filter
    // -----------------------------------------------------------------------

    it('filter by locationId — looks up location path (scoped to workspace) then queries subtree', async () => {
      prismaMock.location.findFirst.mockResolvedValue({ id: LOC_ID, path: 'garage' });
      prismaMock.item.findMany.mockResolvedValue([makeItemRow()]);

      await service.list({ locationId: LOC_ID }, WORKSPACE_ID);

      expect(prismaMock.location.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LOC_ID, workspaceId: WORKSPACE_ID } }),
      );
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: WORKSPACE_ID,
            location: {
              OR: [{ id: LOC_ID }, { path: { startsWith: 'garage.' } }],
            },
          },
        }),
      );
    });

    it('filter by locationId — returns empty array when locationId does not exist', async () => {
      prismaMock.location.findFirst.mockResolvedValue(null);
      const result = await service.list({ locationId: LOC_ID }, WORKSPACE_ID);
      expect(result).toEqual([]);
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });

    it('EVT-40: returns empty array (not a leak) when locationId belongs to a different workspace', async () => {
      // findFirst is scoped by workspaceId, so a foreign location's row
      // simply never matches — same "unknown locationId" outcome as above.
      prismaMock.location.findFirst.mockResolvedValue(null);
      const result = await service.list({ locationId: LOC_ID }, OTHER_WORKSPACE_ID);
      expect(result).toEqual([]);
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

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

      expect(result).toEqual({ analysis, matches: [] });
      expect(prismaMock.item.findMany).not.toHaveBeenCalled();
    });

    // Stub AI (no key) → empty keywords → empty matches, analysis echoed.
    it('stub analysis (no AI key) short-circuits to empty matches without querying', async () => {
      const stub = stubAnalysis();
      aiMock.analyzePhoto.mockResolvedValue(stub);

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      const [, patternsArg] = prismaMock.$queryRaw.mock.calls[0] as [unknown, { values: string[] }];
      expect(patternsArg.values).toHaveLength(MAX_SEARCH_TERMS);
    });

    it('finding 1c: escapes a wildcard-only search term before it reaches the query', async () => {
      aiMock.analyzePhoto.mockResolvedValue(
        analysisWith({ suggested_name: '%', tags: [], search_keywords: [] }),
      );
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

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

      const result = await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

      expect(result.matches.map((m) => m.id)).toEqual([NEWER_ID, OLDER_ID]);
    });

    // -----------------------------------------------------------------------
    // EVT-40 — the batched matching query is scoped to workspaceId
    // -----------------------------------------------------------------------

    it('EVT-40: scopes the batched matching query to workspaceId', async () => {
      aiMock.analyzePhoto.mockResolvedValue(analysisWith());
      prismaMock.$queryRaw.mockResolvedValueOnce([]);

      await service.searchByPhoto(FILE_BUFFER, MIME_TYPE, WORKSPACE_ID);

      const calledWith = prismaMock.$queryRaw.mock.calls[0];
      expect(calledWith).toContain(WORKSPACE_ID);
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
    it("returns the item when found in the caller's workspace", async () => {
      const detail = makeItemDetail();
      prismaMock.item.findFirst.mockResolvedValue(detail);

      const result = await service.findById(ITEM_ID, WORKSPACE_ID);
      expect(result).toBe(detail);
      expect(prismaMock.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('throws NotFoundException when item does not exist', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.findById('bad-id', WORKSPACE_ID)).rejects.toThrow(NotFoundException);
    });

    it('includes the item id in the NotFoundException message', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.findById('bad-id', WORKSPACE_ID)).rejects.toThrow(/bad-id/);
    });

    it('EVT-40 AC 2: 404s for an item that exists but belongs to a different workspace', async () => {
      // findFirst is scoped by workspaceId — a foreign item simply never
      // matches, same "not found" outcome as a genuinely unknown id.
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.findById(ITEM_ID, OTHER_WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // findByQr — EVT-40 AC 4: QR scan-landing, membership-scoped (not the
  // caller's currently-selected workspace)
  // =========================================================================

  describe('findByQr', () => {
    it('AC2/AC4: returns { kind: "item", item } for an item QR token when the caller is a member of its workspace', async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({ userId: USER_FOR_QR });

      const result = await service.findByQr(QR_ITEM, USER_FOR_QR);

      expect(result.kind).toBe('item');
      expect(result.item).toBe(detail);
      expect(prismaMock.workspaceMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: USER_FOR_QR } },
        }),
      );
    });

    it('AC2: returns { kind: "location", location } for a location QR token when the caller is a member', async () => {
      // Item lookup returns null; location lookup returns a location
      prismaMock.item.findUnique.mockResolvedValue(null);
      const loc = makeLocationRow({ qrCode: QR_LOC, workspaceId: WORKSPACE_ID });
      prismaMock.location.findUnique.mockResolvedValue(loc);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({ userId: USER_FOR_QR });

      const result = await service.findByQr(QR_LOC, USER_FOR_QR);

      expect(result.kind).toBe('location');
      const { id, name, path, parentId, notes } = loc;
      const expectedLocation = { id, name, path, parentId, notes };
      expect((result as { kind: 'location'; location: typeof expectedLocation }).location).toEqual(
        expectedLocation,
      );
    });

    it('AC2: throws NotFoundException for an unknown QR token (404)', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.findByQr('unknown-token', USER_FOR_QR)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('AC2: NotFoundException message mentions the unknown token', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.findByQr('mystery-qr', USER_FOR_QR)).rejects.toThrow(/mystery-qr/);
    });

    it('checks item table before location table', async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({ userId: USER_FOR_QR });
      // location.findUnique should NOT be called when item is found
      prismaMock.location.findUnique.mockResolvedValue(makeLocationRow());

      const result = await service.findByQr(QR_ITEM, USER_FOR_QR);

      expect(result.kind).toBe('item');
      expect(prismaMock.location.findUnique).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // EVT-40 AC 4 — neutral 404 for a caller who is NOT a member of the
    // resolved resource's workspace (never distinguishes "wrong workspace"
    // from "doesn't exist").
    // -----------------------------------------------------------------------

    it("AC4: a non-member of the item's workspace gets the same neutral 404 as an unknown token", async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findByQr(QR_ITEM, 'non-member-user')).rejects.toThrow(NotFoundException);
    });

    it("AC4: a non-member of the location's workspace gets the same neutral 404 as an unknown token", async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(makeLocationRow({ qrCode: QR_LOC }));
      prismaMock.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.findByQr(QR_LOC, 'non-member-user')).rejects.toThrow(NotFoundException);
    });

    it("AC4: does NOT scope the token lookup itself by the caller's current workspace — the raw qrCode lookup stays global", async () => {
      const detail = makeItemDetail({ qrCode: QR_ITEM });
      prismaMock.item.findUnique.mockResolvedValue(detail);
      prismaMock.workspaceMember.findUnique.mockResolvedValue({ userId: USER_FOR_QR });

      await service.findByQr(QR_ITEM, USER_FOR_QR);

      expect(prismaMock.item.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { qrCode: QR_ITEM } }),
      );
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    /** Default `recordMovement` stub: brings quantity up to `quantity` and returns `detail`. */
    function stubRecordMovement(detail: ReturnType<typeof makeItemDetail>) {
      stockMovementsMock.recordMovement.mockResolvedValue({
        movement: { id: 'mv-1', kind: 'add' },
        item: detail,
      });
    }

    it('creates the row with quantity: 0, stamped with workspaceId, and returns the recordMovement-stocked detail', async () => {
      const detail = makeItemDetail({ quantity: 1 });
      prismaMock.item.create.mockResolvedValue(makeItemRow({ quantity: 0, locationId: LOC_ID }));
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(detail);

      const result = await service.create({ name: 'Cordless Drill' }, undefined, WORKSPACE_ID);

      // EVT-25: quantity is never written directly at create time — the row
      // starts at 0 and recordMovement brings it up to the requested value.
      // EVT-40: workspaceId is stamped explicitly, not left to the schema default.
      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Cordless Drill',
            quantity: 0,
            workspaceId: WORKSPACE_ID,
          }),
        }),
      );
      expect(result).toBe(detail);
    });

    it('EVT-25: quantity omitted defaults to 1 and records an "add" movement for that delta', async () => {
      const created = makeItemRow({ quantity: 0, locationId: LOC_ID });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail());

      await service.create({ name: 'Drill' }, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock, // tx === prismaMock, since $transaction invokes the callback with itself
        expect.objectContaining({
          itemId: created.id,
          kind: 'add',
          delta: 1,
          toLocationId: LOC_ID,
          note: 'Initial intake',
        }),
        expect.anything(),
      );
    });

    it('EVT-25 AC 1: an explicit starting quantity records an "add" movement with that exact delta', async () => {
      const created = makeItemRow({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail({ quantity: 5 }));

      await service.create({ name: 'Drill', quantity: 5 }, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ kind: 'add', delta: 5 }),
        expect.anything(),
      );
    });

    it('EVT-25: a starting quantity of 0 writes no movement and returns the created row directly', async () => {
      const created = makeItemDetail({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);

      const result = await service.create({ name: 'Drill', quantity: 0 }, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('upserts tags (scoped to the workspace) and connects them to the item', async () => {
      tagsMock.upsertMany.mockResolvedValue([TAG_ID]);
      const created = makeItemRow({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      stubRecordMovement(makeItemDetail());

      await service.create({ name: 'Drill', tags: ['power-tool'] }, undefined, WORKSPACE_ID);

      expect(tagsMock.upsertMany).toHaveBeenCalledWith(['power-tool'], WORKSPACE_ID);
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
      const created = makeItemRow({ quantity: 0, primaryPhotoId: photoId });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail({ primaryPhotoId: photoId }));

      await service.create({ name: 'Item', photoIds: [photoId] }, undefined, WORKSPACE_ID);

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ primaryPhotoId: photoId }),
        }),
      );
    });

    it('defaults properties to {} when not provided', async () => {
      const created = makeItemRow({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail());

      await service.create({ name: 'Drill' }, undefined, WORKSPACE_ID);

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ properties: {} }),
        }),
      );
    });

    it('does not call tagsService when tags array is empty or omitted', async () => {
      const created = makeItemRow({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      stubRecordMovement(makeItemDetail());

      await service.create({ name: 'Drill' }, undefined, WORKSPACE_ID);
      expect(tagsMock.upsertMany).not.toHaveBeenCalled();

      await service.create({ name: 'Drill', tags: [] }, undefined, WORKSPACE_ID);
      expect(tagsMock.upsertMany).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // EVT-14: createdById stamping
    // -----------------------------------------------------------------------

    it('EVT-14: stamps createdById when provided', async () => {
      const userId = '99999999-9999-9999-9999-999999999999';
      const created = makeItemRow({ quantity: 0, createdById: userId });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail({ createdById: userId }));

      await service.create({ name: 'Drill' }, userId, WORKSPACE_ID);

      expect(prismaMock.item.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdById: userId }) }),
      );
      // Also attributed on the movement itself.
      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ createdById: userId }),
        expect.anything(),
      );
    });

    it('EVT-14: omits createdById from the write when not provided', async () => {
      const created = makeItemRow({ quantity: 0 });
      prismaMock.item.create.mockResolvedValue(created);
      tagsMock.upsertMany.mockResolvedValue([]);
      stubRecordMovement(makeItemDetail());

      await service.create({ name: 'Drill' }, undefined, WORKSPACE_ID);

      const createArg = prismaMock.item.create.mock.calls[0][0];
      expect(createArg.data).not.toHaveProperty('createdById');
    });

    // -----------------------------------------------------------------------
    // EVT-40 — write-path workspace-consistency guards
    // -----------------------------------------------------------------------

    it('EVT-40: throws NotFoundException when locationId belongs to a different workspace', async () => {
      prismaMock.location.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Drill', locationId: LOC_ID }, undefined, WORKSPACE_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.item.create).not.toHaveBeenCalled();
    });

    it('EVT-40: throws NotFoundException when categoryId belongs to a different workspace', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Drill', categoryId: 'cat-1' }, undefined, WORKSPACE_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.item.create).not.toHaveBeenCalled();
    });

    it('EVT-40: throws NotFoundException when a photoId belongs to a different workspace', async () => {
      prismaMock.photo.count.mockResolvedValue(0); // 0 of 1 requested photoIds found in-workspace

      await expect(
        service.create({ name: 'Drill', photoIds: ['foreign-photo'] }, undefined, WORKSPACE_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.item.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // receive (EVT-31 AC 4) — "add to existing" barcode receiving
  // =========================================================================

  describe('receive', () => {
    it('records an "add" movement for the given quantity against an existing item in-workspace', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID, locationId: LOC_ID });
      const received = makeItemDetail({ quantity: 125 });
      stockMovementsMock.recordMovement.mockResolvedValue({
        movement: { id: 'mv-1', kind: 'add' },
        item: received,
      });

      const result = await service.receive(ITEM_ID, 25, undefined, WORKSPACE_ID);

      expect(prismaMock.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID, workspaceId: WORKSPACE_ID } }),
      );
      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'add',
          delta: 25,
          toLocationId: LOC_ID,
        }),
        expect.anything(),
      );
      expect(result).toBe(received);
    });

    it('attributes the movement to the caller when createdById is provided', async () => {
      const userId = '99999999-9999-9999-9999-999999999999';
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID, locationId: null });
      stockMovementsMock.recordMovement.mockResolvedValue({
        movement: { id: 'mv-1', kind: 'add' },
        item: makeItemDetail(),
      });

      await service.receive(ITEM_ID, 10, userId, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({ createdById: userId }),
        expect.anything(),
      );
    });

    it('throws NotFoundException for an unknown item and never calls recordMovement', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);

      await expect(service.receive(ITEM_ID, 10, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
    });

    it('EVT-40: throws NotFoundException for an item belonging to a different workspace', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);

      await expect(service.receive(ITEM_ID, 10, undefined, OTHER_WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
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

      await service.update(ITEM_ID, { tags: ['hand-tool'] }, undefined, WORKSPACE_ID);

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

      await service.update(ITEM_ID, { tags: [] }, undefined, WORKSPACE_ID);

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

      await service.update(ITEM_ID, { name: 'New Name' }, undefined, WORKSPACE_ID);

      // data should NOT contain a tags key
      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('tags');
    });

    it('throws NotFoundException when item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.update(ITEM_ID, { name: 'X' }, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the updated item', async () => {
      const updated = makeItemDetail({ name: 'Updated Drill' });
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(updated);

      const result = await service.update(
        ITEM_ID,
        { name: 'Updated Drill' },
        undefined,
        WORKSPACE_ID,
      );
      expect(result).toBe(updated);
    });

    // -------------------------------------------------------------------------
    // Round-3 review fix: explicit null clears locationId/categoryId, while an
    // omitted key leaves the relation unchanged.
    // -------------------------------------------------------------------------

    it('EVT-25 AC 4: clearing locationId with explicit null records a "move" movement (LOC_ID -> null)', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail()); // current.locationId === LOC_ID
      prismaMock.item.update.mockResolvedValue(makeItemDetail());
      stockMovementsMock.recordMovement.mockResolvedValue({
        movement: { id: 'mv-1', kind: 'move' },
        item: makeItemDetail({ locationId: null }),
      });

      const result = await service.update(ITEM_ID, { locationId: null }, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'move',
          delta: 0,
          fromLocationId: LOC_ID,
          toLocationId: null,
        }),
        expect.anything(),
      );
      // The plain scalar update no longer carries locationId directly —
      // recordMovement is the only path that writes it (AC 2).
      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('locationId');
      expect(result.locationId).toBeNull();
    });

    it('clears categoryId when explicit null is provided', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail({ categoryId: null }));

      await service.update(ITEM_ID, { categoryId: null }, undefined, WORKSPACE_ID);

      expect(prismaMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ categoryId: null }),
        }),
      );
    });

    it('leaves locationId unchanged when the key is omitted from the DTO', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { name: 'New Name' }, undefined, WORKSPACE_ID);

      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('locationId');
      expect(updateCall.data).not.toHaveProperty('categoryId');
      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // EVT-27: lastVerifiedAt conversion (review round 2, test-reviewer finding)
    // -------------------------------------------------------------------------

    it('EVT-27: converts a lastVerifiedAt ISO string to a Date on the scalar update', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(
        ITEM_ID,
        { lastVerifiedAt: '2026-08-01T00:00:00.000Z' },
        undefined,
        WORKSPACE_ID,
      );

      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data.lastVerifiedAt).toBeInstanceOf(Date);
      expect((updateCall.data.lastVerifiedAt as Date).toISOString()).toBe(
        '2026-08-01T00:00:00.000Z',
      );
    });

    it('EVT-27: clears lastVerifiedAt with explicit null', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { lastVerifiedAt: null }, undefined, WORKSPACE_ID);

      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data.lastVerifiedAt).toBeNull();
    });

    it('EVT-27: leaves lastVerifiedAt unchanged when the key is omitted from the DTO', async () => {
      prismaMock.item.findUnique.mockResolvedValue(makeItemDetail());
      prismaMock.item.update.mockResolvedValue(makeItemDetail());

      await service.update(ITEM_ID, { name: 'New Name' }, undefined, WORKSPACE_ID);

      const updateCall = prismaMock.item.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty('lastVerifiedAt');
    });

    // -------------------------------------------------------------------------
    // EVT-25 — stock movement ledger
    // -------------------------------------------------------------------------

    describe('EVT-25: stock movement ledger', () => {
      it('AC 2/3: quantity is never written on the plain scalar update — only via recordMovement', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'adjust' },
          item: makeItemDetail({ quantity: 7 }),
        });

        await service.update(ITEM_ID, { quantity: 7 }, undefined, WORKSPACE_ID);

        const updateCall = prismaMock.item.update.mock.calls[0][0];
        expect(updateCall.data).not.toHaveProperty('quantity');
      });

      it('AC 3: editing quantity from N to M records an "adjust" movement with delta M-N', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'adjust', delta: 4 },
          item: makeItemDetail({ quantity: 7 }),
        });

        const result = await service.update(ITEM_ID, { quantity: 7 }, undefined, WORKSPACE_ID);

        expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
          prismaMock,
          expect.objectContaining({ itemId: ITEM_ID, kind: 'adjust', delta: 4 }),
          expect.anything(),
        );
        expect(result.quantity).toBe(7);
      });

      it('AC 3: a negative delta (M < N) is passed through unchanged', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 10 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 10 }));
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'adjust', delta: -6 },
          item: makeItemDetail({ quantity: 4 }),
        });

        await service.update(ITEM_ID, { quantity: 4 }, undefined, WORKSPACE_ID);

        expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
          prismaMock,
          expect.objectContaining({ kind: 'adjust', delta: -6 }),
          expect.anything(),
        );
      });

      it('writes no movement when quantity is present in the DTO but unchanged', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 5 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 5 }));

        await service.update(
          ITEM_ID,
          { quantity: 5, name: 'Same qty, new name' },
          undefined,
          WORKSPACE_ID,
        );

        expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      });

      it('AC 4: moving to a new location records a "move" movement carrying both location ids', async () => {
        const NEW_LOC_ID = '77777777-7777-7777-7777-777777777777';
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail()); // current.locationId === LOC_ID
        prismaMock.item.update.mockResolvedValue(makeItemDetail());
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'move' },
          item: makeItemDetail({ locationId: NEW_LOC_ID }),
        });

        const result = await service.update(
          ITEM_ID,
          { locationId: NEW_LOC_ID },
          undefined,
          WORKSPACE_ID,
        );

        expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
          prismaMock,
          expect.objectContaining({
            itemId: ITEM_ID,
            kind: 'move',
            delta: 0,
            fromLocationId: LOC_ID,
            toLocationId: NEW_LOC_ID,
          }),
          expect.anything(),
        );
        expect(result.locationId).toBe(NEW_LOC_ID);
      });

      it('writes no movement when locationId is present in the DTO but unchanged', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail()); // locationId === LOC_ID
        prismaMock.item.update.mockResolvedValue(makeItemDetail());

        await service.update(ITEM_ID, { locationId: LOC_ID }, undefined, WORKSPACE_ID);

        expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      });

      it('AC 2: a PATCH changing both quantity and locationId writes exactly one movement for each', async () => {
        const NEW_LOC_ID = '88888888-8888-8888-8888-888888888888';
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 2 })); // locationId === LOC_ID
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 2 }));
        stockMovementsMock.recordMovement
          .mockResolvedValueOnce({
            movement: { id: 'mv-adjust', kind: 'adjust' },
            item: makeItemDetail({ quantity: 9 }),
          })
          .mockResolvedValueOnce({
            movement: { id: 'mv-move', kind: 'move' },
            item: makeItemDetail({ quantity: 9, locationId: NEW_LOC_ID }),
          });

        const result = await service.update(
          ITEM_ID,
          { quantity: 9, locationId: NEW_LOC_ID },
          undefined,
          WORKSPACE_ID,
        );

        expect(stockMovementsMock.recordMovement).toHaveBeenCalledTimes(2);
        expect(stockMovementsMock.recordMovement).toHaveBeenNthCalledWith(
          1,
          prismaMock,
          expect.objectContaining({ kind: 'adjust', delta: 7 }),
          expect.anything(),
        );
        expect(stockMovementsMock.recordMovement).toHaveBeenNthCalledWith(
          2,
          prismaMock,
          expect.objectContaining({
            kind: 'move',
            fromLocationId: LOC_ID,
            toLocationId: NEW_LOC_ID,
          }),
          expect.anything(),
        );
        // Final result reflects the last recordMovement call's item.
        expect(result.quantity).toBe(9);
        expect(result.locationId).toBe(NEW_LOC_ID);
      });

      it('attributes the movement to createdById when provided by the caller', async () => {
        const userId = '99999999-9999-9999-9999-999999999999';
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 1 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 1 }));
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'adjust' },
          item: makeItemDetail({ quantity: 2 }),
        });

        await service.update(ITEM_ID, { quantity: 2 }, userId, WORKSPACE_ID);

        expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
          prismaMock,
          expect.objectContaining({ createdById: userId }),
          expect.anything(),
        );
      });
    });

    // -------------------------------------------------------------------------
    // EVT-25 review round 2 — race-safe quantity/location reads (finding 1)
    // -------------------------------------------------------------------------

    describe('EVT-25 review round 2: race-safe current-state read', () => {
      // Finding 4 — regression guard proving the delta is computed from a
      // read that happens INSIDE the transaction, not via a pre-transaction
      // `this.findById(id)` call. A stale, pre-transaction read is exactly
      // the shape finding 1 flagged: it leaves a window where a concurrent
      // PATCH to the same item can commit between the read and this
      // transaction's write. Since the test's `$transaction` mock invokes
      // its callback with itself as `tx`, `tx.item.findUnique` and
      // `this.prisma.item.findUnique` land on the exact same jest.fn() — so
      // identity can't distinguish the two shapes, but invocation ORDER
      // can: a read inside the transaction is only ever observed AFTER
      // `$transaction` itself is invoked (its mock synchronously calls the
      // callback), whereas a pre-transaction read would be observed first.
      it('finding 1/4: reads current quantity/locationId via the tx client, after $transaction opens', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        stockMovementsMock.recordMovement.mockResolvedValue({
          movement: { id: 'mv-1', kind: 'adjust' },
          item: makeItemDetail({ quantity: 7 }),
        });

        await service.update(ITEM_ID, { quantity: 7 }, undefined, WORKSPACE_ID);

        expect(prismaMock.$transaction).toHaveBeenCalled();
        expect(prismaMock.item.findUnique).toHaveBeenCalled();
        const transactionCallOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
        const findUniqueCallOrder = prismaMock.item.findUnique.mock.invocationCallOrder[0];
        expect(findUniqueCallOrder).toBeGreaterThan(transactionCallOrder);
      });

      it('throws NotFoundException when the in-transaction read finds no row (item deleted concurrently)', async () => {
        prismaMock.item.findUnique.mockResolvedValue(null);
        await expect(
          service.update(ITEM_ID, { quantity: 5 }, undefined, WORKSPACE_ID),
        ).rejects.toThrow(NotFoundException);
        // No writes should be attempted once the item is known missing.
        expect(prismaMock.item.update).not.toHaveBeenCalled();
        expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      });

      // Finding 5 — failure-path atomicity: if any write inside the
      // transaction rejects, the whole `update()` call must reject too,
      // rather than swallowing the error and returning a partial result.
      it('finding 5: rejects the whole update when the scalar item write fails, without recording a movement', async () => {
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        const writeError = new Error('connection reset');
        prismaMock.item.update.mockRejectedValue(writeError);

        await expect(
          service.update(ITEM_ID, { quantity: 9 }, undefined, WORKSPACE_ID),
        ).rejects.toThrow(writeError);

        // The quantity movement must never be recorded on its own — the
        // ledger row and the quantity change stand or fall together.
        expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      });

      it('finding 5: rejects the whole update when recordMovement fails, and does not apply a second movement', async () => {
        const NEW_LOC_ID = '99999999-9999-9999-9999-999999999999';
        prismaMock.item.findUnique.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 3 }));
        const movementError = new Error('movement write failed');
        stockMovementsMock.recordMovement.mockRejectedValueOnce(movementError);

        await expect(
          service.update(ITEM_ID, { quantity: 9, locationId: NEW_LOC_ID }, undefined, WORKSPACE_ID),
        ).rejects.toThrow(movementError);

        // The failed "adjust" call is the only recordMovement call — the
        // "move" for the locationId change must never fire after it.
        expect(stockMovementsMock.recordMovement).toHaveBeenCalledTimes(1);
      });
    });
  });

  // =========================================================================
  // remove — AC 1 (delete)
  // =========================================================================

  describe('remove', () => {
    it('AC1 delete: deletes the item successfully when it belongs to the workspace', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      prismaMock.item.delete.mockResolvedValue(makeItemDetail());

      await service.remove(ITEM_ID, WORKSPACE_ID);

      expect(prismaMock.item.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    });

    it('throws NotFoundException when item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);

      await expect(service.remove('nonexistent-id', WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.item.delete).not.toHaveBeenCalled();
    });

    it('EVT-40 AC 2: throws NotFoundException when the item belongs to a different workspace, without attempting delete', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: OTHER_WORKSPACE_ID });

      await expect(service.remove(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
      expect(prismaMock.item.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the item was deleted concurrently, between the ownership check and the delete (P2025)', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      const p2025 = new Prisma.PrismaClientKnownRequestError('Record to delete not found', {
        code: 'P2025',
        clientVersion: '5.22.0',
      });
      prismaMock.item.delete.mockRejectedValue(p2025);

      await expect(service.remove(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
    });

    it('re-throws non-P2025 Prisma errors unchanged', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      const otherErr = new Prisma.PrismaClientKnownRequestError('Other error', {
        code: 'P2003',
        clientVersion: '5.22.0',
      });
      prismaMock.item.delete.mockRejectedValue(otherErr);

      await expect(service.remove(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(otherErr);
    });

    it('re-throws generic errors unchanged', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      const err = new Error('DB connection lost');
      prismaMock.item.delete.mockRejectedValue(err);

      await expect(service.remove(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(err);
    });
  });

  // =========================================================================
  // count — POST /api/items/:id/count (EVT-27 AC 2, blind-count delta math)
  // =========================================================================

  describe('count', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.count(ITEM_ID, 5, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
    });

    it('EVT-40 AC 2: throws NotFoundException when the item belongs to a different workspace', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        quantity: 3,
        locationId: LOC_ID,
        workspaceId: OTHER_WORKSPACE_ID,
      });
      await expect(service.count(ITEM_ID, 5, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
    });

    it('records an `adjust` movement with the correct delta when the count is higher than book', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        quantity: 3,
        locationId: LOC_ID,
        workspaceId: WORKSPACE_ID,
      });
      prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 5 }));

      const result = await service.count(ITEM_ID, 5, 'user-1', WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'adjust',
          delta: 2,
          toLocationId: LOC_ID,
          createdById: 'user-1',
        }),
      );
      expect(result.bookQuantity).toBe(3);
      expect(result.countedQuantity).toBe(5);
      expect(result.delta).toBe(2);
    });

    it('records a negative-delta `adjust` movement when the count is lower than book', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        quantity: 10,
        locationId: LOC_ID,
        workspaceId: WORKSPACE_ID,
      });
      prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 4 }));

      const result = await service.count(ITEM_ID, 4, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({ kind: 'adjust', delta: -6 }),
      );
      expect(result.delta).toBe(-6);
    });

    it('writes NO movement when the count matches book quantity exactly', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        quantity: 7,
        locationId: LOC_ID,
        workspaceId: WORKSPACE_ID,
      });
      prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 7 }));

      const result = await service.count(ITEM_ID, 7, undefined, WORKSPACE_ID);

      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
      expect(result.delta).toBe(0);
      expect(result.bookQuantity).toBe(7);
      expect(result.countedQuantity).toBe(7);
    });

    it('ALWAYS stamps lastVerifiedAt, even when the count matches book (nothing to adjust)', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        quantity: 7,
        locationId: LOC_ID,
        workspaceId: WORKSPACE_ID,
      });
      prismaMock.item.update.mockResolvedValue(makeItemDetail({ quantity: 7 }));

      await service.count(ITEM_ID, 7, undefined, WORKSPACE_ID);

      expect(prismaMock.item.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ITEM_ID },
          data: { lastVerifiedAt: expect.any(Date) },
        }),
      );
    });
  });

  // =========================================================================
  // consume — POST /api/items/:id/consume (EVT-27 AC 4, opportunistic trigger)
  // =========================================================================

  describe('consume', () => {
    it('throws NotFoundException when the item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.consume(ITEM_ID, 1, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(stockMovementsMock.recordConsumption).not.toHaveBeenCalled();
    });

    it('EVT-40 AC 2: throws NotFoundException when the item belongs to a different workspace', async () => {
      prismaMock.item.findUnique.mockResolvedValue({
        id: ITEM_ID,
        workspaceId: OTHER_WORKSPACE_ID,
      });
      await expect(service.consume(ITEM_ID, 1, undefined, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(stockMovementsMock.recordConsumption).not.toHaveBeenCalled();
    });

    it('delegates to recordConsumption with the requested quantity', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 3,
      });
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: 7, minQuantity: null }),
      );

      await service.consume(ITEM_ID, 3, 'user-1', WORKSPACE_ID);

      expect(stockMovementsMock.recordConsumption).toHaveBeenCalledWith(
        prismaMock,
        expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 3,
          createdById: 'user-1',
        }),
      );
    });

    // -------------------------------------------------------------------------
    // EVT-27 review round 2, finding 1: `recordConsumption` returning `null`
    // (nothing on hand) must not fall through to a 200 as if the consumption
    // succeeded.
    // -------------------------------------------------------------------------

    it('throws ConflictException when recordConsumption returns null (nothing on hand)', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue(null);

      await expect(service.consume(ITEM_ID, 5, undefined, WORKSPACE_ID)).rejects.toThrow(
        ConflictException,
      );
      // No item write should be attempted once recordConsumption reports
      // nothing was consumed.
      expect(prismaMock.item.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('surfaces consumedQuantity from recordConsumption on the response', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 3,
      });
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: 7, minQuantity: null }),
      );

      // Requested 5, but on-hand only supported 3 (partial consumption) —
      // the caller must be able to tell "consumed 3" apart from "consumed
      // nothing" (EVT-27 review round 2, security-reviewer suggestion).
      const result = await service.consume(ITEM_ID, 5, undefined, WORKSPACE_ID);

      expect(result.consumedQuantity).toBe(3);
    });

    it('offerVerification is true when resulting on-hand is at the OPPORTUNISTIC_PROMPT_FLOOR with no minQuantity set', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 5,
      });
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: OPPORTUNISTIC_PROMPT_FLOOR, minQuantity: null }),
      );

      const result = await service.consume(ITEM_ID, 5, undefined, WORKSPACE_ID);
      expect(result.offerVerification).toBe(true);
    });

    it('offerVerification is false when resulting on-hand is above the floor with no minQuantity set', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 1,
      });
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: OPPORTUNISTIC_PROMPT_FLOOR + 1, minQuantity: null }),
      );

      const result = await service.consume(ITEM_ID, 1, undefined, WORKSPACE_ID);
      expect(result.offerVerification).toBe(false);
    });

    it('uses minQuantity as the floor when it is higher than OPPORTUNISTIC_PROMPT_FLOOR', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 2,
      });
      // quantity (5) is above the flat floor (2) but at-or-below minQuantity (5)
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: 5, minQuantity: 5 }),
      );

      const result = await service.consume(ITEM_ID, 2, undefined, WORKSPACE_ID);
      expect(result.offerVerification).toBe(true);
    });

    it('uses the OPPORTUNISTIC_PROMPT_FLOOR when minQuantity is a small positive value below it', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID, workspaceId: WORKSPACE_ID });
      stockMovementsMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 1,
      });
      // minQuantity=1 is below OPPORTUNISTIC_PROMPT_FLOOR (2) — the flat
      // floor should still apply via Math.max, not the lower minQuantity.
      prismaMock.item.findUniqueOrThrow.mockResolvedValue(
        makeItemDetail({ quantity: OPPORTUNISTIC_PROMPT_FLOOR, minQuantity: 1 }),
      );

      const result = await service.consume(ITEM_ID, 1, undefined, WORKSPACE_ID);
      expect(result.offerVerification).toBe(true);
    });
  });

  // =========================================================================
  // listVerificationQueue — GET /api/items/verification-queue (EVT-27 AC 3)
  // =========================================================================

  describe('listVerificationQueue', () => {
    const NOW = new Date('2026-08-13T00:00:00.000Z');

    function overdueRow(overrides: Record<string, unknown> = {}) {
      return {
        id: ITEM_ID,
        name: 'Box of Screws',
        quantity: 10,
        qrCode: 'qr',
        lastVerifiedAt: null,
        countIntervalDays: 30,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        primaryPhoto: null,
        location: null,
        ...overrides,
      };
    }

    it('only fetches items with countIntervalDays set, scoped to the workspace', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      await service.listVerificationQueue(NOW, WORKSPACE_ID);
      expect(prismaMock.item.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { countIntervalDays: { not: null }, workspaceId: WORKSPACE_ID },
        }),
      );
    });

    it('excludes items that are not yet due', async () => {
      // Verified yesterday, 30-day cadence — nowhere near due.
      prismaMock.item.findMany.mockResolvedValue([
        overdueRow({ lastVerifiedAt: new Date('2026-08-12T00:00:00.000Z') }),
      ]);
      const result = await service.listVerificationQueue(NOW, WORKSPACE_ID);
      expect(result).toEqual([]);
    });

    it('includes an item exactly on its due date', async () => {
      prismaMock.item.findMany.mockResolvedValue([
        overdueRow({
          id: 'due-exactly',
          lastVerifiedAt: new Date('2026-07-14T00:00:00.000Z'), // + 30d = 2026-08-13
          countIntervalDays: 30,
        }),
      ]);
      const result = await service.listVerificationQueue(NOW, WORKSPACE_ID);
      expect(result).toHaveLength(1);
      expect(result[0].daysOverdue).toBe(0);
    });

    it('orders most-overdue first', async () => {
      prismaMock.item.findMany.mockResolvedValue([
        overdueRow({
          id: 'a-slightly-overdue',
          lastVerifiedAt: new Date('2026-07-10T00:00:00.000Z'), // due 2026-08-09, 4 days overdue
          countIntervalDays: 30,
        }),
        overdueRow({
          id: 'b-very-overdue',
          lastVerifiedAt: new Date('2026-05-01T00:00:00.000Z'), // due 2026-05-31, 74 days overdue
          countIntervalDays: 30,
        }),
        overdueRow({
          id: 'c-barely-overdue',
          lastVerifiedAt: new Date('2026-07-13T00:00:00.000Z'), // due 2026-08-12, 1 day overdue
          countIntervalDays: 30,
        }),
      ]);

      const result = await service.listVerificationQueue(NOW, WORKSPACE_ID);

      expect(result.map((r) => r.id)).toEqual([
        'b-very-overdue',
        'a-slightly-overdue',
        'c-barely-overdue',
      ]);
    });

    it('never-verified items (lastVerifiedAt null) are due countIntervalDays after createdAt', async () => {
      prismaMock.item.findMany.mockResolvedValue([
        // Created 40 days before NOW, 30-day cadence -> 10 days overdue.
        overdueRow({
          lastVerifiedAt: null,
          countIntervalDays: 30,
          createdAt: new Date('2026-07-04T00:00:00.000Z'),
        }),
      ]);
      const result = await service.listVerificationQueue(NOW, WORKSPACE_ID);
      expect(result).toHaveLength(1);
      expect(result[0].daysOverdue).toBe(10);
    });

    it('caps the result at VERIFICATION_QUEUE_CAP', async () => {
      const rows = Array.from({ length: VERIFICATION_QUEUE_CAP + 10 }, (_, i) =>
        overdueRow({
          id: `item-${i}`,
          lastVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
          countIntervalDays: 1,
        }),
      );
      prismaMock.item.findMany.mockResolvedValue(rows);

      const result = await service.listVerificationQueue(NOW, WORKSPACE_ID);
      expect(result).toHaveLength(VERIFICATION_QUEUE_CAP);
    });

    it('defaults `now` to the current time when omitted', async () => {
      prismaMock.item.findMany.mockResolvedValue([]);
      await expect(service.listVerificationQueue(undefined, WORKSPACE_ID)).resolves.toEqual([]);
    });
  });

  // =========================================================================
  // daysOverdue — pure helper (EVT-27 AC 6: overdue query ordering)
  // =========================================================================

  describe('daysOverdue', () => {
    const NOW = new Date('2026-08-13T00:00:00.000Z');

    it('is negative when the item is not yet due', () => {
      const result = daysOverdue(
        {
          lastVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
          countIntervalDays: 30,
          createdAt: NOW,
        },
        NOW,
      );
      expect(result).toBeLessThan(0);
    });

    it('is 0 exactly on the due date', () => {
      const result = daysOverdue(
        {
          lastVerifiedAt: new Date('2026-07-14T00:00:00.000Z'),
          countIntervalDays: 30,
          createdAt: NOW,
        },
        NOW,
      );
      expect(result).toBe(0);
    });

    it('is positive once the due date has passed', () => {
      const result = daysOverdue(
        {
          lastVerifiedAt: new Date('2026-07-01T00:00:00.000Z'),
          countIntervalDays: 30,
          createdAt: NOW,
        },
        NOW,
      );
      expect(result).toBeCloseTo(13, 5);
    });

    it('falls back to createdAt when lastVerifiedAt is null', () => {
      const result = daysOverdue(
        {
          lastVerifiedAt: null,
          countIntervalDays: 10,
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
        },
        NOW,
      );
      // due 2026-08-11, now 2026-08-13 -> 2 days overdue
      expect(result).toBeCloseTo(2, 5);
    });

    it('treats a null countIntervalDays as a 0-day interval', () => {
      const result = daysOverdue(
        {
          lastVerifiedAt: new Date('2026-08-12T00:00:00.000Z'),
          countIntervalDays: null,
          createdAt: NOW,
        },
        NOW,
      );
      expect(result).toBeCloseTo(1, 5);
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
      prismaMock.item.create.mockResolvedValue(makeItemRow({ quantity: 0 }));
      tagsMock.upsertMany.mockResolvedValue([TAG_ID]);
      // EVT-25: the default starting quantity (1) is applied via
      // recordMovement, not the create() call itself.
      stockMovementsMock.recordMovement.mockResolvedValue({
        movement: { id: 'mv-1', kind: 'add' },
        item: created,
      });

      const item = await service.create(
        { name: 'Cordless Drill', tags: ['power-tool'] },
        undefined,
        WORKSPACE_ID,
      );
      expect(item.id).toBe(ITEM_ID);

      // ---- 2. LIST ---------------------------------------------------------
      prismaMock.item.findMany.mockResolvedValue([created]);
      const listed = await service.list({}, WORKSPACE_ID);
      expect(listed).toHaveLength(1);
      expect(listed[0].id).toBe(ITEM_ID);

      // ---- 3. SEARCH HIT ---------------------------------------------------
      prismaMock.$queryRaw.mockResolvedValue([{ id: ITEM_ID }]);
      prismaMock.item.findMany.mockResolvedValue([created]);
      const hits = await service.list({ search: 'drill' }, WORKSPACE_ID);
      expect(hits).toHaveLength(1);

      // ---- 4. SEARCH MISS --------------------------------------------------
      prismaMock.$queryRaw.mockResolvedValue([]);
      prismaMock.item.findMany.mockResolvedValue([]);
      const misses = await service.list({ search: 'unicorn' }, WORKSPACE_ID);
      expect(misses).toHaveLength(0);

      // ---- 5. TAG FILTER ---------------------------------------------------
      prismaMock.item.findMany.mockResolvedValue([created]);
      const byTag = await service.list({ tag: 'power-tool' }, WORKSPACE_ID);
      expect(byTag).toHaveLength(1);
      expect(prismaMock.item.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { workspaceId: WORKSPACE_ID, tags: { some: { tag: { name: 'power-tool' } } } },
        }),
      );

      // ---- 6. LOCATION SUBTREE FILTER --------------------------------------
      prismaMock.location.findFirst.mockResolvedValue({ id: LOC_ID, path: 'garage' });
      prismaMock.item.findMany.mockResolvedValue([created]);
      const byLoc = await service.list({ locationId: LOC_ID }, WORKSPACE_ID);
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
      const patched = await service.update(
        ITEM_ID,
        { tags: ['hand-tool'] },
        undefined,
        WORKSPACE_ID,
      );
      expect(patched.tags[0].tag.name).toBe('hand-tool');

      // ---- 8. DELETE -------------------------------------------------------
      prismaMock.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      prismaMock.item.delete.mockResolvedValue(undefined);
      await service.remove(ITEM_ID, WORKSPACE_ID);
      expect(prismaMock.item.delete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    });
  });
});
