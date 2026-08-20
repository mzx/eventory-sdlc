import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';

// ---------------------------------------------------------------------------
// Shared Prisma include shape
// ---------------------------------------------------------------------------

/**
 * Everything the Shopping List page needs per entry (EVT-26 AC 4): item
 * name, thumbnail, on-hand/min, and location — without a second round trip.
 */
const ENTRY_INCLUDE = {
  item: {
    select: {
      id: true,
      name: true,
      quantity: true,
      minQuantity: true,
      qrCode: true,
      primaryPhoto: { select: { id: true, filename: true, mimeType: true } },
      location: { select: { id: true, name: true, path: true } },
    },
  },
};

@Injectable()
export class ShoppingListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  // -------------------------------------------------------------------------
  // listOpen — GET /api/shopping-list
  // -------------------------------------------------------------------------

  /**
   * Open entries, oldest-first — the shopping list itself (EVT-26 AC 4), and
   * also the source the web nav badge count (AC 6) is derived from (its
   * length), so the badge and the list can never disagree. Scoped to
   * `workspaceId` (EVT-41) — the badge count and the list are both
   * per-workspace.
   */
  async listOpen(workspaceId: string) {
    return this.prisma.shoppingListEntry.findMany({
      where: { status: 'open', workspaceId },
      orderBy: { createdAt: 'asc' },
      include: ENTRY_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // createManual — POST /api/shopping-list (the "Running low" one-tap action)
  // -------------------------------------------------------------------------

  /**
   * EVT-26 AC 3. Idempotent: at most one OPEN entry per item, same invariant
   * as the auto-trigger (StockMovementsService.recordMovement) — a second
   * tap (or a tap on an item that's already flagged low-stock) returns the
   * existing open entry rather than erroring or duplicating it, which is
   * what gives the button its "one tap, visual confirmation, nothing to
   * think about" feel.
   *
   * `itemId` must belong to `workspaceId` (EVT-41) — 404 for a
   * foreign-workspace or unknown item, never distinguished (same posture as
   * `ItemsService.findById`). The created entry is stamped with the SAME
   * `workspaceId` — never trusted from anywhere else, always derived from
   * the item this check just verified.
   *
   * Checks-then-creates rather than relying solely on the partial unique
   * index catching a violation, so the common (non-racing) path never
   * throws; the index remains the backstop for a genuine race between this
   * call and a concurrent auto-trigger/second tap (caught below via P2002).
   */
  async createManual(itemId: string, workspaceId: string) {
    const item = await this.prisma.item.findFirst({
      where: { id: itemId, workspaceId },
      select: { id: true },
    });
    if (!item) {
      throw new NotFoundException(`Item ${itemId} not found`);
    }

    const existing = await this.findOpenForItem(itemId);
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.shoppingListEntry.create({
        data: { itemId, status: 'open', source: 'manual', workspaceId },
        include: ENTRY_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Lost the race (to the low-stock auto-trigger, or another tap) —
        // the partial unique index caught it; return whichever entry won.
        const winner = await this.findOpenForItem(itemId);
        if (winner) {
          return winner;
        }
      }
      throw err;
    }
  }

  /**
   * `itemId` alone is enough to scope this lookup — the partial unique
   * index (`WHERE status = 'open'`) is already item-scoped, and an item can
   * never belong to more than one workspace, so no separate `workspaceId`
   * filter is needed here (the caller has already verified the item's
   * workspace before reaching this helper).
   */
  private findOpenForItem(itemId: string) {
    return this.prisma.shoppingListEntry.findFirst({
      where: { itemId, status: 'open' },
      include: ENTRY_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // restock — POST /api/shopping-list/:id/restock
  // -------------------------------------------------------------------------

  /**
   * EVT-26 AC 5. Records an `add` movement for the delta between the item's
   * CURRENT on-hand quantity and the freshly-counted `quantity`, then closes
   * the entry — both writes in one transaction, so a restock can never leave
   * an `add` movement recorded against an entry that's still open (or vice
   * versa). 404 for an unknown entry; 409 if it's already resolved (e.g. a
   * double-tap of "Restocked", or resolving the same entry from two tabs).
   *
   * Ordering matters here (round-2 review, MAJOR): the entry is closed
   * FIRST, and `recordMovement` (which re-runs the low-stock check and
   * opens a fresh low-stock entry via
   * `INSERT ... ON CONFLICT ("itemId") WHERE status = 'open' DO NOTHING`)
   * runs SECOND. Closing first means that if the restocked quantity is
   * still <= minQuantity, this entry is no longer 'open' when
   * `recordMovement` runs, so the conflict-tolerant insert finds no
   * existing open row for the item and opens a brand-new one — instead of
   * silently no-op'ing against the very entry we're about to close (which
   * would leave the item under its threshold with zero open entries).
   *
   * The close itself is an atomic, conditional `updateMany` — `WHERE id =
   * entryId AND status = 'open'` — run INSIDE the transaction rather than
   * gated by a separate pre-transaction read, so two concurrent restocks
   * racing on the same entry can't both pass a stale check: the loser's
   * `updateMany` affects zero rows, and it throws `ConflictException`
   * (rolling back its `recordMovement` write) rather than both committing
   * an `add` movement (round-2 review, minor/TOCTOU).
   *
   * 404 for a foreign-workspace entry, same as an unknown id (EVT-41) — same
   * "don't confirm existence" posture as everywhere else.
   */
  async restock(entryId: string, quantity: number, workspaceId: string, createdById?: string) {
    const entry = await this.prisma.shoppingListEntry.findFirst({
      where: { id: entryId, workspaceId },
      include: { item: { select: { id: true, quantity: true, locationId: true } } },
    });
    if (!entry) {
      throw new NotFoundException(`Shopping list entry ${entryId} not found`);
    }

    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.shoppingListEntry.updateMany({
        where: { id: entryId, status: 'open' },
        data: { status: 'done', resolvedAt: new Date() },
      });
      if (closed.count === 0) {
        // Either never existed (already excluded by the 404 check above,
        // barring a delete-in-flight) or — the common case — lost a race
        // with a concurrent restock/resolution: already 'done'.
        throw new ConflictException(`Shopping list entry ${entryId} is already resolved`);
      }

      await this.stockMovementsService.recordMovement(tx, {
        itemId: entry.item.id,
        kind: 'add',
        delta: quantity - entry.item.quantity,
        toLocationId: entry.item.locationId,
        createdById,
        note: 'Restocked from shopping list',
      });

      return tx.shoppingListEntry.findUniqueOrThrow({
        where: { id: entryId },
        include: ENTRY_INCLUDE,
      });
    });
  }
}
