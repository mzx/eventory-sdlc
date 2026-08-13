import { BadRequestException, HttpStatus, ParseUUIDPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-1',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
    kind: 'area',
    itemCount: 0,
    ...overrides,
  };
}

// ─── LocationsController unit tests ────────────────────────────────────────

describe('LocationsController', () => {
  let controller: LocationsController;

  const serviceMock = {
    findAll: jest.fn(),
    findByQr: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    rename: jest.fn(),
    remove: jest.fn(),
    moveContainer: jest.fn(),
  };

  const stockMovementsServiceMock = {
    listForContainer: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [
        { provide: LocationsService, useValue: serviceMock },
        { provide: StockMovementsService, useValue: stockMovementsServiceMock },
      ],
    }).compile();

    controller = module.get<LocationsController>(LocationsController);
  });

  // ── findAll ──────────────────────────────────────────────────────────────

  describe('GET /locations (findAll)', () => {
    it('delegates to LocationsService.findAll and returns the result', async () => {
      const list = [makeLocation(), makeLocation({ id: 'loc-2', path: 'garage.shelf' })];
      serviceMock.findAll.mockResolvedValue(list);

      const result = await controller.findAll();

      expect(serviceMock.findAll).toHaveBeenCalledTimes(1);
      expect(result).toBe(list);
    });
  });

  // ── findByQr ─────────────────────────────────────────────────────────────

  describe('GET /locations/by-qr/:qr (findByQr)', () => {
    it('delegates to LocationsService.findByQr with the QR token', async () => {
      const loc = makeLocation({ qrCode: 'qr-abc' });
      serviceMock.findByQr.mockResolvedValue(loc);

      const result = await controller.findByQr('qr-abc');

      expect(serviceMock.findByQr).toHaveBeenCalledWith('qr-abc');
      expect(result).toBe(loc);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('GET /locations/:id (findOne)', () => {
    it('delegates to LocationsService.findOne with the location id', async () => {
      const detail = {
        ...makeLocation(),
        notes: null,
        children: [],
        items: [],
        breadcrumb: [{ segment: 'garage', path: 'garage' }],
      };
      serviceMock.findOne.mockResolvedValue(detail);

      const result = await controller.findOne('loc-1');

      expect(serviceMock.findOne).toHaveBeenCalledWith('loc-1');
      expect(result).toBe(detail);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('POST /locations (create)', () => {
    it('delegates to LocationsService.create with the body', async () => {
      const body = { name: 'Garage' };
      const created = makeLocation();
      serviceMock.create.mockResolvedValue(created);

      const result = await controller.create(body);

      expect(serviceMock.create).toHaveBeenCalledWith(body);
      expect(result).toBe(created);
    });

    it('passes parentId and notes when provided', async () => {
      const body = { name: 'Shelf', parentId: 'loc-1', notes: 'Top shelf' };
      const created = makeLocation({ id: 'loc-2', name: 'Shelf', path: 'garage.shelf' });
      serviceMock.create.mockResolvedValue(created);

      const result = await controller.create(body);

      expect(serviceMock.create).toHaveBeenCalledWith(body);
      expect(result).toBe(created);
    });
  });

  // ── rename ────────────────────────────────────────────────────────────────

  describe('PATCH /locations/:id (rename)', () => {
    it('delegates to LocationsService.rename with id and new name', async () => {
      const updated = makeLocation({ name: 'Storage Room', path: 'storage-room' });
      serviceMock.rename.mockResolvedValue(updated);

      const result = await controller.rename('loc-1', { name: 'Storage Room' });

      expect(serviceMock.rename).toHaveBeenCalledWith('loc-1', 'Storage Room');
      expect(result).toBe(updated);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('DELETE /locations/:id (remove)', () => {
    it('delegates to LocationsService.remove and returns void', async () => {
      serviceMock.remove.mockResolvedValue(makeLocation());

      await controller.remove('loc-1');

      expect(serviceMock.remove).toHaveBeenCalledWith('loc-1');
    });

    it('HTTP status for remove is NO_CONTENT (204)', () => {
      // Verify the decorator metadata on the handler method.
      const metadata: number = Reflect.getMetadata(
        '__httpCode__',
        LocationsController.prototype.remove,
      );
      expect(metadata).toBe(HttpStatus.NO_CONTENT);
    });
  });

  // ── move (EVT-30) ────────────────────────────────────────────────────────

  describe('POST /locations/:id/move (move)', () => {
    it('delegates to LocationsService.moveContainer with id, toParentId, and the caller id', async () => {
      const moved = makeLocation({ id: 'box-1', kind: 'container', parentId: 'shelf-2' });
      serviceMock.moveContainer.mockResolvedValue(moved);

      const result = await controller.move('box-1', { toParentId: 'shelf-2' }, {
        id: 'user-1',
      } as never);

      expect(serviceMock.moveContainer).toHaveBeenCalledWith('box-1', 'shelf-2', 'user-1');
      expect(result).toBe(moved);
    });

    it('defaults toParentId to null when omitted (move to root)', async () => {
      const moved = makeLocation({ id: 'box-1', kind: 'container', parentId: null });
      serviceMock.moveContainer.mockResolvedValue(moved);

      await controller.move('box-1', {}, { id: 'user-1' } as never);

      expect(serviceMock.moveContainer).toHaveBeenCalledWith('box-1', null, 'user-1');
    });

    it('passes undefined createdById when there is no authenticated user', async () => {
      serviceMock.moveContainer.mockResolvedValue(makeLocation());

      await controller.move('box-1', { toParentId: 'shelf-2' }, null);

      expect(serviceMock.moveContainer).toHaveBeenCalledWith('box-1', 'shelf-2', undefined);
    });
  });

  // ── listMovements (EVT-30) ───────────────────────────────────────────────

  describe('GET /locations/:id/movements (listMovements)', () => {
    it('delegates to StockMovementsService.listForContainer with id and query', async () => {
      const page = { data: [], page: 1, pageSize: 20, total: 0, totalPages: 1 };
      stockMovementsServiceMock.listForContainer.mockResolvedValue(page);

      const result = await controller.listMovements('box-1', { page: 2 });

      expect(stockMovementsServiceMock.listForContainer).toHaveBeenCalledWith('box-1', {
        page: 2,
      });
      expect(result).toBe(page);
    });
  });

  // ── ParseUUIDPipe (EVT-30 review round 2, finding 2) ────────────────────
  //
  // `:id/movements` and `:id/move` previously lacked `ParseUUIDPipe`, so a
  // non-UUID id reached Prisma's `@db.Uuid` column and raised P2023 → 500
  // instead of a 400. Verified here at the pipe level (unit tests call
  // controller methods directly, bypassing Nest's request pipeline, so this
  // is the same style of regression test as items.controller.spec.ts).

  describe('ParseUUIDPipe', () => {
    const uuidPipe = new ParseUUIDPipe();
    const VALID_UUID = '11111111-1111-4111-8111-111111111111';

    it('throws BadRequestException for a non-UUID id param', async () => {
      await expect(uuidPipe.transform('not-a-uuid', { type: 'param', data: 'id' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts a valid UUID', async () => {
      const result = await uuidPipe.transform(VALID_UUID, { type: 'param', data: 'id' });
      expect(result).toBe(VALID_UUID);
    });
  });
});
