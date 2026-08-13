import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiAnalysisResult, AiService, STUB_ANALYSIS } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { TagsService } from '../tags/tags.service';
import { CreateItemDto } from './create-item.dto';
import { ListItemsQueryDto } from './list-items-query.dto';
import { UpdateItemDto } from './update-item.dto';

// ---------------------------------------------------------------------------
// Shared Prisma include shapes
// ---------------------------------------------------------------------------

/** Full detail: photos, tags, location, category. Used for GET /:id and write ops. */
const ITEM_DETAIL_INCLUDE = {
  tags: { include: { tag: true } },
  location: { select: { id: true, name: true, path: true } },
  category: { select: { id: true, name: true, path: true } },
  primaryPhoto: { select: { id: true, filename: true, mimeType: true } },
  photos: {
    select: { id: true, filename: true, mimeType: true },
    orderBy: { createdAt: 'asc' as const },
  },
};

/** Lighter shape for list rows: tags, location (id+name+path), primary photo. */
const ITEM_LIST_INCLUDE = {
  tags: { include: { tag: true } },
  location: { select: { id: true, name: true, path: true } },
  primaryPhoto: { select: { id: true, filename: true, mimeType: true } },
};

// ---------------------------------------------------------------------------
// ItemsService
// ---------------------------------------------------------------------------

@Injectable()
export class ItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly aiService: AiService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  // -------------------------------------------------------------------------
  // list — GET /api/items?search=&tag=&locationId=
  // -------------------------------------------------------------------------

  async list(query: ListItemsQueryDto) {
    const where: Prisma.ItemWhereInput = {};

    // --- Tag filter ---------------------------------------------------------
    if (query.tag) {
      where.tags = { some: { tag: { name: query.tag } } };
    }

    // --- LocationId subtree filter (materialized-path prefix) ---------------
    if (query.locationId) {
      const loc = await this.prisma.location.findUnique({
        where: { id: query.locationId },
        select: { id: true, path: true },
      });
      if (!loc) {
        // Unknown locationId → no items can match
        return [];
      }
      // Matches the exact location OR any descendant (path starts with "<loc.path>.")
      where.location = {
        OR: [{ id: loc.id }, { path: { startsWith: `${loc.path}.` } }],
      };
    }

    // --- Full-text search (name, description, properties JSONB) -------------
    if (query.search) {
      const ids = await this.searchItemIds(query.search);
      where.id = { in: ids };
    }

    return this.prisma.item.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: ITEM_LIST_INCLUDE,
    });
  }

  /**
   * Raw SQL: ILIKE across name, description, and the JSONB properties column
   * (cast to text). Returns matching item IDs.
   *
   * `search` is escaped via `escapeLikePattern` before being embedded in the
   * `%...%` pattern — otherwise a caller-supplied `%` or `_` would act as a
   * LIKE wildcard rather than a literal character (EVT-17 review round 2,
   * finding 1c). The pattern itself is still passed as a bound Prisma
   * parameter, never string-concatenated into the SQL text.
   */
  private async searchItemIds(search: string): Promise<string[]> {
    const pattern = `%${escapeLikePattern(search)}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Item"
      WHERE name ILIKE ${pattern} ESCAPE '\\'
         OR description ILIKE ${pattern} ESCAPE '\\'
         OR properties::text ILIKE ${pattern} ESCAPE '\\'
    `;
    return rows.map((r) => r.id);
  }

  // -------------------------------------------------------------------------
  // searchByPhoto — POST /api/items/search-by-photo (EVT-17)
  // -------------------------------------------------------------------------

  /**
   * Runs the EVT-7 vision analysis on an uploaded photo (never persisted —
   * see `search-by-photo.helpers.ts`) and searches existing items using the
   * analysis's `suggested_name` + `search_keywords` + `tags` as search
   * terms (capped to `MAX_SEARCH_TERMS` by `buildSearchTerms` — see EVT-17
   * review round 2, finding 1a). Matching reuses the same
   * name/description/properties-JSONB ILIKE approach as `list()`'s `search`
   * filter, extended to also match against item tag names (the vision
   * `tags` output has no exact-name equivalent to filter by, unlike
   * `list()`'s `tag` param).
   *
   * Ranking: each search term contributes at most one match to an item
   * (distinct-term hit count), sorted by that count descending, ties broken
   * by `createdAt` descending (newest first) — a deterministic, tested
   * contract (EVT-17 review round 2, finding 3). The response is capped to
   * the top `MAX_MATCHES` after ranking (finding 1d), so a term that happens
   * to match a large fraction of the inventory can't balloon the response.
   *
   * Never throws on a "nothing found" or "nothing to search" outcome: a
   * stub analysis (no AI key configured, unsupported format, oversized
   * file, or a genuine no-match) degrades to `matches: []` with the
   * analysis echoed back so the client can show why.
   */
  async searchByPhoto(buffer: Buffer, mimeType: string): Promise<SearchByPhotoResult> {
    const analysis = await this.aiService.analyzePhoto(buffer, mimeType);
    const terms = buildSearchTerms(analysis);

    if (terms.length === 0) {
      return { analysis, matches: [] };
    }

    const hits = await this.matchingItemHitsForTerms(terms);

    if (hits.size === 0) {
      return { analysis, matches: [] };
    }

    // Rank BEFORE fetching full item rows, then cap — bounds the response
    // to MAX_MATCHES regardless of how many items a term happens to hit
    // (EVT-17 review round 2, finding 1d).
    const rankedIds = [...hits.entries()]
      .sort(([, a], [, b]) => {
        if (b.count !== a.count) {
          return b.count - a.count;
        }
        return b.createdAt.getTime() - a.createdAt.getTime();
      })
      .slice(0, MAX_MATCHES)
      .map(([id]) => id);

    const items = await this.prisma.item.findMany({
      where: { id: { in: rankedIds } },
      include: ITEM_LIST_INCLUDE,
    });

    const rankOf = new Map(rankedIds.map((id, index) => [id, index]));
    const matches = [...items].sort((a, b) => (rankOf.get(a.id) ?? 0) - (rankOf.get(b.id) ?? 0));

    return { analysis, matches };
  }

  /**
   * Single parameterized query across all `terms` (already capped to
   * `MAX_SEARCH_TERMS`), replacing the previous per-term sequential
   * `$queryRaw` loop — an unbounded/high-cardinality `search_keywords` list
   * from a crafted image could previously drive one sequential full-table
   * scan per term (EVT-17 review round 2, finding 1b).
   *
   * Each escaped `%term%` pattern is `unnest()`'d via `Prisma.join` (still
   * fully parameterized — never string-concatenated) and cross-joined
   * against `Item`/`ItemTag`/`Tag`, so matching against name, description,
   * properties JSONB, or any tag name happens in one round trip. Returns
   * per-item hit counts (one hit per distinct term that matched) plus each
   * item's `createdAt`, so the caller can rank without a second query.
   */
  private async matchingItemHitsForTerms(
    terms: string[],
  ): Promise<Map<string, { count: number; createdAt: Date }>> {
    const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
    const rows = await this.prisma.$queryRaw<{ id: string; createdAt: Date; term: string }[]>`
      SELECT DISTINCT i.id, i."createdAt", t.term
      FROM "Item" i
      CROSS JOIN unnest(ARRAY[${Prisma.join(patterns)}]::text[]) AS t(term)
      LEFT JOIN "ItemTag" it ON it."itemId" = i.id
      LEFT JOIN "Tag" tag ON tag.id = it."tagId"
      WHERE i.name ILIKE t.term ESCAPE '\\'
         OR i.description ILIKE t.term ESCAPE '\\'
         OR i.properties::text ILIKE t.term ESCAPE '\\'
         OR tag.name ILIKE t.term ESCAPE '\\'
    `;

    const hits = new Map<string, { count: number; createdAt: Date }>();
    for (const row of rows) {
      const existing = hits.get(row.id);
      hits.set(row.id, { count: (existing?.count ?? 0) + 1, createdAt: row.createdAt });
    }
    return hits;
  }

  // -------------------------------------------------------------------------
  // findById — GET /api/items/:id
  // -------------------------------------------------------------------------

  async findById(id: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: ITEM_DETAIL_INCLUDE,
    });
    if (!item) {
      throw new NotFoundException(`Item ${id} not found`);
    }
    return item;
  }

  // -------------------------------------------------------------------------
  // findByQr — GET /api/items/by-qr/:qr
  // -------------------------------------------------------------------------

  /**
   * Resolves a QR token to whichever entity it belongs to.
   *
   * - Returns `{ kind: 'item', item }` when the token is on an Item.
   * - Returns `{ kind: 'location', location }` when the token is on a Location.
   * - Throws `NotFoundException` when the token is not found in either table.
   */
  async findByQr(qr: string) {
    // Check items first
    const item = await this.prisma.item.findUnique({
      where: { qrCode: qr },
      include: ITEM_DETAIL_INCLUDE,
    });
    if (item) {
      return { kind: 'item' as const, item };
    }

    // Check locations
    const location = await this.prisma.location.findUnique({
      where: { qrCode: qr },
      select: { id: true, name: true, path: true, parentId: true, notes: true },
    });
    if (location) {
      return { kind: 'location' as const, location };
    }

    throw new NotFoundException(`No item or location found for QR token: ${qr}`);
  }

  // -------------------------------------------------------------------------
  // create — POST /api/items
  // -------------------------------------------------------------------------

  /**
   * `createdById` (EVT-14) is optional so this remains callable without a
   * caller in scope (e.g. seed scripts, tests predating auth).
   *
   * EVT-25: the row is created with `quantity: 0` and immediately brought up
   * to the requested starting quantity via `recordMovement` (kind `add`), in
   * the same transaction — `Item.quantity` is never written directly by this
   * method, so intake always leaves an audit trail of where the on-hand
   * count came from. A starting quantity of `0` writes no movement (there's
   * nothing to record).
   */
  async create(dto: CreateItemDto, createdById?: string) {
    const { tags: tagNames, photoIds, ...itemData } = dto;

    // Upsert tags by name → get their IDs
    const tagIds = tagNames?.length ? await this.tagsService.upsertMany(tagNames) : [];

    // First photoId becomes the primary photo
    const primaryPhotoId = photoIds?.[0] ?? null;

    // Mirrors the Prisma schema's `Item.quantity @default(1)` — resolved
    // explicitly here since the create call below always passes `0` and
    // relies on `recordMovement` to reach this value.
    const initialQuantity = itemData.quantity ?? 1;

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          name: itemData.name,
          description: itemData.description,
          quantity: 0,
          unit: itemData.unit,
          properties: (itemData.properties ?? {}) as Prisma.InputJsonValue,
          locationId: itemData.locationId,
          categoryId: itemData.categoryId,
          primaryPhotoId,
          ...(createdById && { createdById }),
          ...(photoIds?.length && {
            photos: { connect: photoIds.map((id) => ({ id })) },
          }),
          ...(tagIds.length && {
            tags: { create: tagIds.map((tagId) => ({ tagId })) },
          }),
        },
        include: ITEM_DETAIL_INCLUDE,
      });

      if (initialQuantity === 0) {
        return item;
      }

      const { item: stocked } = await this.stockMovementsService.recordMovement(
        tx,
        {
          itemId: item.id,
          kind: 'add',
          delta: initialQuantity,
          toLocationId: item.locationId,
          createdById,
          note: 'Initial intake',
        },
        ITEM_DETAIL_INCLUDE,
      );
      return stocked;
    });
  }

  // -------------------------------------------------------------------------
  // receive — POST /api/items/:id/receive (EVT-31 AC 4)
  // -------------------------------------------------------------------------

  /**
   * Records an `add` movement for `quantity` against an EXISTING item — the
   * "add to existing" branch of distributor barcode receiving (EVT-31 AC 4):
   * re-scanning a known MPN adds to the matched item's on-hand count instead
   * of creating a duplicate item. Mirrors `ShoppingListService.restock`'s
   * use of `recordMovement` for the same `kind: 'add'` write path — the
   * ONLY place `Item.quantity` should ever be written from application code
   * (EVT-25 AC 2). 404 when the item does not exist.
   */
  async receive(id: string, quantity: number, createdById?: string) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      select: { id: true, locationId: true },
    });
    if (!item) {
      throw new NotFoundException(`Item ${id} not found`);
    }

    const { item: received } = await this.stockMovementsService.recordMovement(
      this.prisma,
      {
        itemId: id,
        kind: 'add',
        delta: quantity,
        toLocationId: item.locationId,
        createdById,
        note: 'Received via barcode scan',
      },
      ITEM_DETAIL_INCLUDE,
    );
    return received;
  }

  // -------------------------------------------------------------------------
  // update — PATCH /api/items/:id
  // -------------------------------------------------------------------------

  /**
   * `createdById` (EVT-25) attributes any `adjust`/`move` movement this
   * update generates to the acting user; optional for callers without one
   * in scope (e.g. tests, scripts).
   *
   * EVT-25: `quantity` and `locationId` are pulled out of the plain scalar
   * update and routed through `recordMovement` instead — the ONLY path that
   * writes them (AC 2) — so an edit that changes either always leaves a
   * matching `adjust`/`move` row in the same transaction as every other
   * field on this PATCH. A `quantity`/`locationId` key that's present in the
   * DTO but equal to the current value writes no movement (nothing changed);
   * an omitted key leaves the field untouched, same as before.
   *
   * The pre-edit `quantity`/`locationId` snapshot (`current`) is read via
   * `tx.item.findUnique` — the FIRST statement inside the `$transaction`
   * callback below — rather than via a separate `this.findById(id)` call
   * before the transaction opens (the previous shape). That previous shape
   * left a race window: the read happened on its own connection, often with
   * an additional `await` gap for `tagsService.upsertMany` in between, so a
   * concurrent PATCH to the same item could commit in that window. Each
   * caller would then compute its `adjust` delta from an already-stale
   * `current.quantity`, and applying both deltas via `recordMovement`'s
   * `increment` could land the final quantity on neither caller's intended
   * value — or drive it negative past the DTO's `@Min(0)` under enough
   * concurrent requests (EVT-25 review round 2, finding 1). Reading via
   * `tx`, immediately before the writes that use it, closes that window.
   */
  async update(id: string, dto: UpdateItemDto, createdById?: string) {
    const {
      tags: tagNames,
      photoIds,
      properties,
      quantity,
      locationId,
      lastVerifiedAt,
      ...scalarData
    } = dto;

    // Build tag update: full replacement when `tags` is provided in the DTO
    let tagsUpdate: Prisma.ItemUpdateInput['tags'] | undefined;
    if (tagNames !== undefined) {
      const tagIds = tagNames.length ? await this.tagsService.upsertMany(tagNames) : [];
      tagsUpdate = {
        deleteMany: {},
        ...(tagIds.length && { create: tagIds.map((tagId) => ({ tagId })) }),
      };
    }

    // When photoIds provided, update primary photo to the first entry
    const primaryPhotoId = photoIds !== undefined ? (photoIds[0] ?? null) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.item.findUnique({
        where: { id },
        select: { quantity: true, locationId: true },
      });
      if (!current) {
        throw new NotFoundException(`Item ${id} not found`);
      }

      const quantityChanged = quantity !== undefined && quantity !== current.quantity;
      const locationChanged = locationId !== undefined && locationId !== current.locationId;

      let item = await tx.item.update({
        where: { id },
        data: {
          ...scalarData,
          ...(properties !== undefined && {
            properties: properties as Prisma.InputJsonValue,
          }),
          ...(primaryPhotoId !== undefined && { primaryPhotoId }),
          ...(tagsUpdate && { tags: tagsUpdate }),
          // EVT-27: `undefined` (key omitted) leaves `lastVerifiedAt`
          // unchanged; explicit `null` clears it, same convention as
          // locationId/categoryId above.
          ...(lastVerifiedAt !== undefined && {
            lastVerifiedAt: lastVerifiedAt ? new Date(lastVerifiedAt) : null,
          }),
        },
        include: ITEM_DETAIL_INCLUDE,
      });

      if (quantityChanged) {
        ({ item } = await this.stockMovementsService.recordMovement(
          tx,
          {
            itemId: id,
            kind: 'adjust',
            delta: quantity! - current.quantity,
            createdById,
            note: 'Manual quantity edit',
          },
          ITEM_DETAIL_INCLUDE,
        ));
      }

      if (locationChanged) {
        ({ item } = await this.stockMovementsService.recordMovement(
          tx,
          {
            itemId: id,
            kind: 'move',
            delta: 0,
            fromLocationId: current.locationId,
            toLocationId: locationId,
            createdById,
          },
          ITEM_DETAIL_INCLUDE,
        ));
      }

      return item;
    });
  }

  // -------------------------------------------------------------------------
  // remove — DELETE /api/items/:id
  // -------------------------------------------------------------------------

  async remove(id: string): Promise<void> {
    try {
      await this.prisma.item.delete({ where: { id } });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new NotFoundException(`Item ${id} not found`);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // count — POST /api/items/:id/count (EVT-27 AC 2, blind verification count)
  // -------------------------------------------------------------------------

  /**
   * Records an explicit count against `id`. The CALLER is responsible for
   * never showing book quantity before the count is submitted (this is a UI
   * contract, not something the API can enforce) — the response only
   * reveals `bookQuantity`/`delta` AFTER the write, which is what lets the
   * web client do the "ask blind, reveal after" flow (AC 2).
   *
   * Writes an `adjust` movement only when `countedQuantity` differs from
   * the pre-count book quantity (a match writes no movement — nothing
   * changed). `lastVerifiedAt` is ALWAYS stamped to now, regardless of
   * whether the count matched — the verification itself happened either way,
   * which is what keeps the item off the overdue queue.
   *
   * Known race (EVT-27 review round 2, security-reviewer, optional): the
   * read-then-write here (read `current.quantity`, compute `delta`, apply
   * via `recordMovement`'s blind `{ increment: delta }`) is not race-safe
   * against a concurrent count/consume of the same item — two overlapping
   * blind counts can each compute their delta from the same stale
   * `current.quantity` and, once both apply, drive `Item.quantity` negative
   * or otherwise off either counter's intended value. Unlike `consume`,
   * this can't be fixed by routing through `recordConsumption`'s
   * conditional-decrement retry (that helper only clamps a one-directional
   * decrement; a count's delta can be positive or negative). A full fix
   * (conditional update keyed on the pre-read quantity, with retry) is out
   * of scope for this round.
   */
  async count(id: string, countedQuantity: number, createdById?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.item.findUnique({
        where: { id },
        select: { quantity: true, locationId: true },
      });
      if (!current) {
        throw new NotFoundException(`Item ${id} not found`);
      }

      const delta = countedQuantity - current.quantity;
      const bookQuantity = current.quantity;

      if (delta !== 0) {
        await this.stockMovementsService.recordMovement(tx, {
          itemId: id,
          kind: 'adjust',
          delta,
          toLocationId: current.locationId,
          createdById,
          note: 'Verification count',
        });
      }

      const item = await tx.item.update({
        where: { id },
        data: { lastVerifiedAt: new Date() },
        include: ITEM_DETAIL_INCLUDE,
      });

      return { item, bookQuantity, countedQuantity, delta };
    });
  }

  // -------------------------------------------------------------------------
  // consume — POST /api/items/:id/consume (EVT-27 AC 4, opportunistic prompt trigger)
  // -------------------------------------------------------------------------

  /**
   * Records a `consume` movement for up to `requestedQuantity` (race-safe,
   * clamped to on-hand via `StockMovementsService.recordConsumption` — see
   * its doc comment; this is the first endpoint to actually write the
   * `consume` StockMovementKind, previously reserved-but-unwritten).
   *
   * `recordConsumption` returns `null` when there is nothing on hand to
   * consume (on-hand was already 0, or hit 0 mid-retry-loop — see its doc
   * comment). Unlike `ProjectsService.backflush()` — which loops over
   * multiple BOM lines and can legitimately skip a single line with a
   * shortage — this is the item's ONLY requested consumption, so a `null`
   * result means the whole request failed and must not be swallowed: it is
   * surfaced as a 409 `ConflictException` rather than falling through to a
   * 200 that implies a movement was written (EVT-27 review round 2, finding
   * 1). `consumedQuantity` is echoed back on success so the caller can tell
   * "consumed 3 of the 5 requested" apart from "consumed nothing" without
   * a second read.
   *
   * `offerVerification` on the response is `true` when the resulting
   * on-hand is at or below `max(minQuantity ?? 0, 2)` — the "how many are
   * actually left?" opportunistic-counting moment (EVT-27 AC 4, Mechanics
   * 05: verification is cheapest and most valuable exactly when a pick
   * leaves a bin nearly empty). The web client decides how to present that
   * (an inline, one-tap-skippable prompt) — this method only computes
   * whether the moment qualifies.
   */
  async consume(id: string, requestedQuantity: number, createdById?: string) {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.item.findUnique({ where: { id }, select: { id: true } });
      if (!existing) {
        throw new NotFoundException(`Item ${id} not found`);
      }

      const result = await this.stockMovementsService.recordConsumption(tx, {
        itemId: id,
        kind: 'consume',
        requestedQuantity,
        createdById,
        note: 'Consumed',
      });
      if (!result) {
        throw new ConflictException(`Item ${id} has nothing on hand to consume`);
      }

      const item = await tx.item.findUniqueOrThrow({
        where: { id },
        include: ITEM_DETAIL_INCLUDE,
      });

      const threshold = Math.max(item.minQuantity ?? 0, OPPORTUNISTIC_PROMPT_FLOOR);
      const offerVerification = item.quantity <= threshold;

      return { item, offerVerification, consumedQuantity: result.consumedQuantity };
    });
  }

  // -------------------------------------------------------------------------
  // listVerificationQueue — GET /api/items/verification-queue (EVT-27 AC 3)
  // -------------------------------------------------------------------------

  /**
   * "Today's count list": items on a count schedule (`countIntervalDays`
   * not null) whose next-due date has passed, most-overdue first, capped at
   * `VERIFICATION_QUEUE_CAP`. Items with no `countIntervalDays` NEVER
   * appear, regardless of how stale `lastVerifiedAt` is (AC 3).
   *
   * Filtering/sorting happens in application code (not SQL date-interval
   * arithmetic) after fetching every scheduled item — the inventory sizes
   * this app targets (a household workshop, not a warehouse) make that the
   * simpler, more directly testable option; `daysOverdue` is exported as a
   * pure function precisely so overdue-ness and sort order can be unit
   * tested without a database.
   */
  async listVerificationQueue(now: Date = new Date()) {
    const items = await this.prisma.item.findMany({
      where: { countIntervalDays: { not: null } },
      select: {
        id: true,
        name: true,
        quantity: true,
        qrCode: true,
        lastVerifiedAt: true,
        countIntervalDays: true,
        createdAt: true,
        primaryPhoto: { select: { id: true, filename: true, mimeType: true } },
        location: { select: { id: true, name: true, path: true } },
      },
    });

    return items
      .map((item) => ({ item, overdueBy: daysOverdue(item, now) }))
      .filter(({ overdueBy }) => overdueBy >= 0)
      .sort((a, b) => b.overdueBy - a.overdueBy)
      .slice(0, VERIFICATION_QUEUE_CAP)
      .map(({ item, overdueBy }) => ({ ...item, daysOverdue: Math.floor(overdueBy) }));
  }
}

// ---------------------------------------------------------------------------
// verification / count cadence helpers (EVT-27)
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Cap on `GET /api/items/verification-queue` — "today's count list", not a full audit (AC 3). */
export const VERIFICATION_QUEUE_CAP = 20;

/**
 * The on-hand floor a `consume` movement must fall to (or below) to trigger
 * the opportunistic "how many are actually left?" prompt (EVT-27 AC 4), when
 * the item's own `minQuantity` is unset or lower than this. Mirrors the
 * research dossier's "a pick that leaves 0-2 units" framing (Mechanics 05).
 */
export const OPPORTUNISTIC_PROMPT_FLOOR = 2;

/**
 * How many days overdue `item` is for its next scheduled count, as of `now`.
 * Negative = not yet due. Exported as a pure function so overdue-ness and
 * sort order are unit-testable without a database (EVT-27 AC 6).
 *
 * An item that's never been counted (`lastVerifiedAt === null`) is treated
 * as due `countIntervalDays` days after it was CREATED, not immediately on
 * creation — new items get one full cadence's grace period before their
 * first count is "due", rather than landing on the queue the moment
 * `countIntervalDays` is set.
 */
export function daysOverdue(
  item: { lastVerifiedAt: Date | null; countIntervalDays: number | null; createdAt: Date },
  now: Date,
): number {
  const baseline = item.lastVerifiedAt ?? item.createdAt;
  const intervalDays = item.countIntervalDays ?? 0;
  const dueAt = baseline.getTime() + intervalDays * MS_PER_DAY;
  return (now.getTime() - dueAt) / MS_PER_DAY;
}

// ---------------------------------------------------------------------------
// searchByPhoto helpers
// ---------------------------------------------------------------------------

/** Response shape of `ItemsService.searchByPhoto` (POST /api/items/search-by-photo). */
export interface SearchByPhotoResult {
  analysis: AiAnalysisResult;
  matches: Prisma.ItemGetPayload<{ include: typeof ITEM_LIST_INCLUDE }>[];
}

/**
 * Hard cap on the number of AI-derived search terms fanned out to the
 * database per `searchByPhoto` call. `normalizeAnalysis` (ai.service.ts)
 * accepts any number of `search_keywords`/`tags` from the vision model, so
 * without this cap a crafted image could steer the model into emitting
 * hundreds of terms, each previously driving its own full-table-scan query
 * (EVT-17 review round 2, finding 1a).
 */
export const MAX_SEARCH_TERMS = 10;

/**
 * Hard cap on the number of items `searchByPhoto` returns. Ranking
 * (distinct-term hit count, ties broken by `createdAt` desc) is applied
 * BEFORE this cap, so it always keeps the strongest matches regardless of
 * how many rows happen to match (EVT-17 review round 2, finding 1d).
 */
export const MAX_MATCHES = 50;

/**
 * Escapes ILIKE/LIKE metacharacters (`\`, `%`, `_`) in `term` so it can be
 * safely embedded in a `%...%` substring pattern without the caller being
 * able to smuggle in their own wildcards (e.g. a lone `%` or `_` term would
 * otherwise match everything / any single character). Every ILIKE clause
 * that consumes an escaped pattern MUST also carry an `ESCAPE '\'` clause
 * (EVT-17 review round 2, finding 1c).
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (metachar) => `\\${metachar}`);
}

/**
 * Builds the deduplicated, capped list of search terms from a vision
 * analysis: `suggested_name` + every `search_keywords` entry + every `tags`
 * entry, in that priority order, capped to `MAX_SEARCH_TERMS`.
 *
 * `suggested_name` is excluded when it's still the bare stub default
 * (`STUB_ANALYSIS.suggested_name`, "Unknown item") — that's a placeholder
 * signaling "nothing was analyzed / recognized", not a real search cue, and
 * searching for it literally would risk spurious matches against real items
 * that happen to contain the word "item". A stub analysis's `tags` and
 * `search_keywords` are always empty (see `STUB_ANALYSIS`), so excluding
 * the placeholder name too means a stub analysis always yields zero terms
 * — the task's "stub AI → empty keywords → empty matches" behavior.
 */
export function buildSearchTerms(analysis: AiAnalysisResult): string[] {
  const candidates = [
    ...(analysis.suggested_name !== STUB_ANALYSIS.suggested_name ? [analysis.suggested_name] : []),
    ...analysis.search_keywords,
    ...analysis.tags,
  ];

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const candidate of candidates) {
    if (terms.length >= MAX_SEARCH_TERMS) {
      break;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(trimmed);
  }
  return terms;
}
