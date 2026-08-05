import { HttpStatus } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeLocation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-1',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
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
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationsController],
      providers: [{ provide: LocationsService, useValue: serviceMock }],
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
});
