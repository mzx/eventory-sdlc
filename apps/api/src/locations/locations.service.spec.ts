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
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    $executeRaw: jest.fn(),
  };

  /**
   * Row shape returned by `tx.location.findUnique` for the container/
   * destination reads taken AFTER the advisory lock inside `moveContainer`
   * (EVT-30 round 6 — plain reads are safe post-lock; see the service's
   * class-level doc comment).
   */
  function freshRow(
    overrides: Partial<{
      id: string;
      path: string;
      parentId: string | null;
      kind: 'area' | 'container';
      name: string;
    }> = {},
  ) {
    return {
      id: 'box-1',
      path: 'garage.box-1',
      parentId: 'garage',
      kind: 'container' as const,
      name: 'Tote Box',
      ...overrides,
    };
  }

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

      // $executeRaw is called twice: the advisory lock (EVT-30 round 6),
      // then the SUBSTRING-based descendant-path rewrite.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);

      expect(result.path).toBe('garage.east-wall');
      expect(result.name).toBe('East Wall');
    });

    // EVT-30 round 6 (a)/(b): row-locking replaced with a single Postgres
    // transaction-scoped advisory lock — see the service's class-level doc
    // comment for the design decision. `rename` takes the SAME
    // `LOCATION_TREE_LOCK_KEY` as `moveContainer`, as the FIRST statement of
    // its own transaction.
    it('acquires pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY) as the FIRST statement in the transaction', async () => {
      const existing = makeLocation({
        id: 'loc-1',
        name: 'West Wall',
        path: 'garage.west-wall',
        parentId: 'garage-id',
      });
      locationMock.findUnique.mockResolvedValue(existing);
      locationMock.findFirst.mockResolvedValue(null);

      const updated = { ...existing, name: 'East Wall', path: 'garage.east-wall' };
      txClient.location.update.mockResolvedValue(updated);
      txClient.$executeRaw.mockResolvedValue(2);

      await service.rename('loc-1', 'East Wall');

      // $executeRaw, not $queryRaw: `pg_advisory_xact_lock` returns `void`,
      // which Prisma's `$queryRaw` result-row deserializer cannot handle
      // (throws P2010 on real Postgres — verified manually against a real
      // instance during implementation). $executeRaw is called TWICE here:
      // [0] the advisory lock, [1] the SUBSTRING descendant-path rewrite.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);
      // Tagged-template-literal call: (strings: TemplateStringsArray, ...values).
      const [strings, ...values] = txClient.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...bigint[],
      ];
      const sqlText = Array.from(strings).join('');
      expect(sqlText).toContain('pg_advisory_xact_lock');
      expect(values).toEqual([7_030_001n]);

      // The lock must be acquired BEFORE the location update — the whole
      // point of taking it first is that every subsequent statement in the
      // transaction runs under exclusive ownership of tree mutation.
      const lockCallOrder = txClient.$executeRaw.mock.invocationCallOrder[0];
      const updateCallOrder = txClient.location.update.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(updateCallOrder);
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

      // $executeRaw is called twice: [0] the advisory lock (EVT-30 round
      // 6), [1] the SUBSTRING-based descendant-path rewrite under test here.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);

      // Inspect the tagged-template-literal arguments of the SECOND call —
      // the SUBSTRING rewrite, not the advisory lock.
      // Signature: $executeRaw(strings: TemplateStringsArray, ...values: unknown[])
      const [strings, ...values] = txClient.$executeRaw.mock.calls[1] as [
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

    // EVT-30 round 6 (d): defensive-only — with the advisory lock enforcing
    // mutual exclusion, a P2034/P2010-shaped serialization error here is
    // unreachable in practice, but must still map to 409 rather than an
    // unhandled 500 if Postgres ever surfaces one anyway.
    it('maps a P2034 (serialization failure) thrown inside $transaction to ConflictException (defensive)', async () => {
      const existing = makeLocation({ id: 'loc-1', name: 'West Wall', path: 'garage.west-wall' });
      locationMock.findUnique.mockResolvedValue(existing);
      locationMock.findFirst.mockResolvedValue(null);

      const serializationError = new Prisma.PrismaClientKnownRequestError(
        'could not serialize access due to concurrent update',
        { code: 'P2034', clientVersion: '5.0.0', meta: {} },
      );
      prismaMock.$transaction.mockRejectedValue(serializationError);

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
      const finalDetail = { ...box, path: 'garage.shelf-2.box-1', children: [], items: [] };

      locationMock.findUnique
        .mockResolvedValueOnce(box) // self lookup (fast-fail pre-check)
        .mockResolvedValueOnce({ id: 'shelf-2' }) // destination existence-only pre-check
        .mockResolvedValueOnce(finalDetail); // findOne() after the transaction
      // Reads taken AFTER the advisory lock inside the transaction (EVT-30
      // round 6) — plain findUnique, no locking clause: the freshContainer
      // read, then the destination candidate read.
      txClient.location.findUnique
        .mockResolvedValueOnce(
          freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage', name: 'Tote Box' }),
        )
        .mockResolvedValueOnce(
          freshRow({ id: 'shelf-2', path: 'garage.shelf-2', parentId: 'garage', kind: 'area' }),
        );
      txClient.location.findFirst.mockResolvedValue(null); // no path conflict
      txClient.location.update.mockResolvedValue({
        ...box,
        parentId: 'shelf-2',
        path: 'garage.shelf-2.box-1',
      });
      txClient.$executeRaw.mockResolvedValue(0);

      const result = await service.moveContainer('box-1', 'shelf-2', 'user-1');

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      // $executeRaw called TWICE (EVT-30 round 6 — row-locking machinery
      // replaced with a single pg_advisory_xact_lock, issued via
      // $executeRaw not $queryRaw; see the "acquires pg_advisory_xact_lock"
      // spec below for why): [0] the advisory lock, [1] the SUBSTRING
      // descendant-path rewrite.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);
      expect(txClient.location.update).toHaveBeenCalledWith({
        where: { id: 'box-1' },
        data: { parentId: 'shelf-2', path: 'garage.shelf-2.box-1' },
      });
      expect(stockMovementsServiceMock.recordContainerMove).toHaveBeenCalledWith(txClient, {
        containerId: 'box-1',
        fromLocationId: 'garage',
        toLocationId: 'shelf-2',
        createdById: 'user-1',
        note: 'Container "Tote Box" moved',
      });
      expect(result).toMatchObject({ id: 'box-1', path: 'garage.shelf-2.box-1' });
    });

    // EVT-30 round 6: row-locking (rounds 3-5) replaced with a single
    // Postgres transaction-scoped advisory lock — see the service's
    // class-level doc comment for the design decision (round 5's
    // CTE + `FOR UPDATE` design was empirically disproven: Postgres's
    // EvalPlanQual re-evaluates a locked row against the ORIGINAL
    // snapshot, letting a descendant escape the lock set under
    // contention). This asserts the replacement: `pg_advisory_xact_lock`
    // with the named `LOCATION_TREE_LOCK_KEY` constant is the FIRST
    // statement in the transaction, acquired before any location read.
    it('acquires pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY) as the FIRST statement in the transaction', async () => {
      const box = makeLocation({
        id: 'box-1',
        name: 'Tote Box',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });
      const finalDetail = { ...box, path: 'garage.shelf-2.box-1', children: [], items: [] };

      locationMock.findUnique
        .mockResolvedValueOnce(box)
        .mockResolvedValueOnce({ id: 'shelf-2' })
        .mockResolvedValueOnce(finalDetail);
      txClient.location.findUnique
        .mockResolvedValueOnce(
          freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage', name: 'Tote Box' }),
        )
        .mockResolvedValueOnce(
          freshRow({ id: 'shelf-2', path: 'garage.shelf-2', parentId: 'garage', kind: 'area' }),
        );
      txClient.location.findFirst.mockResolvedValue(null);
      txClient.location.update.mockResolvedValue({
        ...box,
        parentId: 'shelf-2',
        path: 'garage.shelf-2.box-1',
      });
      txClient.$executeRaw.mockResolvedValue(0);

      await service.moveContainer('box-1', 'shelf-2', 'user-1');

      // $executeRaw, not $queryRaw: `pg_advisory_xact_lock` returns `void`,
      // which Prisma's `$queryRaw` result-row deserializer cannot handle
      // (throws P2010 on real Postgres — verified manually against a real
      // instance during implementation).
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);
      // Tagged-template-literal call: (strings: TemplateStringsArray, ...values).
      const [strings, ...values] = txClient.$executeRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...bigint[],
      ];
      const sqlText = Array.from(strings).join('');
      expect(sqlText).toContain('pg_advisory_xact_lock');
      expect(values).toEqual([7_030_001n]);

      // The lock's invocation must precede every location read taken
      // inside the transaction.
      const lockCallOrder = txClient.$executeRaw.mock.invocationCallOrder[0];
      const firstFindUniqueOrder = txClient.location.findUnique.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(firstFindUniqueOrder);
    });

    it('rewrites descendant paths via the same SUBSTRING-based $executeRaw as rename', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });

      locationMock.findUnique
        .mockResolvedValueOnce(box)
        .mockResolvedValueOnce({ id: 'shelf-2' })
        .mockResolvedValueOnce({ ...box, path: 'shelf-2.box-1', children: [], items: [] });
      txClient.location.findUnique
        .mockResolvedValueOnce(freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage' }))
        .mockResolvedValueOnce(
          freshRow({ id: 'shelf-2', path: 'shelf-2', parentId: null, kind: 'area' }),
        );
      txClient.location.findFirst.mockResolvedValue(null);
      txClient.location.update.mockResolvedValue(box);
      txClient.$executeRaw.mockResolvedValue(2);

      await service.moveContainer('box-1', 'shelf-2', undefined);

      // [0] the advisory lock, [1] the SUBSTRING descendant-path rewrite
      // under test here.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(2);
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
      txClient.location.findUnique.mockResolvedValueOnce(
        freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage' }),
      );
      txClient.location.findFirst.mockResolvedValue(null);
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

    it('AC 4: rejects moving a container into one of its own descendants with 422 — enforced against the FRESH in-transaction read', async () => {
      const box = makeLocation({ id: 'box-1', path: 'garage.box-1', kind: 'container' });

      locationMock.findUnique
        .mockResolvedValueOnce(box) // self lookup
        .mockResolvedValueOnce({ id: 'box-2' }); // destination existence-only pre-check
      txClient.location.findUnique
        .mockResolvedValueOnce(freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage' }))
        .mockResolvedValueOnce(
          freshRow({ id: 'box-2', path: 'garage.box-1.box-2', parentId: 'box-1' }),
        );

      await expect(service.moveContainer('box-1', 'box-2')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      // The transaction IS opened — the guard now runs against the fresh
      // post-lock read inside it, not the pre-transaction snapshot (EVT-30
      // review round 2, finding 1).
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      // The advisory lock (EVT-30 round 6, issued via $executeRaw — see the
      // "acquires pg_advisory_xact_lock" spec) runs BEFORE the ancestry
      // check throws — it's acquired unconditionally ahead of the cycle
      // guard, not skipped on the eventual-rejection path. Only ONE
      // $executeRaw call here (the lock) since the cycle check throws
      // before the SUBSTRING rewrite is ever reached.
      expect(txClient.$executeRaw).toHaveBeenCalledTimes(1);
      expect(txClient.location.update).not.toHaveBeenCalled();
    });

    // EVT-30 review round 2, finding 1 — regression test for the TOCTOU fix.
    // The outer, non-locked pre-checks (self lookup + destination
    // existence-only check) have no way to see a cycle because they never
    // look at the destination's path. This simulates a concurrent move
    // having already landed the destination as a descendant of the
    // container by the time this call acquires the advisory lock and
    // re-reads — proving the guard is enforced against the in-transaction
    // fresh read, not any pre-transaction snapshot.
    it('TOCTOU: enforces the cycle guard against the fresh in-transaction read, not the pre-transaction snapshot', async () => {
      const box = makeLocation({ id: 'box-1', path: 'garage.box-1', kind: 'container' });

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce({ id: 'box-2' });
      // By the time the advisory lock is acquired and the fresh reads run,
      // box-2 has already become a descendant of box-1 via a concurrent
      // move that committed in between.
      txClient.location.findUnique
        .mockResolvedValueOnce(
          freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage', name: 'Tote Box' }),
        )
        .mockResolvedValueOnce(
          freshRow({
            id: 'box-2',
            path: 'garage.box-1.box-2',
            parentId: 'box-1',
            name: 'Inner Box',
          }),
        );

      await expect(service.moveContainer('box-1', 'box-2')).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(txClient.location.update).not.toHaveBeenCalled();
      expect(stockMovementsServiceMock.recordContainerMove).not.toHaveBeenCalled();
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

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce({ id: 'shelf-2' });
      txClient.location.findUnique
        .mockResolvedValueOnce(freshRow({ id: 'box-1', path: 'garage.box-1', parentId: 'garage' }))
        .mockResolvedValueOnce(
          freshRow({ id: 'shelf-2', path: 'garage.shelf-2', parentId: 'garage', kind: 'area' }),
        );
      txClient.location.findFirst.mockResolvedValue({ id: 'other', path: 'garage.shelf-2.box-1' });

      await expect(service.moveContainer('box-1', 'shelf-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      // The transaction IS opened (the conflict is only detectable once we
      // have the fresh path for the destination); it rolls back when the
      // in-transaction conflict check fails.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txClient.location.update).not.toHaveBeenCalled();
    });

    it('maps P2002 thrown inside $transaction to ConflictException (TOCTOU guard)', async () => {
      const box = makeLocation({
        id: 'box-1',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce({ id: 'shelf-2' });

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

    // EVT-30 round 6 (d): the P2034 retry loop (rounds 4-5) is GONE — with
    // the advisory lock enforcing mutual exclusion across ALL structural
    // mutations, a transaction can no longer contend with itself, so
    // retrying is unnecessary. A P2034/P2010-shaped serialization error
    // thrown here is unreachable in practice, but the defensive catch
    // still maps it to 409 rather than letting it surface as an unhandled
    // 500 if Postgres ever produces one anyway (e.g. a future, unrelated
    // change re-introduces some other source of contention).
    it('maps a P2034 (serialization failure) thrown inside $transaction directly to ConflictException — no retry', async () => {
      const box = makeLocation({
        id: 'box-1',
        name: 'Tote Box',
        path: 'garage.box-1',
        parentId: 'garage',
        kind: 'container',
      });

      locationMock.findUnique.mockResolvedValueOnce(box).mockResolvedValueOnce({ id: 'shelf-2' });

      const serializationError = new Prisma.PrismaClientKnownRequestError(
        'could not serialize access due to concurrent update',
        { code: 'P2034', clientVersion: '5.0.0', meta: {} },
      );
      prismaMock.$transaction.mockRejectedValue(serializationError);

      await expect(service.moveContainer('box-1', 'shelf-2')).rejects.toBeInstanceOf(
        ConflictException,
      );
      // Exactly ONE attempt — no retry loop.
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
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
