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

function makeMovementRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MOVEMENT_ID,
    itemId: ITEM_ID,
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

/** `tx.*` mocks — a bare object exposing only the delegates `recordMovement` touches. */
function makeTxMock() {
  return {
    stockMovement: { create: jest.fn() },
    item: { update: jest.fn(), findUnique: jest.fn() },
    // EVT-26 low-stock auto-trigger — raw `INSERT ... ON CONFLICT DO NOTHING`.
    $executeRaw: jest.fn().mockResolvedValue(0),
  };
}

/** Top-level `PrismaService` mock — `$transaction` invokes the callback with a fresh `tx` mock. */
function makePrismaMock() {
  const tx = makeTxMock();
  const mock = {
    ...tx,
    location: { findUnique: jest.fn() },
    stockMovement: { ...tx.stockMovement, count: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((cb: (tx: ReturnType<typeof makeTxMock>) => unknown) =>
    cb(tx),
  );
  return { mock, tx };
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
  // listForItem — GET /api/items/:id/movements (AC 5)
  // =========================================================================

  describe('listForItem', () => {
    it('404s when the item does not exist', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.listForItem(ITEM_ID, {})).rejects.toThrow(NotFoundException);
    });

    it('returns newest-first, paginated, with the item found', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(42);
      const rows = [makeMovementRow({ id: 'mv-2' }), makeMovementRow({ id: 'mv-1' })];
      prismaMock.stockMovement.findMany.mockResolvedValue(rows);

      const result = await service.listForItem(ITEM_ID, {});

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
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(100);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForItem(ITEM_ID, { page: 3, pageSize: 10 });

      expect(prismaMock.stockMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
      expect(result.totalPages).toBe(10);
    });

    it('returns an empty page (not an error) when the item has no movements yet', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(0);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.listForItem(ITEM_ID, {});

      expect(result).toEqual({ data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 });
    });

    it('includes from/to location names and the linked project summary', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.stockMovement.count.mockResolvedValue(1);
      prismaMock.stockMovement.findMany.mockResolvedValue([]);

      await service.listForItem(ITEM_ID, {});

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
});
