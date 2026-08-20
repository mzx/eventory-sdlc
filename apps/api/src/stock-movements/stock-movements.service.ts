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

/** Same shape as `MOVEMENT_INCLUDE`, used for container-scoped history (EVT-30 AC 3). */
const CONTAINER_MOVEMENT_INCLUDE = {
  fromLocation: { select: { id: true, name: true, path: true } },
  toLocation: { select: { id: true, name: true, path: true } },
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
   * Signed change applied to `Item.quantity`. Positive for `add`, negative
   * for `consume` and `build` (EVT-28 BOM backflush consumption — see the
   * `StockMovementKind` schema doc comment), either sign for `adjust`.
   * Typically `0` for a pure `move` (this task never moves a partial
   * quantity — see EVT-25 non-goals) but the field always exists so a
   * future partial-quantity move doesn't need a schema change.
   *
   * For a *consuming* write where the caller doesn't already know a
   * safe-to-apply amount (e.g. it needs to clamp to current on-hand), use
   * `recordConsumption` below instead — a blind `{ increment: delta }` here
   * is not race-safe against concurrent consumers of the same item.
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

export interface RecordConsumptionInput {
  itemId: string;
  kind: StockMovementKind;
  /**
   * The upper bound the caller wants to consume — NOT a signed delta.
   * `recordConsumption` computes and atomically applies whatever amount
   * (up to this bound, down to 0) the item's current on-hand actually
   * supports; see the method's doc comment.
   */
  requestedQuantity: number;
  projectId?: string | null;
  note?: string | null;
  createdById?: string | null;
}

/**
 * Input to `recordContainerMove` — a container ("box") re-parent (EVT-30).
 * Unlike `RecordMovementInput`, there is no `Item` row to update: the
 * `Location` row's `parentId`/`path` are written by
 * `LocationsService.moveContainer` itself, in the same transaction, so this
 * method's ONLY job is to write the single audit row (kind is always
 * `'move'`, `delta` is always `0` — a container move never changes any
 * quantity).
 */
export interface RecordContainerMoveInput {
  containerId: string;
  /** The location the container left. `null` when it was previously at root. */
  fromLocationId: string | null;
  /** The location the container arrived at. `null` when it moved to root. */
  toLocationId: string | null;
  note?: string | null;
  createdById?: string | null;
}

/** Bounds `recordConsumption`'s retry loop — see its doc comment. */
const MAX_CONSUME_RETRIES = 5;

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
   * `recordConsumption` (below) is the race-safe sibling for a
   * consume-down-to-on-hand write — together the two methods are the ONLY
   * places `Item.quantity` should ever be written from application code.
   *
   * `itemInclude`, when provided, is forwarded to the `Item` update so the
   * caller gets back the item shape it needs (e.g. `ITEM_DETAIL_INCLUDE`)
   * without a second round trip.
   *
   * The written `StockMovement.workspaceId` (EVT-40) is DERIVED from
   * `itemId`'s own `Item.workspaceId` (one extra `select`), not trusted from
   * caller input — round-2 review, security finding 6: an optional,
   * caller-supplied field is too easy to silently omit (every call site
   * outside this task's scope — `ProjectsService` backflush,
   * `ShoppingListService` restock — would otherwise fall back to the
   * Default Workspace regardless of the item's REAL workspace once a
   * second workspace exists). Deriving it here means the movement's
   * workspace can never be wrong OR omitted, for ANY caller, without that
   * caller having to know anything about tenancy at all.
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
      const owningItem = await tx.item.findUnique({
        where: { id: input.itemId },
        select: { workspaceId: true },
      });
      if (!owningItem) {
        throw new NotFoundException(`Item ${input.itemId} not found`);
      }

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
          workspaceId: owningItem.workspaceId,
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
  // recordConsumption — race-safe consume-down-to-on-hand (EVT-28)
  // -------------------------------------------------------------------------

  /**
   * Race-safe, down-only sibling of `recordMovement`, used by
   * `ProjectsService.backflush()` (EVT-28 review round 2, finding 1). The
   * shape `recordMovement` uses for a consuming write — read current
   * on-hand, clamp in application code, then apply a blind
   * `{ increment: -n }` — leaves a race window: two concurrent callers can
   * both read the same stale on-hand, both clamp against it, and both
   * apply their own decrement, compounding past zero (violates "quantity
   * never goes negative" even though each individual clamp looked safe).
   *
   * This method closes that window by making the "is there enough on
   * hand" check and the decrement ONE atomic database statement — a
   * conditional `updateMany`: `data: { quantity: { decrement: n } }`
   * guarded by `where: { quantity: { gte: n } }`. Two concurrent calls
   * against the same item can't both observe the same on-hand and both
   * succeed past it; whichever the database serializes first "wins" that
   * amount, and the loser sees `count === 0` and must re-clamp.
   *
   * On `count === 0` (not enough on hand for the current attempt — either
   * the caller asked for more than exists, or a concurrent consumer won
   * the race since our last read), the current on-hand is re-read and the
   * attempt is clamped down to it, then retried — bounded by
   * `MAX_CONSUME_RETRIES` so pathological, continuous concurrent writes to
   * the same item can't spin this loop forever. If on-hand is (or becomes)
   * `0`, or the retry bound is hit, `null` is returned: nothing was
   * consumed and no movement was written — the caller treats this the
   * same as its own `requestedQuantity <= 0` skip.
   *
   * Unlike `recordMovement`, this method only accepts an already-open
   * `Prisma.TransactionClient` — every current caller (`backflush`) is
   * already inside one, and the conditional-decrement retry loop needs
   * that same transaction's atomicity for the movement row it writes on
   * success.
   */
  async recordConsumption(
    tx: Prisma.TransactionClient,
    input: RecordConsumptionInput,
  ): Promise<{ movement: StockMovement; consumedQuantity: number } | null> {
    let attempt = Math.max(0, Math.trunc(input.requestedQuantity));

    for (let i = 0; attempt > 0 && i < MAX_CONSUME_RETRIES; i++) {
      const result = await tx.item.updateMany({
        where: { id: input.itemId, quantity: { gte: attempt } },
        data: { quantity: { decrement: attempt } },
      });
      if (result.count > 0) {
        // EVT-26 (mirrors `recordMovement`): a consumption that leaves the
        // item's on-hand `quantity` at or below `minQuantity` opens a
        // `low-stock` shopping-list entry. The conditional `updateMany`
        // above doesn't return the updated row, so it's re-read here —
        // still inside this same transaction, so it reflects exactly the
        // decrement just applied. Read BEFORE the movement write (EVT-40
        // round-2 review, security finding 6) so `workspaceId` can be
        // DERIVED from the item itself, rather than trusted from caller
        // input — see `recordMovement`'s doc comment for the full
        // rationale (same fix, same reasoning, applied here too).
        const updated = await tx.item.findUnique({
          where: { id: input.itemId },
          select: { quantity: true, minQuantity: true, workspaceId: true },
        });
        if (!updated) {
          throw new NotFoundException(`Item ${input.itemId} not found`);
        }

        const movement = await tx.stockMovement.create({
          data: {
            itemId: input.itemId,
            kind: input.kind,
            delta: -attempt,
            projectId: input.projectId ?? null,
            note: input.note ?? null,
            createdById: input.createdById ?? null,
            workspaceId: updated.workspaceId,
          },
        });

        if (updated.minQuantity != null && updated.quantity <= updated.minQuantity) {
          await openLowStockEntry(tx, input.itemId);
        }

        return { movement, consumedQuantity: attempt };
      }

      const current = await tx.item.findUnique({
        where: { id: input.itemId },
        select: { quantity: true },
      });
      attempt = Math.min(attempt, Math.max(0, current?.quantity ?? 0));
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // recordContainerMove — the single write path for a container re-parent (EVT-30)
  // -------------------------------------------------------------------------

  /**
   * Writes exactly ONE `StockMovement` row for a container re-parent —
   * `itemId: null`, `containerId` set, `kind: 'move'`, `delta: 0` (EVT-30 AC
   * 3: "item-level histories are NOT spammed with per-item entries" — every
   * item inside the container keeps its own `locationId` unchanged in the DB
   * sense; only its resolved ancestry changes, via the container's `path`).
   *
   * Same `PrismaClientOrTx` dual-mode as `recordMovement` — accepts either
   * the top-level `PrismaService` (opens its own `$transaction`) or an
   * already-open `Prisma.TransactionClient` (rides along without nesting).
   * `LocationsService.moveContainer` always calls this from inside its own
   * transaction (the container's `Location.parentId`/`path` rewrite and this
   * audit row must land atomically together).
   *
   * `workspaceId` (EVT-40 round-2 review, security finding 6) is DERIVED
   * from the container `Location` being moved (one extra select) — same
   * "never trust caller input for this" rationale as `recordMovement`;
   * re-parenting a container never changes ITS OWN workspace, so this is
   * always correct regardless of who calls it.
   */
  async recordContainerMove(
    client: PrismaClientOrTx,
    input: RecordContainerMoveInput,
  ): Promise<StockMovement> {
    const run = async (tx: Prisma.TransactionClient | PrismaService) => {
      const container = await tx.location.findUnique({
        where: { id: input.containerId },
        select: { workspaceId: true },
      });
      if (!container) {
        throw new NotFoundException(`Container ${input.containerId} not found`);
      }

      return tx.stockMovement.create({
        data: {
          itemId: null,
          containerId: input.containerId,
          kind: 'move',
          delta: 0,
          fromLocationId: input.fromLocationId ?? null,
          toLocationId: input.toLocationId ?? null,
          note: input.note ?? null,
          createdById: input.createdById ?? null,
          workspaceId: container.workspaceId,
        },
      });
    };

    if (isPrismaService(client)) {
      return client.$transaction((tx) => run(tx));
    }
    return run(client);
  }

  // -------------------------------------------------------------------------
  // listForItem — GET /api/items/:id/movements
  // -------------------------------------------------------------------------

  /**
   * Paginated movement history for one item, newest first. 404 when the
   * item doesn't exist OR belongs to a different workspace (EVT-40 AC 2) —
   * same "don't confirm existence" posture as `ItemsService`.
   */
  async listForItem(itemId: string, query: ListMovementsQueryDto, workspaceId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, workspaceId },
      select: { id: true },
    });
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

  // -------------------------------------------------------------------------
  // listForContainer — GET /api/locations/:id/movements (EVT-30 AC 3)
  // -------------------------------------------------------------------------

  /**
   * Paginated movement history for one container location, newest first —
   * only the container's own re-parent events (`containerId` = this
   * location), never a per-item entry. 404 when the location doesn't exist
   * or is not a `container` (an `area` has no move history of its own).
   */
  async listForContainer(containerId: string, query: ListMovementsQueryDto) {
    const location = await this.prisma.location.findUnique({
      where: { id: containerId },
      select: { id: true, kind: true },
    });
    if (!location || location.kind !== 'container') {
      throw new NotFoundException(`Container ${containerId} not found`);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const [total, data] = await Promise.all([
      this.prisma.stockMovement.count({ where: { containerId } }),
      this.prisma.stockMovement.findMany({
        where: { containerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: CONTAINER_MOVEMENT_INCLUDE,
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
