import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StockMovement, StockMovementKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ListMovementsQueryDto } from './list-movements-query.dto';

// ---------------------------------------------------------------------------
// Shared Prisma include shape
// ---------------------------------------------------------------------------

/** From/to location names + the linked project summary, for the history list. */
const MOVEMENT_INCLUDE = {
  fromLocation: { select: { id: true, name: true, path: true } },
  toLocation: { select: { id: true, name: true, path: true } },
  project: { select: { id: true, name: true } },
};

const DEFAULT_PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// recordMovement input/output shapes
// ---------------------------------------------------------------------------

/**
 * Runs inside a Prisma interactive transaction OR directly against the
 * top-level client — see `recordMovement`'s doc comment for why both are
 * accepted.
 */
export type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;

export interface RecordMovementInput {
  itemId: string;
  kind: StockMovementKind;
  /**
   * Signed change applied to `Item.quantity`. Positive for `add`/`build`,
   * negative for `consume`, either sign for `adjust`. Typically `0` for a
   * pure `move` (this task never moves a partial quantity — see EVT-25
   * non-goals) but the field always exists so a future partial-quantity
   * move doesn't need a schema change.
   */
  delta: number;
  /** Set only for `kind: 'move'`. */
  fromLocationId?: string | null;
  /** Set only for `kind: 'move'` — becomes the item's new `locationId`. */
  toLocationId?: string | null;
  projectId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

@Injectable()
export class StockMovementsService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // recordMovement — the single write path for every quantity/location change
  // -------------------------------------------------------------------------

  /**
   * Atomically writes a `StockMovement` row AND applies its effect to the
   * owning `Item` (increments `quantity` by `delta`; for `kind: 'move'` also
   * sets `locationId` to `toLocationId`) — see the EVT-25 task goal: "a
   * single service method that atomically writes the movement AND updates
   * Item.quantity (and locationId for moves) in one transaction". This is
   * the ONLY place `Item.quantity` / `Item.locationId` should ever be
   * written from application code (EVT-25 AC 2).
   *
   * Accepts either the top-level `PrismaService` (in which case it opens its
   * own `$transaction` so the two writes are still atomic on their own) or
   * an existing `Prisma.TransactionClient` (in which case the caller is
   * already inside a transaction — e.g. `ItemsService.create`/`update` also
   * writing other item fields in the same transaction — and this method
   * simply rides along without nesting a second transaction, which Prisma's
   * interactive transactions don't support).
   *
   * `itemInclude`, when provided, is forwarded to the `Item` update so the
   * caller gets back the item shape it needs (e.g. `ITEM_DETAIL_INCLUDE`)
   * without a second round trip.
   */
  async recordMovement<Include extends Prisma.ItemInclude = Record<string, never>>(
    client: PrismaClientOrTx,
    input: RecordMovementInput,
    itemInclude?: Include,
  ): Promise<{
    movement: StockMovement;
    item: Prisma.ItemGetPayload<{ include: Include }>;
  }> {
    const run = async (tx: Prisma.TransactionClient | PrismaService) => {
      const movement = await tx.stockMovement.create({
        data: {
          itemId: input.itemId,
          kind: input.kind,
          delta: input.delta,
          fromLocationId: input.fromLocationId ?? null,
          toLocationId: input.toLocationId ?? null,
          projectId: input.projectId ?? null,
          note: input.note ?? null,
          createdById: input.createdById ?? null,
        },
      });

      // `ItemUncheckedUpdateInput` (not the plain `ItemUpdateInput`) — we
      // need to set the raw `locationId` FK scalar directly for `move`,
      // rather than the relation-style `location: { connect / disconnect }`.
      const data: Prisma.ItemUncheckedUpdateInput = {};
      if (input.delta !== 0) {
        data.quantity = { increment: input.delta };
      }
      if (input.kind === 'move') {
        data.locationId = input.toLocationId ?? null;
      }

      const item = await tx.item.update({
        where: { id: input.itemId },
        data,
        include: (itemInclude ?? {}) as Include,
      });

      // EVT-26: any movement (of any kind — add/consume/move/adjust/build)
      // that leaves the item's on-hand `quantity` at or below its
      // `minQuantity` opens a `low-stock` shopping-list entry. `minQuantity`
      // is `null` by default (no replenishment tracking), so this is a
      // no-op for the vast majority of items/movements.
      if (item.minQuantity != null && item.quantity <= item.minQuantity) {
        await openLowStockEntry(tx, input.itemId);
      }

      return { movement, item: item as Prisma.ItemGetPayload<{ include: Include }> };
    };

    // `$transaction` only exists on the top-level client, not on an
    // already-open `Prisma.TransactionClient` (interactive transactions
    // can't nest) — its presence is how we tell the two apart at runtime.
    if (isPrismaService(client)) {
      return client.$transaction((tx) => run(tx));
    }
    return run(client);
  }

  // -------------------------------------------------------------------------
  // listForItem — GET /api/items/:id/movements
  // -------------------------------------------------------------------------

  /** Paginated movement history for one item, newest first. 404 when the item doesn't exist. */
  async listForItem(itemId: string, query: ListMovementsQueryDto) {
    const item = await this.prisma.item.findUnique({ where: { id: itemId }, select: { id: true } });
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const [total, data] = await Promise.all([
      this.prisma.stockMovement.count({ where: { itemId } }),
      this.prisma.stockMovement.findMany({
        where: { itemId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: MOVEMENT_INCLUDE,
      }),
    ]);

    return {
      data,
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }
}

/** Distinguishes the top-level `PrismaService` from an open `Prisma.TransactionClient`. */
function isPrismaService(client: PrismaClientOrTx): client is PrismaService {
  return typeof (client as PrismaService).$transaction === 'function';
}

// ---------------------------------------------------------------------------
// EVT-26 — low-stock auto-trigger
// ---------------------------------------------------------------------------

/**
 * Idempotently opens a `low-stock` `ShoppingListEntry` for `itemId`, via
 * `INSERT ... ON CONFLICT (itemId) WHERE status = 'open' DO NOTHING` against
 * the partial unique index the EVT-26 migration adds by hand (there is no
 * `@@unique` on `ShoppingListEntry` in schema.prisma for Prisma to derive a
 * `.upsert()` — or a "catch P2002" `.create()` — around; see that migration
 * file's comment for why).
 *
 * Deliberately raw SQL rather than "try `.create()`, catch P2002": this runs
 * INSIDE the same transaction as the `Item`/`StockMovement` write above, and
 * catching a unique-violation from a *failed statement* does not undo that
 * statement's effect on the surrounding Postgres transaction — the
 * transaction is left aborted, and every subsequent statement in it
 * (including the movement/item write's own COMMIT) would then fail too. A
 * plain conflict-tolerant INSERT has no such failure mode: the loser of a
 * genuine race is a silent no-op, not an aborted transaction, so a duplicate
 * low-stock entry can never block or fail the movement it's a side effect of
 * (EVT-26 risk: "duplicate-entry races when several movements dip below min
 * in quick succession").
 */
async function openLowStockEntry(tx: PrismaClientOrTx, itemId: string): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO "ShoppingListEntry" (id, "itemId", status, source, "createdAt")
    VALUES (${randomUUID()}::uuid, ${itemId}::uuid, 'open', 'low-stock', now())
    ON CONFLICT ("itemId") WHERE status = 'open' DO NOTHING
  `;
}
