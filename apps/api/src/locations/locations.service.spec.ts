import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { LocationsService, slugify } from './locations.service';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeLocation(
  overrides: Partial<{
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    qrCode: string;
    notes: string | null;
    kind: 'area' | 'container';
  }> = {},
) {
  return {
    id: 'loc-1',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
    notes: null,
    kind: 'area' as const,
    ...overrides,
  };
}

// ─── slugify unit tests ─────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts "West Wall / Cabinet #3" → "west-wall-cabinet-3"', () => {
    expect(slugify('West Wall / Cabinet #3')).toBe('west-wall-cabinet-3');
  });

  it('lowercases input', () => {
    expect(slugify('GARAGE')).toBe('garage');
  });

  it('collapses multiple non-alnum runs to single dash', () => {
    expect(slugify('Shelf  --  A')).toBe('shelf-a');
  });

  it('strips leading and trailing dashes', () => {
    expect(slugify('  #Shelf#  ')).toBe('shelf');
  });

  it('preserves digits', () => {
    expect(slugify('Drawer 2')).toBe('drawer-2');
  });
});

// ─── LocationsService unit tests ───────────────────────────────────────────

describe('LocationsService', () => {
  let service: LocationsService;

  // Granular mock of every Prisma method the service uses.
  const locationMock = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };

  // Transaction client stub returned inside $transaction callbacks.
  const txClient = {
    location: {
      update: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };

  const prismaMock = {
    location: locationMock,
    $transaction: jest.fn(),
  };

  const stockMovementsServiceMock = {
    recordContainerMove: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocationsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockMovementsService, useValue: stockMovementsServiceMock },
      ],
    }).compile();

    service = module.get<LocationsService>(LocationsService);

    // Default: $transaction passes through the callback with the txClient stub.
    prismaMock.$transaction.mockImplementation(
      async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient),
    );
    stockMovementsServiceMock.recordContainerMove.mockResolvedValue({ id: 'mv-1' });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns a flat list with itemCount matching direct items when there are no children', async () => {
      locationMock.findMany.mockResolvedValue([
        { ...makeLocation(), _count: { items: 3 } },
        {
          ...makeLocation({
            id: 'loc-2',
            name: 'West Wall',
            path: 'garage.west-wall',
            parentId: 'loc-1',
          }),
          _count: { items: 0 },
        },
      ]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'loc-1',
        path: 'garage',
        itemCount: 3,
      });
      expect(result[1]).toMatchObject({
        id: 'loc-2',
        path: 'garage.west-wall',
        itemCount: 0,
      });
    });

    it('itemCount is 0 when location has no items', async () => {
      locationMock.findMany.mockResolvedValue([{ ...makeLocation(), _count: { items: 0 } }]);
      const [loc] = await service.findAll();
      expect(loc.itemCount).toBe(0);
    });

    it("surfaces each location's `kind`", async () => {
      locationMock.findMany.mockResolvedValue([
        { ...makeLocation({ kind: 'area' }), _count: { items: 0 } },
        {
          ...makeLocation({ id: 'loc-2', path: 'garage.box-1', kind: 'container' }),
          _count: { items: 0 },
        },
      ]);

      const result = await service.findAll();

      expect(result[0].kind).toBe('area');
      expect(result[1].kind).toBe('container');
    });

    // EVT-30 AC 5: itemCount is RECURSIVE — a container/area rolls up every
    // descendant's direct items, not just its own.
    it('rolls up descendant item counts recursively into the ancestor itemCount', async () => {
      locationMock.findMany.mockResolvedValue([
        { ...makeLocation({ id: 'garage', path: 'garage', kind: 'area' }), _count: { items: 1 } },
        {
          ...makeLocation({
            id: 'box-1',
            path: 'garage.box-1',
            parentId: 'garage',
            kind: 'container',
          }),
          _count: { items: 4 },
        },
        {
          ...makeLocation({
            id: 'box-2',
            path: 'garage.box-1.box-2',
            parentId: 'box-1',
            kind: 'container',
          }),
          _count: { items: 2 },
        },
      ]);

      const result = await service.findAll();
      const byId = new Map(result.map((r) => [r.id, r]));

      // garage: itself (1) + box-1 (4) + box-1's child box-2 (2) = 7
      expect(byId.get('garage')?.itemCount).toBe(7);
      // box-1: itself (4) + child box-2 (2) = 6
      expect(byId.get('box-1')?.itemCount).toBe(6);
      // box-2: leaf, itself only = 2
      expect(byId.get('box-2')?.itemCount).toBe(2);
    });

    it('does not roll up a sibling with a similarly-prefixed name (e.g. "garage" vs "garage-2")', async () => {
      locationMock.findMany.mockResolvedValue([
        { ...makeLocation({ id: 'garage', path: 'garage' }), _count: { items: 1 } },
        { ...makeLocation({ id: 'garage-2', path: 'garage-2' }), _count: { items: 9 } },
      ]);

      const result = await service.findAll();
      const byId = new Map(result.map((r) => [r.id, r]));

      expect(byId.get('garage')?.itemCount).toBe(1);
      expect(byId.get('garage-2')?.itemCount).toBe(9);
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a location with breadcrumb derived from path', async () => {
      locationMock.findUnique.mockResolvedValue({
        ...makeLocation({
          name: 'Cabinet 1',
          path: 'garage.west-wall.cabinet-1',
          parentId: 'loc-parent',
        }),
        children: [],
        items: [],
      });

      const result = await service.findOne('loc-1');

      expect(result.breadcrumb).toEqual([
        { segment: 'garage', path: 'garage' },
        { segment: 'west-wall', path: 'garage.west-wall' },
        { segment: 'cabinet-1', path: 'garage.west-wall.cabinet-1' },
      ]);
    });

    it('throws NotFoundException when location is missing', async () => {
      locationMock.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('surfaces `kind` on the location itself and on every child', async () => {
      locationMock.findUnique.mockResolvedValue({
        ...makeLocation({ kind: 'container' }),
        children: [
          { id: 'child-1', name: 'Inner box', path: 'garage.inner-box', kind: 'container' },
        ],
        items: [],
      });

      const result = await service.findOne('loc-1');

      expect(result.kind).toBe('container');
      expect(result.children[0].kind).toBe('container');
    });
  });

  // ── findByQr ─────────────────────────────────────────────────────────────

  describe('findByQr', () => {
    it('returns the location matching the QR token', async () => {
      const loc = makeLocation({ qrCode: 'qr-garage' });
      locationMock.findUnique.mockResolvedValue(loc);

      const result = await service.findByQr('qr-garage');

      expect(locationMock.findUnique).toHaveBeenCalledWith({
        where: { qrCode: 'qr-garage' },
      });
      expect(result.qrCode).toBe('qr-garage');
    });

    it('throws NotFoundException when QR token is unknown', async () => {
      locationMock.findUnique.mockResolvedValue(null);
      await expect(service.findByQr('unknown-qr')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── create ────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a root location with path = slug', async () => {
      const created = makeLocation({ name: 'Garage', path: 'garage' });
      locationMock.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Garage' });

      expect(locationMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Garage',
          path: 'garage',
          parentId: null,
          kind: 'area',
        }),
      });
      expect(result.path).toBe('garage');
    });

    it('creates a container when kind: "container" is passed (EVT-30 AC 1)', async () => {
      const created = makeLocation({ name: 'Tote Box', path: 'tote-box', kind: 'container' });
      locationMock.create.mockResolvedValue(created);

      await service.create({ name: 'Tote Box', kind: 'container' });

      expect(locationMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'container' }),
      });
    });

    it('creates a nested child with path = parent.path + "." + slug', async () => {
      const parent = makeLocation({ id: 'parent-1', name: 'Garage', path: 'garage' });
      // findUnique returns the parent when looking up parentId
      locationMock.findUnique.mockResolvedValue(parent);

      const child = makeLocation({
        id: 'child-1',
        name: 'West Wall',
        path: 'garage.west-wall',
        parentId: 'parent-1',
      });
      locationMock.create.mockResolvedValue(child);

      const result = await service.create({ name: 'West Wall', parentId: 'parent-1' });

      expect(locationMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'West Wall',
          path: 'garage.west-wall',
          parentId: 'parent-1',
        }),
      });
      expect(result.path).toBe('garage.west-wall');
    });

    it('slugifies the name correctly when composing the path', async () => {
      const parent = makeLocation({ id: 'p', name: 'Garage', path: 'garage' });
      locationMock.findUnique.mockResolvedValue(parent);
      locationMock.create.mockResolvedValue(
        makeLocation({
          name: 'West Wall / Cabinet #3',
          path: 'garage.west-wall-cabinet-3',
          parentId: 'p',
        }),
      );

      await service.create({ name: 'West Wall / Cabinet #3', parentId: 'p' });

      expect(locationMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ path: 'garage.west-wall-cabinet-3' }),
      });
    });

    it('rejects a duplicate sibling slug with ConflictException', async () => {
      locationMock.findUnique.mockResolvedValue(null); // root location, no parent lookup
      const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: {},
      });
      locationMock.create.mockRejectedValue(uniqueError);

      await expect(service.create({ name: 'Garage' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when parentId does not exist', async () => {
      locationMock.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Shelf', parentId: 'nonexistent' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── rename ────────────────────────────────────────────────────────────────

  describe('rename', () => {
    it('renames a location and rewrites all descendant paths atomically', async () => {
      const existing = makeLocation({
        id: 'loc-1',
        name: 'West Wall',
        path: 'garage.west-wall',
        parentId: 'garage-id',
      });
      locationMock.findUnique.mockResolvedValue(existing);
      locationMock.findFirst.mockResolvedValue(null); // no conflict

      const updated = { ...existing, name: 'East Wall', path: 'garage.east-wall' };
      txClient.location.update.mockResolvedValue(updated);
      txClient.$executeRaw.mockResolvedValue(2); // 2 descendants updated

      const result = await service.rename('loc-1', 'East Wall');

      // The transaction must be entered.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);

      // The location itself gets the new name + path.
      expect(txClient.location.update).toHaveBeenCalledWith({
        where: { id: 'loc-1' },
        data: { name: 'East Wall', path: 'garage.east-wall' },
      });

      // Descendant paths are rewritten via $executeRaw.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);

      expect(result.path).toBe('garage.east-wall');
      expect(result.name).toBe('East Wall');
    });

    it('rejects rename when the new path conflicts with another location', async () => {
      const existing = makeLocation({ id: 'loc-1', name: 'West Wall', path: 'garage.west-wall' });
      locationMock.findUnique.mockResolvedValue(existing);
      // Simulate a different location already at the target path.
      locationMock.findFirst.mockResolvedValue(
        makeLocation({ id: 'other', path: 'garage.east-wall' }),
      );

      await expect(service.rename('loc-1', 'East Wall')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws NotFoundException when location to rename does not exist', async () => {
      locationMock.findUnique.mockResolvedValue(null);
      await expect(service.rename('missing', 'New Name')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a no-op and skips the transaction when name and path are unchanged', async () => {
      const existing = makeLocation({ name: 'Garage', path: 'garage' });
      locationMock.findUnique.mockResolvedValue(existing);

      const result = await service.rename('loc-1', 'Garage');

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('uses SUBSTRING prefix-only substitution so a slug duplicated in a child path is not corrupted', async () => {
      // Regression guard: renaming "a" → "b" must turn descendant "a.a.child"
      // into "b.a.child", NOT "b.b.child".  SQL REPLACE() would corrupt it;
      // SUBSTRING-based prefix replacement is the fix.
      const existing = makeLocation({ id: 'loc-a', name: 'A', path: 'a', parentId: null });
      locationMock.findUnique.mockResolvedValue(existing);
      locationMock.findFirst.mockResolvedValue(null); // no conflict
      txClient.location.update.mockResolvedValue({ ...existing, name: 'B', path: 'b' });
      txClient.$executeRaw.mockResolvedValue(1);

      await service.rename('loc-a', 'B');

      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);

      // Inspect the tagged-template-literal arguments.
      // Signature: $executeRaw(strings: TemplateStringsArray, ...values: unknown[])
      const [strings, ...values] = txClient.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...string[],
      ];

      // The SQL template must NOT use REPLACE() (which replaces all occurrences).
      const sqlText = Array.from(strings).join('').toLowerCase();
      expect(sqlText).not.toContain('replace(');
      expect(sqlText).toContain('substring');

      // First interpolated value must be newPrefix; second must be oldPrefix
      // (used inside LENGTH()); third is the LIKE pattern.
      expect(values[0]).toBe('b.'); // newPrefix
      expect(values[1]).toBe('a.'); // oldPrefix for LENGTH()
      expect(values[2]).toBe('a.%'); // WHERE path LIKE
    });

    it('maps P2002 thrown inside $transaction to ConflictException (TOCTOU guard)', async () => {
      // Pre-flight findFirst passes (no conflict visible yet), but the transaction
      // itself hits the @unique constraint because a concurrent rename landed first.
      const existing = makeLocation({ id: 'loc-1', name: 'West Wall', path: 'garage.west-wall' });
      locationMock.findUnique.mockResolvedValue(existing);
      locationMock.findFirst.mockResolvedValue(null); // pre-flight sees no conflict

      const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: {},
      });
      prismaMock.$transaction.mockRejectedValue(uniqueError);

      await expect(service.rename('loc-1', 'East Wall')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ── moveContainer (EVT-30 AC 2/3/4) ─────────────────────────────────────────

  describe('moveContainer', () => {
    it('re-parents a container, rewrites its path, and records exactly one container move', async () => {
      const box = makeLocation({
        id: 'box-1',
        name: 'Tote Box',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });
      const targetParent = { id: 'shelf-2', path: 'garage.shelf-2' };
      const finalDetail = { ...box, path: 'garage.shelf-2.box-1', children: [], items: [] };

      locationMock.findUnique
        .mockResolvedValueOnce(box) // self lookup
        .mockResolvedValueOnce(targetParent) // destination parent lookup
        .mockResolvedValueOnce(finalDetail); // findOne() after the transaction
      locationMock.findFirst.mockResolvedValue(null); // no path conflict
      txClient.location.update.mockResolvedValue({
        ...box,
        parentId: 'shelf-2',
        path: 'garage.shelf-2.box-1',
      });
      txClient.$executeRaw.mockResolvedValue(0);

      const result = await service.moveContainer('box-1', 'shelf-2', 'user-1');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txClient.location.update).toHaveBeenCalledWith({
        where: { id: 'box-1' },
        data: { parentId: 'shelf-2', path: 'garage.shelf-2.box-1' },
      });
      expect(stockMovementsServiceMock.recordContainerMove).toHaveBeenCalledWith(txClient, {
        containerId: 'box-1',
        fromLocationId: 'garage',
        toLocationId: 'shelf-2',
        createdById: 'user-1',
      });
      expect(result).toMatchObject({ id: 'box-1', path: 'garage.shelf-2.box-1' });
    });

    it('rewrites descendant paths via the same SUBSTRING-based $executeRaw as rename', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });
      const targetParent = { id: 'shelf-2', path: 'shelf-2' };

      locationMock.findUnique
        .mockResolvedValueOnce(box)
        .mockResolvedValueOnce(targetParent)
        .mockResolvedValueOnce({ ...box, path: 'shelf-2.box-1', children: [], items: [] });
      locationMock.findFirst.mockResolvedValue(null);
      txClient.location.update.mockResolvedValue(box);
      txClient.$executeRaw.mockResolvedValue(2);

      await service.moveContainer('box-1', 'shelf-2', undefined);

      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('AC 2: moving to root (toParentId null) clears parentId and drops the path prefix', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });

      locationMock.findUnique
        .mockResolvedValueOnce(box) // self lookup — no parent lookup since toParentId is null
        .mockResolvedValueOnce({ ...box, parentId: null, path: 'box-1', children: [], items: [] });
      locationMock.findFirst.mockResolvedValue(null);
      txClient.location.update.mockResolvedValue({ ...box, parentId: null, path: 'box-1' });
      txClient.$executeRaw.mockResolvedValue(0);

      await service.moveContainer('box-1', null);

      expect(txClient.location.update).toHaveBeenCalledWith({
        where: { id: 'box-1' },
        data: { parentId: null, path: 'box-1' },
      });
      expect(stockMovementsServiceMock.recordContainerMove).toHaveBeenCalledWith(
        txClient,
        expect.objectContaining({ fromLocationId: 'garage', toLocationId: null }),
      );
    });

    it('AC 4: rejects moving a container into itself with 422', async () => {
      const box = makeLocation({ id: 'box-1', path: 'garage.box-1', kind: 'container' });
      locationMock.findUnique.mockResolvedValue(box);

      await expect(service.moveContainer('box-1', 'box-1')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('AC 4: rejects moving a container into one of its own descendants with 422', async () => {
      const box = makeLocation({ id: 'box-1', path: 'garage.box-1', kind: 'container' });
      const descendant = { id: 'box-2', path: 'garage.box-1.box-2' };

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce(descendant);

      await expect(service.moveContainer('box-1', 'box-2')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects moving an AREA location — only containers use this flow', async () => {
      const area = makeLocation({ id: 'loc-1', kind: 'area' });
      locationMock.findUnique.mockResolvedValue(area);

      await expect(service.moveContainer('loc-1', 'other')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the container itself does not exist', async () => {
      locationMock.findUnique.mockResolvedValue(null);
      await expect(service.moveContainer('missing', 'other')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the destination parent does not exist', async () => {
      const box = makeLocation({ id: 'box-1', kind: 'container' });
      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce(null);

      await expect(service.moveContainer('box-1', 'missing-parent')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is a no-op and skips the transaction when the container is already at root and stays there', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'box-1',
        parentId: null,
        kind: 'container',
      });
      const detail = { ...box, children: [], items: [] };

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce(detail);

      const result = await service.moveContainer('box-1', null);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(stockMovementsServiceMock.recordContainerMove).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'box-1', path: 'box-1' });
    });

    it('rejects a destination path already taken by another location with ConflictException', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });
      const targetParent = { id: 'shelf-2', path: 'garage.shelf-2' };

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce(targetParent);
      locationMock.findFirst.mockResolvedValue({ id: 'other', path: 'garage.shelf-2.box-1' });

      await expect(service.moveContainer('box-1', 'shelf-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('maps P2002 thrown inside $transaction to ConflictException (TOCTOU guard)', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });
      const targetParent = { id: 'shelf-2', path: 'garage.shelf-2' };

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce(targetParent);
      locationMock.findFirst.mockResolvedValue(null);

      const uniqueError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
        meta: {},
      });
      prismaMock.$transaction.mockRejectedValue(uniqueError);

      await expect(service.moveContainer('box-1', 'shelf-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove', () => {
    it('deletes a leaf location successfully', async () => {
      const loc = makeLocation();
      locationMock.findUnique.mockResolvedValue(loc);
      locationMock.count.mockResolvedValue(0); // no children
      locationMock.delete.mockResolvedValue(loc);

      const result = await service.remove('loc-1');

      expect(locationMock.delete).toHaveBeenCalledWith({ where: { id: 'loc-1' } });
      expect(result).toBe(loc);
    });

    it('rejects deletion when the location has children', async () => {
      locationMock.findUnique.mockResolvedValue(makeLocation());
      locationMock.count.mockResolvedValue(3); // has 3 children

      await expect(service.remove('loc-1')).rejects.toBeInstanceOf(BadRequestException);
      expect(locationMock.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when location to delete does not exist', async () => {
      locationMock.findUnique.mockResolvedValue(null);
      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
