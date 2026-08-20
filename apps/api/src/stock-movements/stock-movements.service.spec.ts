import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaClientOrTx, StockMovementsService } from './stock-movements.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const FROM_LOC_ID = '22222222-2222-2222-2222-222222222222';
const TO_LOC_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const MOVEMENT_ID = '55555555-5555-5555-5555-555555555555';
const CONTAINER_ID = '66666666-6666-6666-6666-666666666666';
const WORKSPACE_ID = '77777777-7777-7777-7777-777777777777';

function makeMovementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MOVEMENT_ID,
    itemId: ITEM_ID,
    containerId: null,
    kind: 'adjust',
    delta: 3,
    fromLocationId: null,
    toLocationId: null,
    projectId: null,
    note: null,
    createdById: null,
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeItemRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ITEM_ID,
    name: 'Cordless Drill',
    quantity: 4,
    locationId: TO_LOC_ID,
    ...overrides,
  };
}

/**
 * `tx.*` mocks — a bare object exposing only the delegates `recordMovement`
 * / `recordConsumption` / `recordContainerMove` touch. `item.updateMany`
 * backs `recordConsumption`'s conditional decrement (EVT-28 review round 2,
 * finding 1). `item.findUnique` / `location.findUnique` (EVT-40 round-2
 * review, security finding 6) back the workspaceId-derivation reads —
 * `beforeEach` below gives them a sane default so every pre-existing test
 * that doesn't care about the derived value keeps working unmodified.
 */
function makeTxMock() {
  return {
    stockMovement: { create: jest.fn() },
    item: {
      update: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    location: {
      findUnique: jest.fn(),
    },
    // EVT-26 low-stock auto-trigger — raw `INSERT ... ON CONFLICT DO NOTHING`.
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}

/** Top-level `PrismaService` mock — `$transaction` invokes the callback with a fresh `tx` mock. */
function makePrismaMock() {
  const tx = makeTxMock();
  const mock = {
    ...tx,
    location: { findUnique: jest.fn(), findFirst: jest.fn() },
    stockMovement: { ...tx.stockMovement, count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((cb: (tx: ReturnType<typeof makeTxMock>) => unknown) =>
    cb(tx),
  );
  return { mock, tx };
}

function makeLocationRow(overrides: Record<string, unknown> = {}) {
  return { id: CONTAINER_ID, kind: 'container', ...overrides };
}

/** Loosely-typed test doubles stand in for `PrismaClientOrTx` at direct call sites. */
function asClient(mock: unknown): PrismaClientOrTx {
  return mock as PrismaClientOrTx;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('StockMovementsService', () => {
  let service: StockMovementsService;
  let prismaMock: ReturnType<typeof makePrismaMock>['mock'];
  let tx: ReturnType<typeof makePrismaMock>['tx'];

  beforeEach(async () => {
    const built = makePrismaMock();
    prismaMock = built.mock;
    tx = built.tx;

    // EVT-40 round-2 review, security finding 6 — recordMovement /
    // recordConsumption / recordContainerMove all derive `workspaceId` from
    // an item/location read rather than trusting caller input. These
    // defaults let every PRE-EXISTING test (which doesn't care about the
    // derived value) keep passing unmodified; tests that DO care override
    // per-test as usual.
    tx.item.findUnique.mockResolvedValue({
      quantity: 999,
      minQuantity: null,
      workspaceId: WORKSPACE_ID,
    });
    tx.location.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });

    const module: TestingModule = await Test.createTestingModule({
      providers: [StockMovementsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<StockMovementsService>(StockMovementsService);
  });

  // =========================================================================
  // recordMovement — AC 2 (atomic movement + item write)
  // =========================================================================

  describe('recordMovement', () => {
    it('writes the movement AND increments Item.quantity by delta in the same transaction', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'add', delta: 5 }));
      tx.item.update.mockResolvedValue(makeItemRow({ quantity: 9 }));

      const { movement, item } = await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'add',
        delta: 5,
      });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ itemId: ITEM_ID, kind: 'add', delta: 5 }),
      });
      expect(tx.item.update).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        data: { quantity: { increment: 5 } },
        include: {},
      });
      expect(movement.kind).toBe('add');
      expect(item.quantity).toBe(9);
    });

    it('accepts a negative delta unchanged (e.g. a future "consume" movement)', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));
      tx.item.update.mockResolvedValue(makeItemRow({ quantity: 2 }));

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'consume',
        delta: -2,
      });

      expect(tx.item.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { quantity: { increment: -2 } } }),
      );
    });

    it('skips the quantity increment entirely when delta is 0 (a pure move)', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'move', delta: 0 }));
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'move',
        delta: 0,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
      });

      const updateArg = tx.item.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('quantity');
    });

    it('AC 4: kind "move" also sets Item.locationId to toLocationId', async () => {
      tx.stockMovement.create.mockResolvedValue(
        makeMovementRow({ kind: 'move', fromLocationId: FROM_LOC_ID, toLocationId: TO_LOC_ID }),
      );
      tx.item.update.mockResolvedValue(makeItemRow({ locationId: TO_LOC_ID }));

      const { movement } = await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'move',
        delta: 0,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ fromLocationId: FROM_LOC_ID, toLocationId: TO_LOC_ID }),
      });
      expect(tx.item.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ locationId: TO_LOC_ID }) }),
      );
      expect(movement.toLocationId).toBe(TO_LOC_ID);
    });

    it('a "move" to no location (toLocationId omitted) clears Item.locationId', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'move' }));
      tx.item.update.mockResolvedValue(makeItemRow({ locationId: null }));

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'move',
        delta: 0,
        fromLocationId: FROM_LOC_ID,
      });

      expect(tx.item.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ locationId: null }) }),
      );
    });

    it('a non-"move" kind never touches Item.locationId, even if toLocationId is passed', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'add' }));
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'add',
        delta: 1,
        toLocationId: TO_LOC_ID, // informational only on the ledger row for `add`
      });

      const updateArg = tx.item.update.mock.calls[0][0];
      expect(updateArg.data).not.toHaveProperty('locationId');
    });

    it('forwards note, projectId, and createdById onto the movement row', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow());
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'adjust',
        delta: 3,
        note: 'Manual quantity edit',
        createdById: USER_ID,
        projectId: 'proj-1',
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          note: 'Manual quantity edit',
          createdById: USER_ID,
          projectId: 'proj-1',
        }),
      });
    });

    it('defaults optional fields to null when omitted', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow());
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'adjust',
        delta: 1,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fromLocationId: null,
          toLocationId: null,
          projectId: null,
          note: null,
          createdById: null,
        }),
      });
    });

    // -----------------------------------------------------------------------
    // EVT-40 round-2 review, security finding 6 — `workspaceId` is DERIVED
    // from the item being written (a `tx.item.findUnique` read, no longer a
    // caller-supplied field), so it can never be silently wrong or omitted.
    // -----------------------------------------------------------------------

    it("EVT-40: derives workspaceId from the item's own row (not caller input) and stamps it on the movement", async () => {
      tx.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      tx.stockMovement.create.mockResolvedValue(makeMovementRow());
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(prismaMock), {
        itemId: ITEM_ID,
        kind: 'adjust',
        delta: 1,
      });

      expect(tx.item.findUnique).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        select: { workspaceId: true },
      });
      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      });
    });

    it('EVT-40: throws (loudly, not silently) if the item cannot be found while deriving workspaceId', async () => {
      tx.item.findUnique.mockResolvedValue(null);

      await expect(
        service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'adjust',
          delta: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('forwards a caller-supplied itemInclude to the Item update', async () => {
      const include = { tags: true };
      tx.stockMovement.create.mockResolvedValue(makeMovementRow());
      tx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(
        asClient(prismaMock),
        { itemId: ITEM_ID, kind: 'adjust', delta: 1 },
        include as never,
      );

      expect(tx.item.update).toHaveBeenCalledWith(expect.objectContaining({ include }));
    });

    // -----------------------------------------------------------------------
    // Composability: called with an already-open Prisma.TransactionClient
    // (no `$transaction` method) rather than the top-level PrismaService.
    // -----------------------------------------------------------------------

    // -----------------------------------------------------------------------
    // EVT-25 review round 2, finding 5 — failure-path atomicity: the
    // movement row and the Item write must stand or fall together.
    // -----------------------------------------------------------------------

    it('finding 5: propagates a failure from the Item update, so the movement never lands alone', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'adjust', delta: 5 }));
      const writeError = new Error('connection reset');
      tx.item.update.mockRejectedValue(writeError);

      await expect(
        service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'adjust',
          delta: 5,
        }),
      ).rejects.toThrow(writeError);

      // The movement `create` call did happen against the transaction
      // client, but since the transaction is mocked (no real DB rollback to
      // observe), the atomicity guarantee under test is that the overall
      // `$transaction`-wrapped call rejects rather than resolving with a
      // movement and no matching quantity change.
      expect(tx.stockMovement.create).toHaveBeenCalled();
    });

    it('finding 5: propagates a failure from the StockMovement create, without ever touching the Item', async () => {
      const createError = new Error('unique constraint violation');
      tx.stockMovement.create.mockRejectedValue(createError);

      await expect(
        service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'adjust',
          delta: 5,
        }),
      ).rejects.toThrow(createError);

      expect(tx.item.update).not.toHaveBeenCalled();
    });

    it('rides along an already-open transaction client without opening a nested transaction', async () => {
      const openTx = makeTxMock(); // no `$transaction` method — this IS the tx
      openTx.item.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      openTx.stockMovement.create.mockResolvedValue(makeMovementRow());
      openTx.item.update.mockResolvedValue(makeItemRow());

      await service.recordMovement(asClient(openTx), {
        itemId: ITEM_ID,
        kind: 'adjust',
        delta: 1,
      });

      expect(openTx.stockMovement.create).toHaveBeenCalled();
      expect(openTx.item.update).toHaveBeenCalled();
      // The top-level mock's $transaction was never touched.
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // EVT-26 AC 2 — the low-stock auto-trigger
    // -----------------------------------------------------------------------

    describe('EVT-26: low-stock auto-trigger', () => {
      it('opens a low-stock entry when the resulting quantity drops to minQuantity', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 5, minQuantity: 5 }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'consume',
          delta: -2,
        });

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        // Tagged-template call: first arg is the strings array, remaining
        // args are the interpolated values — itemId must be among them.
        const rawArgs = tx.$executeRaw.mock.calls[0];
        expect(rawArgs).toContain(ITEM_ID);
      });

      // EVT-41 AC 4: the raw INSERT predates the EVT-39 workspaceId column
      // on ShoppingListEntry and, left unset, silently falls back to the
      // schema's Default Workspace literal for every item — regression
      // guard proving the ITEM's own workspaceId (derived above, never
      // caller input) is what actually gets stamped.
      it("EVT-41: stamps the opened low-stock entry with the ITEM's own workspaceId, not the caller's", async () => {
        tx.item.findUnique.mockResolvedValue({
          quantity: 5,
          minQuantity: 5,
          workspaceId: WORKSPACE_ID,
        });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 5, minQuantity: 5 }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'consume',
          delta: -2,
        });

        const rawArgs = tx.$executeRaw.mock.calls[0];
        expect(rawArgs).toContain(WORKSPACE_ID);
      });

      it('opens a low-stock entry when the resulting quantity drops BELOW minQuantity', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -5 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 1, minQuantity: 5 }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'consume',
          delta: -5,
        });

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      });

      it('does nothing when minQuantity is null (no replenishment tracking)', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 0, minQuantity: null }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'consume',
          delta: -2,
        });

        expect(tx.$executeRaw).not.toHaveBeenCalled();
      });

      it('does nothing when the resulting quantity is still above minQuantity', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -1 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 6, minQuantity: 5 }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'consume',
          delta: -1,
        });

        expect(tx.$executeRaw).not.toHaveBeenCalled();
      });

      it('AC 2: a further drop below minQuantity does not throw or duplicate — the raw INSERT is idempotent by construction (ON CONFLICT DO NOTHING)', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -1 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 3, minQuantity: 5 }));
        // Simulates the partial unique index already having an open row for
        // this item: the statement executes (0 rows affected), never throws.
        tx.$executeRaw.mockResolvedValue(0);

        await expect(
          service.recordMovement(asClient(prismaMock), {
            itemId: ITEM_ID,
            kind: 'consume',
            delta: -1,
          }),
        ).resolves.toBeDefined();

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      });

      it('checks the trigger on every movement kind, not just "consume" (e.g. a "move" that happens to already be at/under min)', async () => {
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'move', delta: 0 }));
        tx.item.update.mockResolvedValue(makeItemRow({ quantity: 5, minQuantity: 5 }));

        await service.recordMovement(asClient(prismaMock), {
          itemId: ITEM_ID,
          kind: 'move',
          delta: 0,
          fromLocationId: FROM_LOC_ID,
          toLocationId: TO_LOC_ID,
        });

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      });
    });
  });

  // =========================================================================
  // recordConsumption — race-safe consume-down-to-on-hand (EVT-28 review
  // round 2, finding 1)
  // =========================================================================

  describe('recordConsumption', () => {
    it('consumes the full requested amount via ONE conditional updateMany (no findUnique read for the race check itself)', async () => {
      tx.item.updateMany.mockResolvedValue({ count: 1 });
      tx.item.findUnique.mockResolvedValue({ quantity: 5, minQuantity: null });
      tx.stockMovement.create.mockResolvedValue(
        makeMovementRow({ kind: 'build', delta: -3, projectId: 'proj-1' }),
      );

      const result = await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 3,
        projectId: 'proj-1',
        note: 'Backflush: project completion',
      });

      // Regression guard (mirrors the EVT-25 round-2 race test): the fix is
      // proven by the SHAPE of the call, not just the outcome — a
      // conditional `updateMany` guarded by `quantity: { gte: n }`, not a
      // blind read-then-`update`. A single `findUnique` DOES happen after
      // the decrement succeeds — that's the EVT-26 low-stock re-read (see
      // below), not the race-safety mechanism under test here.
      expect(tx.item.updateMany).toHaveBeenCalledWith({
        where: { id: ITEM_ID, quantity: { gte: 3 } },
        data: { quantity: { decrement: 3 } },
      });
      expect(tx.item.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'build',
          delta: -3,
          projectId: 'proj-1',
          note: 'Backflush: project completion',
        }),
      });
      expect(result).toEqual({
        movement: expect.objectContaining({ delta: -3 }),
        consumedQuantity: 3,
      });
    });

    it('finding 1: the first attempt fails the conditional gte check (raced by a concurrent consumer) — re-reads and clamps down, then succeeds', async () => {
      // First attempt (requesting 5) affects 0 rows — on-hand had already
      // dropped to 2 by the time this statement ran. `recordConsumption`
      // must re-read the authoritative on-hand and retry with the clamp,
      // NOT trust the stale value it started with.
      tx.item.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
      tx.item.findUnique.mockResolvedValue({ quantity: 2 });
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'build', delta: -2 }));

      const result = await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 5,
      });

      expect(tx.item.updateMany).toHaveBeenNthCalledWith(1, {
        where: { id: ITEM_ID, quantity: { gte: 5 } },
        data: { quantity: { decrement: 5 } },
      });
      expect(tx.item.findUnique).toHaveBeenCalledWith({
        where: { id: ITEM_ID },
        select: { quantity: true },
      });
      expect(tx.item.updateMany).toHaveBeenNthCalledWith(2, {
        where: { id: ITEM_ID, quantity: { gte: 2 } },
        data: { quantity: { decrement: 2 } },
      });
      expect(result).toEqual({
        movement: expect.objectContaining({ delta: -2 }),
        consumedQuantity: 2,
      });
    });

    it('returns null and writes no movement when on-hand is already 0', async () => {
      tx.item.updateMany.mockResolvedValue({ count: 0 });
      tx.item.findUnique.mockResolvedValue({ quantity: 0 });

      const result = await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 4,
      });

      expect(result).toBeNull();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      // Only the first attempt runs before on-hand is discovered to be 0 —
      // the loop stops rather than retrying with a 0 amount.
      expect(tx.item.updateMany).toHaveBeenCalledTimes(1);
    });

    it('treats requestedQuantity <= 0 as nothing to consume, without touching the database', async () => {
      const result = await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 0,
      });

      expect(result).toBeNull();
      expect(tx.item.updateMany).not.toHaveBeenCalled();
      expect(tx.item.findUnique).not.toHaveBeenCalled();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('bounds the retry loop: gives up and returns null after continual concurrent contention', async () => {
      // Every conditional updateMany fails, and every re-read still reports
      // on-hand > 0 (simulating persistent concurrent writes racing this
      // call) — the retry loop must still terminate rather than spin
      // forever.
      tx.item.updateMany.mockResolvedValue({ count: 0 });
      tx.item.findUnique.mockResolvedValue({ quantity: 1 });

      const result = await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 1,
      });

      expect(result).toBeNull();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
      // Bounded — a small, fixed number of attempts, not unbounded.
      expect(tx.item.updateMany.mock.calls.length).toBeLessThanOrEqual(5);
    });

    it('defaults optional projectId/note/createdById to null when omitted', async () => {
      tx.item.updateMany.mockResolvedValue({ count: 1 });
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'build', delta: -1 }));

      await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'build',
        requestedQuantity: 1,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: null, note: null, createdById: null }),
      });
    });

    it("EVT-40: derives workspaceId from the item's own row (not caller input) and stamps it on the movement", async () => {
      tx.item.updateMany.mockResolvedValue({ count: 1 });
      tx.item.findUnique.mockResolvedValue({
        quantity: 5,
        minQuantity: null,
        workspaceId: WORKSPACE_ID,
      });
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -1 }));

      await service.recordConsumption(asClient(tx) as never, {
        itemId: ITEM_ID,
        kind: 'consume',
        requestedQuantity: 1,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
      });
    });

    it('EVT-40: throws (loudly, not silently) if the item cannot be found while deriving workspaceId', async () => {
      tx.item.updateMany.mockResolvedValue({ count: 1 });
      tx.item.findUnique.mockResolvedValue(null);

      await expect(
        service.recordConsumption(asClient(tx) as never, {
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 1,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    // -----------------------------------------------------------------------
    // EVT-27 review: `recordConsumption` — the only write path for
    // `ItemsService.consume()` — must open the same EVT-26 low-stock entry
    // as `recordMovement` under the same conditions, not silently skip it.
    // -----------------------------------------------------------------------

    describe('EVT-26: low-stock auto-trigger (mirrors recordMovement)', () => {
      it('opens exactly one low-stock entry when consuming crosses the threshold (6 -> 4, min 5)', async () => {
        tx.item.updateMany.mockResolvedValue({ count: 1 });
        tx.item.findUnique.mockResolvedValue({ quantity: 4, minQuantity: 5 });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));

        await service.recordConsumption(asClient(tx) as never, {
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 2,
        });

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        const rawArgs = tx.$executeRaw.mock.calls[0];
        expect(rawArgs).toContain(ITEM_ID);
      });

      it("EVT-41: stamps the opened low-stock entry with the ITEM's own workspaceId", async () => {
        tx.item.updateMany.mockResolvedValue({ count: 1 });
        tx.item.findUnique.mockResolvedValue({
          quantity: 4,
          minQuantity: 5,
          workspaceId: WORKSPACE_ID,
        });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));

        await service.recordConsumption(asClient(tx) as never, {
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 2,
        });

        const rawArgs = tx.$executeRaw.mock.calls[0];
        expect(rawArgs).toContain(WORKSPACE_ID);
      });

      it('is idempotent when a low-stock entry is already open (the raw INSERT is ON CONFLICT DO NOTHING)', async () => {
        tx.item.updateMany.mockResolvedValue({ count: 1 });
        tx.item.findUnique.mockResolvedValue({ quantity: 4, minQuantity: 5 });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));
        tx.$executeRaw.mockResolvedValue(0); // simulates an already-open entry for this item

        await expect(
          service.recordConsumption(asClient(tx) as never, {
            itemId: ITEM_ID,
            kind: 'consume',
            requestedQuantity: 2,
          }),
        ).resolves.toBeDefined();

        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      });

      it('opens none when consuming does NOT cross the threshold (10 -> 8, min 5)', async () => {
        tx.item.updateMany.mockResolvedValue({ count: 1 });
        tx.item.findUnique.mockResolvedValue({ quantity: 8, minQuantity: 5 });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));

        await service.recordConsumption(asClient(tx) as never, {
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 2,
        });

        expect(tx.$executeRaw).not.toHaveBeenCalled();
      });

      it('opens none when minQuantity is null (no replenishment tracking)', async () => {
        tx.item.updateMany.mockResolvedValue({ count: 1 });
        tx.item.findUnique.mockResolvedValue({ quantity: 0, minQuantity: null });
        tx.stockMovement.create.mockResolvedValue(makeMovementRow({ kind: 'consume', delta: -2 }));

        await service.recordConsumption(asClient(tx) as never, {
          itemId: ITEM_ID,
          kind: 'consume',
          requestedQuantity: 2,
        });

        expect(tx.$executeRaw).not.toHaveBeenCalled();
      });
    });
  });

  // =========================================================================
  // recordContainerMove — EVT-30 AC 2/3
  // =========================================================================

  describe('recordContainerMove', () => {
    it('writes exactly one itemless StockMovement row: itemId null, containerId set, kind move, delta 0', async () => {
      tx.stockMovement.create.mockResolvedValue(
        makeMovementRow({ itemId: null, containerId: CONTAINER_ID, kind: 'move', delta: 0 }),
      );

      const movement = await service.recordContainerMove(asClient(prismaMock), {
        containerId: CONTAINER_ID,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
      });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(tx.stockMovement.create).toHaveBeenCalledWith({
        data: {
          itemId: null,
          containerId: CONTAINER_ID,
          kind: 'move',
          delta: 0,
          fromLocationId: FROM_LOC_ID,
          toLocationId: TO_LOC_ID,
          note: null,
          createdById: null,
          workspaceId: WORKSPACE_ID,
        },
      });
      // Never touches Item — a container move has no Item row to update.
      expect(tx.item.update).not.toHaveBeenCalled();
      expect(movement.containerId).toBe(CONTAINER_ID);
    });

    it('never touches Item.quantity/locationId — only the ledger row is written here', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ containerId: CONTAINER_ID }));

      await service.recordContainerMove(asClient(prismaMock), {
        containerId: CONTAINER_ID,
        fromLocationId: null,
        toLocationId: TO_LOC_ID,
      });

      expect(tx.item.update).not.toHaveBeenCalled();
    });

    it('accepts null fromLocationId (container previously at root)', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ containerId: CONTAINER_ID }));

      await service.recordContainerMove(asClient(prismaMock), {
        containerId: CONTAINER_ID,
        fromLocationId: null,
        toLocationId: TO_LOC_ID,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ fromLocationId: null }) }),
      );
    });

    it('forwards note and createdById onto the movement row', async () => {
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ containerId: CONTAINER_ID }));

      await service.recordContainerMove(asClient(prismaMock), {
        containerId: CONTAINER_ID,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
        note: 'Moved to the top shelf',
        createdById: USER_ID,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ note: 'Moved to the top shelf', createdById: USER_ID }),
        }),
      );
    });

    // -----------------------------------------------------------------------
    // EVT-40 round-2 review, security finding 6 — workspaceId is DERIVED
    // from the container Location itself, not trusted from caller input.
    // -----------------------------------------------------------------------

    it("EVT-40: derives workspaceId from the container's own Location row", async () => {
      tx.location.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      tx.stockMovement.create.mockResolvedValue(makeMovementRow({ containerId: CONTAINER_ID }));

      await service.recordContainerMove(asClient(prismaMock), {
        containerId: CONTAINER_ID,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
      });

      expect(tx.location.findUnique).toHaveBeenCalledWith({
        where: { id: CONTAINER_ID },
        select: { workspaceId: true },
      });
      expect(tx.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workspaceId: WORKSPACE_ID }) }),
      );
    });

    it('EVT-40: throws (loudly, not silently) if the container cannot be found while deriving workspaceId', async () => {
      tx.location.findUnique.mockResolvedValue(null);

      await expect(
        service.recordContainerMove(asClient(prismaMock), {
          containerId: CONTAINER_ID,
          fromLocationId: FROM_LOC_ID,
          toLocationId: TO_LOC_ID,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('rides along an already-open transaction client without opening a nested transaction', async () => {
      const openTx = makeTxMock();
      openTx.location.findUnique.mockResolvedValue({ workspaceId: WORKSPACE_ID });
      openTx.stockMovement.create.mockResolvedValue(makeMovementRow({ containerId: CONTAINER_ID }));

      await service.recordContainerMove(asClient(openTx), {
        containerId: CONTAINER_ID,
        fromLocationId: FROM_LOC_ID,
        toLocationId: TO_LOC_ID,
      });

      expect(openTx.stockMovement.create).toHaveBeenCalled();
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // listForItem — GET /api/items/:id/movements (AC 5)
  // =========================================================================

  describe('listForItem', () => {
    it('404s when the item does not exist', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.listForItem(ITEM_ID, {}, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("EVT-40: scopes the existence check to the caller's workspace", async () => {
      // `findFirst` (not `findUnique`) is what makes this a scoped lookup —
      // a foreign-workspace item resolves the exact same "not found" path
      // as a genuinely unknown id (the mock returning null covers both).
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.listForItem(ITEM_ID, {}, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('returns newest-first, paginated, with the item found', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(42);
      const rows = [makeMovementRow({ id: 'mv-2' }), makeMovementRow({ id: 'mv-1' })];
      prismaMock.stockMovement.findMany.mockResolvedValue(rows);

      const result = await service.listForItem(ITEM_ID, {}, WORKSPACE_ID);

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { itemId: ITEM_ID },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual({ data: rows, page: 1, pageSize: 20, total: 42, totalPages: 3 });
    });

    it('applies page/pageSize to skip/take', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(100);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForItem(ITEM_ID, { page: 3, pageSize: 10 }, WORKSPACE_ID);

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(10);
    });

    it('returns an empty page (not an error) when the item has no movements yet', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(0);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForItem(ITEM_ID, {}, WORKSPACE_ID);

      expect(result).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
    });

    it('includes from/to location names and the linked project summary', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(1);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      await service.listForItem(ITEM_ID, {}, WORKSPACE_ID);

      const findManyArg = prismaMock.stockMovement.findMany.mock.calls[0][0];
      expect(findManyArg.include).toEqual(
        expect.objectContaining({
          fromLocation: expect.objectContaining({ select: expect.any(Object) }),
          toLocation: expect.objectContaining({ select: expect.any(Object) }),
          project: expect.objectContaining({ select: expect.any(Object) }),
        }),
      );
    });
  });

  // =========================================================================
  // listForContainer — GET /api/locations/:id/movements (EVT-30 AC 3)
  // =========================================================================

  describe('listForContainer', () => {
    it('404s when the location does not exist', async () => {
      prismaMock.location.findFirst.mockResolvedValue(null);
      await expect(service.listForContainer(CONTAINER_ID, {}, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when the location exists but is an "area", not a "container"', async () => {
      prismaMock.location.findFirst.mockResolvedValue(makeLocationRow({ kind: 'area' }));
      await expect(service.listForContainer(CONTAINER_ID, {}, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("EVT-41: scopes the existence check to the caller's workspace", async () => {
      prismaMock.location.findFirst.mockResolvedValue(null);
      await expect(service.listForContainer(CONTAINER_ID, {}, WORKSPACE_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.location.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: CONTAINER_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('returns newest-first, paginated container-move history, filtered by containerId', async () => {
      prismaMock.location.findFirst.mockResolvedValue(makeLocationRow());
      prismaMock.stockMovement.count.mockResolvedValue(2);
      const rows = [
        makeMovementRow({ id: 'mv-2', itemId: null, containerId: CONTAINER_ID }),
        makeMovementRow({ id: 'mv-1', itemId: null, containerId: CONTAINER_ID }),
      ];
      prismaMock.stockMovement.findMany.mockResolvedValue(rows);

      const result = await service.listForContainer(CONTAINER_ID, {}, WORKSPACE_ID);

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { containerId: CONTAINER_ID },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result).toEqual({ data: rows, page: 1, pageSize: 20, total: 2, totalPages: 1 });
    });

    it('applies page/pageSize to skip/take', async () => {
      prismaMock.location.findFirst.mockResolvedValue(makeLocationRow());
      prismaMock.stockMovement.count.mockResolvedValue(50);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForContainer(
        CONTAINER_ID,
        { page: 2, pageSize: 10 },
        WORKSPACE_ID,
      );

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(5);
    });

    it('returns an empty page (not an error) when the container has no moves yet', async () => {
      prismaMock.location.findFirst.mockResolvedValue(makeLocationRow());
      prismaMock.stockMovement.count.mockResolvedValue(0);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForContainer(CONTAINER_ID, {}, WORKSPACE_ID);

      expect(result).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
    });
  });
});
