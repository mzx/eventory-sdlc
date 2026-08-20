import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { ShoppingListService } from './shopping-list.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const ENTRY_ID = '22222222-2222-2222-2222-222222222222';
const LOCATION_ID = '33333333-3333-3333-3333-333333333333';
const USER_ID = '44444444-4444-4444-4444-444444444444';
const WORKSPACE_ID = '55555555-5555-5555-5555-555555555555';

function makeEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    itemId: ITEM_ID,
    status: 'open',
    source: 'manual',
    createdAt: new Date('2026-01-01'),
    resolvedAt: null,
    item: { id: ITEM_ID, name: 'Box of Screws', quantity: 2, minQuantity: 5 },
    ...overrides,
  };
}

/** A P2002 error shaped like a real `Prisma.PrismaClientKnownRequestError`. */
function makeUniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
}

function makeTxMock() {
  return {
    shoppingListEntry: { updateMany: jest.fn(), findUniqueOrThrow: jest.fn() },
  };
}

function makePrismaMock() {
  const tx = makeTxMock();
  return {
    item: { findFirst: jest.fn() },
    shoppingListEntry: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((cb: (tx: ReturnType<typeof makeTxMock>) => unknown) => cb(tx)),
    __tx: tx,
  };
}

function makeStockMovementsServiceMock() {
  return { recordMovement: jest.fn() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ShoppingListService', () => {
  let service: ShoppingListService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let stockMovementsMock: ReturnType<typeof makeStockMovementsServiceMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    stockMovementsMock = makeStockMovementsServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShoppingListService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockMovementsService, useValue: stockMovementsMock },
      ],
    }).compile();

    service = module.get<ShoppingListService>(ShoppingListService);
  });

  // =========================================================================
  // listOpen — AC 4
  // =========================================================================

  describe('listOpen', () => {
    it('lists open entries, oldest first, scoped to workspaceId (EVT-41)', async () => {
      const rows = [makeEntryRow()];
      prismaMock.shoppingListEntry.findMany.mockResolvedValue(rows);

      const result = await service.listOpen(WORKSPACE_ID);

      expect(prismaMock.shoppingListEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'open', workspaceId: WORKSPACE_ID },
          orderBy: { createdAt: 'asc' },
        }),
      );
      expect(result).toBe(rows);
    });
  });

  // =========================================================================
  // createManual — AC 3 (the "Running low" one-tap action)
  // =========================================================================

  describe('createManual', () => {
    it('404s when the item does not exist', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.createManual(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
    });

    it('EVT-41: 404s (not distinguished from unknown) when the item belongs to a different workspace', async () => {
      prismaMock.item.findFirst.mockResolvedValue(null);
      await expect(service.createManual(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
      expect(prismaMock.item.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ITEM_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('creates a new open manual entry when none exists, stamped with workspaceId', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      const created = makeEntryRow();
      prismaMock.shoppingListEntry.create.mockResolvedValue(created);

      const result = await service.createManual(ITEM_ID, WORKSPACE_ID);

      expect(prismaMock.shoppingListEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { itemId: ITEM_ID, status: 'open', source: 'manual', workspaceId: WORKSPACE_ID },
        }),
      );
      expect(result).toBe(created);
    });

    it('idempotency: returns the existing open entry instead of creating a duplicate', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      const existing = makeEntryRow({ source: 'low_stock' });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(existing);

      const result = await service.createManual(ITEM_ID, WORKSPACE_ID);

      expect(prismaMock.shoppingListEntry.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('recovers from a lost create race (P2002) by returning the winning entry', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst
        .mockResolvedValueOnce(null) // pre-check: none yet
        .mockResolvedValueOnce(makeEntryRow({ source: 'low_stock' })); // post-conflict re-check
      prismaMock.shoppingListEntry.create.mockRejectedValue(makeUniqueViolation());

      const result = await service.createManual(ITEM_ID, WORKSPACE_ID);

      expect(result).toMatchObject({ id: ENTRY_ID, source: 'low_stock' });
    });

    it('rethrows a non-P2002 error from create', async () => {
      prismaMock.item.findFirst.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      const otherError = new Error('connection reset');
      prismaMock.shoppingListEntry.create.mockRejectedValue(otherError);

      await expect(service.createManual(ITEM_ID, WORKSPACE_ID)).rejects.toThrow(otherError);
    });
  });

  // =========================================================================
  // restock — AC 5
  // =========================================================================

  describe('restock', () => {
    it('404s when the entry does not exist', async () => {
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      await expect(service.restock(ENTRY_ID, 10, WORKSPACE_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('EVT-41: 404s (not distinguished from unknown) when the entry belongs to a different workspace', async () => {
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      await expect(service.restock(ENTRY_ID, 10, WORKSPACE_ID, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(prismaMock.shoppingListEntry.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: ENTRY_ID, workspaceId: WORKSPACE_ID } }),
      );
    });

    it('409s when the entry is already resolved (loses the atomic close race)', async () => {
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(
        makeEntryRow({ status: 'done', item: { id: ITEM_ID, quantity: 2, locationId: null } }),
      );
      // Round-2 review fix: "already resolved" is now detected by the
      // conditional `updateMany` (WHERE status = 'open') inside the
      // transaction affecting zero rows — not by the pre-transaction read's
      // `status` field, which is TOCTOU-prone.
      prismaMock.__tx.shoppingListEntry.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.restock(ENTRY_ID, 10, WORKSPACE_ID, USER_ID)).rejects.toThrow(
        ConflictException,
      );
      expect(stockMovementsMock.recordMovement).not.toHaveBeenCalled();
    });

    it('records an "add" movement for the delta and closes the entry, in one transaction', async () => {
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(
        makeEntryRow({ item: { id: ITEM_ID, quantity: 2, locationId: LOCATION_ID } }),
      );
      prismaMock.__tx.shoppingListEntry.updateMany.mockResolvedValue({ count: 1 });
      stockMovementsMock.recordMovement.mockResolvedValue({});
      const closed = makeEntryRow({ status: 'done', resolvedAt: new Date() });
      prismaMock.__tx.shoppingListEntry.findUniqueOrThrow.mockResolvedValue(closed);

      const result = await service.restock(ENTRY_ID, 10, WORKSPACE_ID, USER_ID);

      expect(prismaMock.$transaction).toHaveBeenCalled();
      // The entry is closed BEFORE recordMovement runs (round-2 review,
      // MAJOR): otherwise a still-below-threshold restock's fresh low-stock
      // insert would no-op against the entry we're about to close.
      expect(prismaMock.__tx.shoppingListEntry.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID, status: 'open' },
          data: expect.objectContaining({ status: 'done' }),
        }),
      );
      const updateManyArg = prismaMock.__tx.shoppingListEntry.updateMany.mock.calls[0][0];
      expect(updateManyArg.data.resolvedAt).toBeInstanceOf(Date);
      expect(stockMovementsMock.recordMovement).toHaveBeenCalledWith(
        prismaMock.__tx,
        expect.objectContaining({
          itemId: ITEM_ID,
          kind: 'add',
          delta: 8, // 10 counted - 2 on hand
          toLocationId: LOCATION_ID,
          createdById: USER_ID,
        }),
      );
      const updateManyOrder =
        prismaMock.__tx.shoppingListEntry.updateMany.mock.invocationCallOrder[0];
      const recordMovementOrder = stockMovementsMock.recordMovement.mock.invocationCallOrder[0];
      expect(updateManyOrder).toBeLessThan(recordMovementOrder);
      expect(result).toBe(closed);
    });
  });
});
