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
    shoppingListEntry: { update: jest.fn() },
  };
}

function makePrismaMock() {
  const tx = makeTxMock();
  return {
    item: { findUnique: jest.fn() },
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
    it('lists open entries, oldest first', async () => {
      const rows = [makeEntryRow()];
      prismaMock.shoppingListEntry.findMany.mockResolvedValue(rows);

      const result = await service.listOpen();

      expect(prismaMock.shoppingListEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'open' },
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
      prismaMock.item.findUnique.mockResolvedValue(null);
      await expect(service.createManual(ITEM_ID)).rejects.toThrow(NotFoundException);
    });

    it('creates a new open manual entry when none exists', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      const created = makeEntryRow();
      prismaMock.shoppingListEntry.create.mockResolvedValue(created);

      const result = await service.createManual(ITEM_ID);

      expect(prismaMock.shoppingListEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: { itemId: ITEM_ID, status: 'open', source: 'manual' } }),
      );
      expect(result).toBe(created);
    });

    it('idempotency: returns the existing open entry instead of creating a duplicate', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      const existing = makeEntryRow({ source: 'low_stock' });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(existing);

      const result = await service.createManual(ITEM_ID);

      expect(prismaMock.shoppingListEntry.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('recovers from a lost create race (P2002) by returning the winning entry', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst
        .mockResolvedValueOnce(null) // pre-check: none yet
        .mockResolvedValueOnce(makeEntryRow({ source: 'low_stock' })); // post-conflict re-check
      prismaMock.shoppingListEntry.create.mockRejectedValue(makeUniqueViolation());

      const result = await service.createManual(ITEM_ID);

      expect(result).toMatchObject({ id: ENTRY_ID, source: 'low_stock' });
    });

    it('rethrows a non-P2002 error from create', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: ITEM_ID });
      prismaMock.shoppingListEntry.findFirst.mockResolvedValue(null);
      const otherError = new Error('connection reset');
      prismaMock.shoppingListEntry.create.mockRejectedValue(otherError);

      await expect(service.createManual(ITEM_ID)).rejects.toThrow(otherError);
    });
  });

  // =========================================================================
  // restock — AC 5
  // =========================================================================

  describe('restock', () => {
    it('404s when the entry does not exist', async () => {
      prismaMock.shoppingListEntry.findUnique.mockResolvedValue(null);
      await expect(service.restock(ENTRY_ID, 10, USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('409s when the entry is already resolved', async () => {
      prismaMock.shoppingListEntry.findUnique.mockResolvedValue(
        makeEntryRow({ status: 'done', item: { id: ITEM_ID, quantity: 2, locationId: null } }),
      );
      await expect(service.restock(ENTRY_ID, 10, USER_ID)).rejects.toThrow(ConflictException);
    });

    it('records an "add" movement for the delta and closes the entry, in one transaction', async () => {
      prismaMock.shoppingListEntry.findUnique.mockResolvedValue(
        makeEntryRow({ item: { id: ITEM_ID, quantity: 2, locationId: LOCATION_ID } }),
      );
      stockMovementsMock.recordMovement.mockResolvedValue({});
      const closed = makeEntryRow({ status: 'done', resolvedAt: new Date() });
      prismaMock.__tx.shoppingListEntry.update.mockResolvedValue(closed);

      const result = await service.restock(ENTRY_ID, 10, USER_ID);

      expect(prismaMock.$transaction).toHaveBeenCalled();
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
      expect(prismaMock.__tx.shoppingListEntry.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ENTRY_ID },
          data: expect.objectContaining({ status: 'done' }),
        }),
      );
      const updateArg = prismaMock.__tx.shoppingListEntry.update.mock.calls[0][0];
      expect(updateArg.data.resolvedAt).toBeInstanceOf(Date);
      expect(result).toBe(closed);
    });
  });
});
