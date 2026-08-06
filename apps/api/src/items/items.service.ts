import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AiAnalysisResult, AiService, STUB_ANALYSIS } from '../ai/ai.service';
import { PrismaService } from '../prisma/prisma.service';
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
   */
  private async searchItemIds(search: string): Promise<string[]> {
    const pattern = `%${search}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Item"
      WHERE name ILIKE ${pattern}
         OR description ILIKE ${pattern}
         OR properties::text ILIKE ${pattern}
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
   * terms. Matching reuses the same name/description/properties-JSONB ILIKE
   * approach as `list()`'s `search` filter, extended to also match against
   * item tag names (the vision `tags` output has no exact-name equivalent
   * to filter by, unlike `list()`'s `tag` param).
   *
   * Ranking: each search term contributes at most one match to an item
   * (distinct-term hit count), and results are sorted by that count,
   * descending. Simple and easy to reason about, per the task's
   * implementation notes — no fancier relevance scoring.
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

    const matchCounts = new Map<string, number>();
    for (const term of terms) {
      const ids = await this.matchingItemIdsForTerm(term);
      for (const id of ids) {
        matchCounts.set(id, (matchCounts.get(id) ?? 0) + 1);
      }
    }

    if (matchCounts.size === 0) {
      return { analysis, matches: [] };
    }

    const items = await this.prisma.item.findMany({
      where: { id: { in: [...matchCounts.keys()] } },
      orderBy: { createdAt: 'desc' },
      include: ITEM_LIST_INCLUDE,
    });

    const matches = [...items].sort(
      (a, b) => (matchCounts.get(b.id) ?? 0) - (matchCounts.get(a.id) ?? 0),
    );

    return { analysis, matches };
  }

  /**
   * Item IDs whose name, description, properties JSONB, or any tag name
   * contains `term` (case-insensitive substring match). Extends
   * `searchItemIds`'s approach with a tag-name join, since vision-suggested
   * `tags` have no exact-name filter to reuse (unlike `list()`'s `tag` param).
   */
  private async matchingItemIdsForTerm(term: string): Promise<string[]> {
    const pattern = `%${term}%`;
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT DISTINCT i.id FROM "Item" i
      LEFT JOIN "ItemTag" it ON it."itemId" = i.id
      LEFT JOIN "Tag" tag ON tag.id = it."tagId"
      WHERE i.name ILIKE ${pattern}
         OR i.description ILIKE ${pattern}
         OR i.properties::text ILIKE ${pattern}
         OR tag.name ILIKE ${pattern}
    `;
    return rows.map((r) => r.id);
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

  async create(dto: CreateItemDto) {
    const { tags: tagNames, photoIds, ...itemData } = dto;

    // Upsert tags by name → get their IDs
    const tagIds = tagNames?.length ? await this.tagsService.upsertMany(tagNames) : [];

    // First photoId becomes the primary photo
    const primaryPhotoId = photoIds?.[0] ?? null;

    return this.prisma.item.create({
      data: {
        name: itemData.name,
        description: itemData.description,
        quantity: itemData.quantity,
        unit: itemData.unit,
        properties: (itemData.properties ?? {}) as Prisma.InputJsonValue,
        locationId: itemData.locationId,
        categoryId: itemData.categoryId,
        primaryPhotoId,
        ...(photoIds?.length && {
          photos: { connect: photoIds.map((id) => ({ id })) },
        }),
        ...(tagIds.length && {
          tags: { create: tagIds.map((tagId) => ({ tagId })) },
        }),
      },
      include: ITEM_DETAIL_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // update — PATCH /api/items/:id
  // -------------------------------------------------------------------------

  async update(id: string, dto: UpdateItemDto) {
    // Verify the item exists before attempting the update
    await this.findById(id);

    const { tags: tagNames, photoIds, properties, ...scalarData } = dto;

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

    return this.prisma.item.update({
      where: { id },
      data: {
        ...scalarData,
        ...(properties !== undefined && {
          properties: properties as Prisma.InputJsonValue,
        }),
        ...(primaryPhotoId !== undefined && { primaryPhotoId }),
        ...(tagsUpdate && { tags: tagsUpdate }),
      },
      include: ITEM_DETAIL_INCLUDE,
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
 * Builds the deduplicated list of search terms from a vision analysis:
 * `suggested_name` + every `search_keywords` entry + every `tags` entry.
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
