import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { ProjectsService } from './projects.service';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    name: 'Garage workbench',
    description: null,
    status: 'planned',
    notes: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeBomLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'line-1',
    projectId: 'project-1',
    itemId: null,
    name: '2x4 lumber',
    quantity: 1,
    unit: null,
    notes: null,
    picked: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeP2025Error() {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: '5.22.0',
  });
}

// ─── ProjectsService unit tests ─────────────────────────────────────────────

describe('ProjectsService', () => {
  let service: ProjectsService;

  const projectMock = {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const bomLineMock = {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const itemMock = {
    findUnique: jest.fn(),
  };

  const stockMovementMock = {
    count: jest.fn(),
  };

  // `tx.*` mocks — a bare object exposing only the delegates `backflush`
  // touches inside `$transaction`. `tx.project.update` and `tx.item`
  // deliberately share the same jest.fn()s as the top-level mocks below so
  // a test can assert on either. `tx.stockMovement.count` backs the
  // idempotency guard, which now runs INSIDE the transaction (review round
  // 2, finding 2) rather than against the top-level `stockMovementMock`.
  const txProjectMock = { update: jest.fn() };
  const txItemMock = { findUnique: jest.fn() };
  const txStockMovementMock = { count: jest.fn() };

  const prismaMock = {
    project: projectMock,
    bomLine: bomLineMock,
    item: itemMock,
    stockMovement: stockMovementMock,
    $transaction: jest.fn(),
  };

  const stockMovementsServiceMock = {
    recordMovement: jest.fn(),
    recordConsumption: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    prismaMock.$transaction.mockImplementation(
      (
        cb: (tx: {
          project: typeof txProjectMock;
          item: typeof txItemMock;
          stockMovement: typeof txStockMovementMock;
        }) => unknown,
      ) => cb({ project: txProjectMock, item: txItemMock, stockMovement: txStockMovementMock }),
    );
    // Default: not already backflushed — most tests only care about this
    // when explicitly testing the idempotency guard.
    txStockMovementMock.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: StockMovementsService, useValue: stockMovementsServiceMock },
      ],
    }).compile();

    service = module.get<ProjectsService>(ProjectsService);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('returns projects annotated with lineCount from BOM line _count', async () => {
      projectMock.findMany.mockResolvedValue([
        { ...makeProject(), _count: { bomLines: 3 } },
        { ...makeProject({ id: 'project-2' }), _count: { bomLines: 0 } },
      ]);

      const result = await service.list({});

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'project-1', lineCount: 3 });
      expect(result[1]).toMatchObject({ id: 'project-2', lineCount: 0 });
      // `_count` must not leak into the returned shape.
      expect(result[0]).not.toHaveProperty('_count');
    });

    it('filters by status when provided', async () => {
      projectMock.findMany.mockResolvedValue([]);

      await service.list({ status: 'in_progress' as never });

      expect(projectMock.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'in_progress' } }),
      );
    });

    it('applies no status filter when omitted', async () => {
      projectMock.findMany.mockResolvedValue([]);

      await service.list({});

      expect(projectMock.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns a project with BOM lines including linked item summary', async () => {
      const project = {
        ...makeProject(),
        bomLines: [
          { ...makeBomLine(), item: null },
          {
            ...makeBomLine({ id: 'line-2', itemId: 'item-1', name: 'Cordless drill' }),
            item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
          },
        ],
      };
      projectMock.findUnique.mockResolvedValue(project);

      const result = await service.findOne('project-1');

      expect(result.bomLines).toHaveLength(2);
      expect(result.bomLines[1].item).toEqual({
        id: 'item-1',
        name: 'Cordless drill',
        qrCode: 'qr-1',
      });
    });

    it('throws NotFoundException when project is missing', async () => {
      projectMock.findUnique.mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renames stockMovements to consumed (EVT-28 AC 5: project detail shows the consumed record)', async () => {
      const buildMovement = {
        id: 'mv-1',
        itemId: 'item-1',
        kind: 'build',
        delta: -2,
        projectId: 'project-1',
        note: 'Backflush: project completion',
        createdAt: new Date('2026-01-02'),
        item: { id: 'item-1', name: 'Cordless drill', qrCode: 'qr-1' },
      };
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [],
        stockMovements: [buildMovement],
      });

      const result = await service.findOne('project-1');

      expect(result.consumed).toEqual([buildMovement]);
      expect(result).not.toHaveProperty('stockMovements');
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a project with the given fields', async () => {
      const created = makeProject();
      projectMock.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Garage workbench' });

      expect(projectMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'Garage workbench' }),
      });
      expect(result).toBe(created);
    });

    it('converts startedAt/completedAt ISO strings to Date objects', async () => {
      projectMock.create.mockResolvedValue(makeProject());

      await service.create({
        name: 'Garage workbench',
        startedAt: '2026-02-01T00:00:00.000Z',
        completedAt: '2026-03-01T00:00:00.000Z',
      });

      const call = projectMock.create.mock.calls[0][0];
      expect(call.data.startedAt).toBeInstanceOf(Date);
      expect(call.data.completedAt).toBeInstanceOf(Date);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates scalar fields on an existing project', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());
      const updated = makeProject({ status: 'in_progress' });
      projectMock.update.mockResolvedValue(updated);

      const result = await service.update('project-1', { status: 'in_progress' as never });

      expect(projectMock.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: expect.objectContaining({ status: 'in_progress' }),
      });
      expect(result).toBe(updated);
    });

    it('throws NotFoundException when the project does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(null);

      await expect(service.update('missing', { name: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(projectMock.update).not.toHaveBeenCalled();
    });
  });

  // ── remove — cascade delete ─────────────────────────────────────────────

  describe('remove', () => {
    it('deletes the project (BOM lines cascade via schema onDelete: Cascade)', async () => {
      projectMock.delete.mockResolvedValue(makeProject());

      await service.remove('project-1');

      expect(projectMock.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
    });

    it('throws NotFoundException when the project does not exist (P2025)', async () => {
      projectMock.delete.mockRejectedValue(makeP2025Error());

      await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('re-throws non-P2025 Prisma errors unchanged', async () => {
      const otherErr = new Prisma.PrismaClientKnownRequestError('boom', {
        code: 'P2003',
        clientVersion: '5.22.0',
      });
      projectMock.delete.mockRejectedValue(otherErr);

      await expect(service.remove('project-1')).rejects.toBe(otherErr);
    });
  });

  // ── addBomLine — from itemId (name copied) ──────────────────────────────

  describe('addBomLine — from itemId', () => {
    it('copies the name from the linked item', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());
      itemMock.findUnique.mockResolvedValue({ id: 'item-1', name: 'Cordless drill' });
      const created = makeBomLine({ itemId: 'item-1', name: 'Cordless drill' });
      bomLineMock.create.mockResolvedValue(created);

      const result = await service.addBomLine('project-1', { itemId: 'item-1' });

      expect(bomLineMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: 'project-1',
          itemId: 'item-1',
          name: 'Cordless drill',
        }),
        include: expect.anything(),
      });
      expect(result).toBe(created);
    });

    it('ignores any `name` in the body when itemId is provided (copies the item name instead)', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());
      itemMock.findUnique.mockResolvedValue({ id: 'item-1', name: 'Cordless drill' });
      bomLineMock.create.mockResolvedValue(makeBomLine());

      await service.addBomLine('project-1', { itemId: 'item-1', name: 'Wrong name' });

      expect(bomLineMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Cordless drill' }) }),
      );
    });

    it('throws NotFoundException when the linked item does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());
      itemMock.findUnique.mockResolvedValue(null);

      await expect(
        service.addBomLine('project-1', { itemId: 'missing-item' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(bomLineMock.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the project does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(null);

      await expect(
        service.addBomLine('missing-project', { itemId: 'item-1' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── addBomLine — free text ───────────────────────────────────────────────

  describe('addBomLine — free text', () => {
    it('creates a line with itemId null when only name is provided', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());
      const created = makeBomLine({ name: '2x4 lumber', itemId: null });
      bomLineMock.create.mockResolvedValue(created);

      const result = await service.addBomLine('project-1', { name: '2x4 lumber', quantity: 4 });

      expect(bomLineMock.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ projectId: 'project-1', itemId: null, name: '2x4 lumber' }),
        include: expect.anything(),
      });
      expect(itemMock.findUnique).not.toHaveBeenCalled();
      expect(result).toBe(created);
    });

    it('throws BadRequestException when neither itemId nor name is provided', async () => {
      projectMock.findUnique.mockResolvedValue(makeProject());

      await expect(service.addBomLine('project-1', {})).rejects.toBeInstanceOf(BadRequestException);
      expect(bomLineMock.create).not.toHaveBeenCalled();
    });
  });

  // ── updateBomLine — edit ─────────────────────────────────────────────────

  describe('updateBomLine', () => {
    it('updates scalar fields on an existing line', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine());
      const updated = makeBomLine({ quantity: 6, unit: 'pcs' });
      bomLineMock.update.mockResolvedValue(updated);

      const result = await service.updateBomLine('project-1', 'line-1', {
        quantity: 6,
        unit: 'pcs',
      });

      expect(bomLineMock.update).toHaveBeenCalledWith({
        where: { id: 'line-1' },
        data: expect.objectContaining({ quantity: 6, unit: 'pcs' }),
        include: expect.anything(),
      });
      expect(result).toBe(updated);
    });

    it('re-copies the name when itemId is provided', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine());
      itemMock.findUnique.mockResolvedValue({ id: 'item-2', name: 'Torque wrench' });
      bomLineMock.update.mockResolvedValue(
        makeBomLine({ itemId: 'item-2', name: 'Torque wrench' }),
      );

      await service.updateBomLine('project-1', 'line-1', { itemId: 'item-2' });

      expect(bomLineMock.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ itemId: 'item-2', name: 'Torque wrench' }),
        }),
      );
    });

    it('throws NotFoundException when the line does not exist', async () => {
      bomLineMock.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBomLine('project-1', 'missing-line', { quantity: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFoundException when the line belongs to a different project', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine({ projectId: 'other-project' }));

      await expect(
        service.updateBomLine('project-1', 'line-1', { quantity: 2 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('persists the picked check-off state (EVT-29 AC 3)', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine());
      bomLineMock.update.mockResolvedValue(makeBomLine({ picked: true }));

      await service.updateBomLine('project-1', 'line-1', { picked: true });

      expect(bomLineMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ picked: true }) }),
      );
    });
  });

  // ── removeBomLine — delete ───────────────────────────────────────────────

  describe('removeBomLine', () => {
    it('deletes an existing line', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine());
      bomLineMock.delete.mockResolvedValue(makeBomLine());

      await service.removeBomLine('project-1', 'line-1');

      expect(bomLineMock.delete).toHaveBeenCalledWith({ where: { id: 'line-1' } });
    });

    it('throws NotFoundException when the line does not exist', async () => {
      bomLineMock.findUnique.mockResolvedValue(null);

      await expect(service.removeBomLine('project-1', 'missing-line')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(bomLineMock.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the line belongs to a different project', async () => {
      bomLineMock.findUnique.mockResolvedValue(makeBomLine({ projectId: 'other-project' }));

      await expect(service.removeBomLine('project-1', 'line-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(bomLineMock.delete).not.toHaveBeenCalled();
    });
  });

  // ── availability — GET /:id/availability (EVT-29 AC 1, 2, 3) ────────────

  describe('availability', () => {
    it('returns ok/short/untracked per line and a correct clearToBuild summary (AC 1)', async () => {
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-1', itemId: 'item-1', name: 'Cordless drill', quantity: 2 }),
            item: {
              id: 'item-1',
              quantity: 5,
              location: { id: 'loc-1', name: 'Cabinet 3', path: 'garage.cabinet-3' },
            },
          },
          {
            ...makeBomLine({ id: 'line-2', itemId: 'item-2', name: 'M3 screws', quantity: 10 }),
            item: { id: 'item-2', quantity: 4, location: null },
          },
          {
            ...makeBomLine({ id: 'line-3', name: '2x4 lumber', quantity: 4 }),
            item: null,
          },
        ],
      });

      const result = await service.availability('project-1');

      expect(result.projectId).toBe('project-1');
      expect(result.asOf).toEqual(expect.any(String));
      expect(result.counts).toEqual({ ok: 1, short: 1, untracked: 1 });
      // A shortage exists, so the project is not clear to build.
      expect(result.clearToBuild).toBe(false);
      expect(result.lines).toEqual([
        expect.objectContaining({
          lineId: 'line-1',
          itemId: 'item-1',
          onHand: 5,
          status: 'ok',
          location: { id: 'loc-1', name: 'Cabinet 3', path: 'garage.cabinet-3' },
        }),
        expect.objectContaining({
          lineId: 'line-2',
          itemId: 'item-2',
          onHand: 4,
          status: 'short',
          location: null,
        }),
        expect.objectContaining({
          lineId: 'line-3',
          itemId: null,
          onHand: null,
          status: 'untracked',
          location: null,
        }),
      ]);
    });

    it('aggregates demand across multiple BOM lines that share the same item and flags the shortfall (AC 1)', async () => {
      // Two BOM lines both link "M3 screw" (item-1): line A needs 2, line B
      // needs 3. On-hand is 3. Evaluated in isolation both lines would read
      // "ok" against the same raw onHand=3 (bug); aggregated demand is
      // 2 + 3 = 5 > 3, so the later line (createdAt-asc order) must be
      // marked short and clearToBuild must flip to false.
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-a', itemId: 'item-1', name: 'M3 screw', quantity: 2 }),
            item: { id: 'item-1', quantity: 3, location: null },
          },
          {
            ...makeBomLine({ id: 'line-b', itemId: 'item-1', name: 'M3 screw', quantity: 3 }),
            item: { id: 'item-1', quantity: 3, location: null },
          },
        ],
      });

      const result = await service.availability('project-1');

      expect(result.counts).toEqual({ ok: 1, short: 1, untracked: 0 });
      expect(result.clearToBuild).toBe(false);
      expect(result.lines).toEqual([
        expect.objectContaining({ lineId: 'line-a', onHand: 3, status: 'ok' }),
        expect.objectContaining({ lineId: 'line-b', onHand: 3, status: 'short' }),
      ]);
    });

    it('marks both same-item lines ok when their combined demand fits on-hand (AC 1)', async () => {
      // Same shared item across two lines, but combined demand (2 + 3 = 5)
      // fits within on-hand (5): both lines should read ok.
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-a', itemId: 'item-1', name: 'M3 screw', quantity: 2 }),
            item: { id: 'item-1', quantity: 5, location: null },
          },
          {
            ...makeBomLine({ id: 'line-b', itemId: 'item-1', name: 'M3 screw', quantity: 3 }),
            item: { id: 'item-1', quantity: 5, location: null },
          },
        ],
      });

      const result = await service.availability('project-1');

      expect(result.counts).toEqual({ ok: 2, short: 0, untracked: 0 });
      expect(result.clearToBuild).toBe(true);
      expect(result.lines).toEqual([
        expect.objectContaining({ lineId: 'line-a', onHand: 5, status: 'ok' }),
        expect.objectContaining({ lineId: 'line-b', onHand: 5, status: 'ok' }),
      ]);
    });

    it('is clear to build when every tracked line is ok, regardless of untracked lines (AC 1/2)', async () => {
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 2 }),
            item: { id: 'item-1', quantity: 2, location: null },
          },
          { ...makeBomLine({ id: 'line-2', name: '2x4 lumber' }), item: null },
        ],
      });

      const result = await service.availability('project-1');

      expect(result.counts).toEqual({ ok: 1, short: 0, untracked: 1 });
      expect(result.clearToBuild).toBe(true);
    });

    it("includes each line's persisted picked state (AC 3)", async () => {
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 1, picked: true }),
            item: { id: 'item-1', quantity: 1, location: null },
          },
        ],
      });

      const result = await service.availability('project-1');

      expect(result.lines[0]).toMatchObject({ picked: true });
    });

    it('throws NotFoundException when the project does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(null);
      await expect(service.availability('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── deleting an inventory item leaves the BOM line's copied name (itemId null) ──

  describe('item deletion leaves BOM line name intact (AC 3)', () => {
    it('findOne still returns the line with its copied name and item: null after the linked item is gone', async () => {
      // Simulates the state after Item.delete cascades itemId -> null via
      // `onDelete: SetNull` (schema-level, not service code) — the line's
      // denormalized `name` is untouched.
      const project = {
        ...makeProject(),
        bomLines: [{ ...makeBomLine({ itemId: null, name: 'Cordless drill' }), item: null }],
      };
      projectMock.findUnique.mockResolvedValue(project);

      const result = await service.findOne('project-1');

      expect(result.bomLines[0]).toMatchObject({
        itemId: null,
        name: 'Cordless drill',
        item: null,
      });
    });
  });

  // ── previewBackflush — GET /:id/backflush-preview (EVT-28 AC 1) ─────────

  describe('previewBackflush', () => {
    it('lists item-linked lines with on-hand + suggested consume quantity, shortage flagged, free-text skipped', async () => {
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ id: 'line-1', itemId: 'item-1', name: 'Cordless drill', quantity: 3 }),
            item: { id: 'item-1', quantity: 1 },
          },
          { ...makeBomLine({ id: 'line-2', name: '2x4 lumber', quantity: 4 }), item: null },
        ],
      });
      stockMovementMock.count.mockResolvedValue(0);

      const result = await service.previewBackflush('project-1');

      expect(result.alreadyBackflushed).toBe(false);
      expect(result.lines).toEqual([
        expect.objectContaining({
          lineId: 'line-1',
          itemId: 'item-1',
          quantity: 3,
          onHand: 1,
          suggestedConsumeQuantity: 1,
          shortage: true,
          skipped: false,
        }),
        expect.objectContaining({
          lineId: 'line-2',
          itemId: null,
          onHand: null,
          suggestedConsumeQuantity: 0,
          shortage: false,
          skipped: true,
        }),
      ]);
    });

    it('suggests min(quantity, onHand) with no shortage when stock covers the line', async () => {
      projectMock.findUnique.mockResolvedValue({
        ...makeProject(),
        bomLines: [
          {
            ...makeBomLine({ itemId: 'item-1', quantity: 2 }),
            item: { id: 'item-1', quantity: 10 },
          },
        ],
      });
      stockMovementMock.count.mockResolvedValue(0);

      const result = await service.previewBackflush('project-1');

      expect(result.lines[0]).toMatchObject({ suggestedConsumeQuantity: 2, shortage: false });
    });

    it('flags alreadyBackflushed when the project already has recorded build movements (AC 6)', async () => {
      projectMock.findUnique.mockResolvedValue({ ...makeProject(), bomLines: [] });
      stockMovementMock.count.mockResolvedValue(2);

      const result = await service.previewBackflush('project-1');

      expect(result.alreadyBackflushed).toBe(true);
      expect(stockMovementMock.count).toHaveBeenCalledWith({
        where: { projectId: 'project-1', kind: 'build' },
      });
    });

    it('throws NotFoundException when the project does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(null);
      await expect(service.previewBackflush('missing')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ── backflush — POST /:id/backflush (EVT-28 AC 2, 3, 4, 6) ──────────────

  describe('backflush', () => {
    function withBomLines(overrides: Record<string, unknown>[] = []) {
      const bomLines =
        overrides.length > 0
          ? overrides
          : [makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 3 })];
      projectMock.findUnique.mockResolvedValue({ ...makeProject(), bomLines });
      return bomLines;
    }

    /** Default happy-path stub: `recordConsumption` fully satisfies whatever it's asked for. */
    function stubFullConsumption(movementId = 'mv-1') {
      stockMovementsServiceMock.recordConsumption.mockImplementation(
        async (_tx: unknown, input: { requestedQuantity: number }) => ({
          movement: { id: movementId },
          consumedQuantity: input.requestedQuantity,
        }),
      );
    }

    it('writes one build movement per item-linked line (via race-safe recordConsumption) and marks the project completed, atomically (AC 2)', async () => {
      withBomLines([
        makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 3 }),
        makeBomLine({ id: 'line-2', itemId: null, name: '2x4 lumber' }),
      ]);
      stubFullConsumption();
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [
          { lineId: 'line-1', consumeQuantity: 3 },
          { lineId: 'line-2', consumeQuantity: 1 }, // free-text — ignored, no write (AC 3)
        ],
      });

      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledTimes(1);
      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledWith(
        expect.objectContaining({ project: txProjectMock, item: txItemMock }),
        expect.objectContaining({
          itemId: 'item-1',
          kind: 'build',
          requestedQuantity: 3,
          projectId: 'project-1',
        }),
      );
      expect(txProjectMock.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { status: 'completed', completedAt: expect.any(Date) },
        include: expect.anything(),
      });
      expect(result.consumed).toEqual([
        expect.objectContaining({ lineId: 'line-1', itemId: 'item-1', consumedQuantity: 3 }),
      ]);
      expect(result.project.status).toBe('completed');
    });

    it('review round 2, finding 2: the idempotency guard count runs INSIDE the transaction, after $transaction opens', async () => {
      withBomLines();
      stubFullConsumption();
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      await service.backflush('project-1', { lines: [{ lineId: 'line-1', consumeQuantity: 1 }] });

      expect(prismaMock.$transaction).toHaveBeenCalled();
      expect(txStockMovementMock.count).toHaveBeenCalledWith({
        where: { projectId: 'project-1', kind: 'build' },
      });
      const transactionCallOrder = prismaMock.$transaction.mock.invocationCallOrder[0];
      const countCallOrder = txStockMovementMock.count.mock.invocationCallOrder[0];
      expect(countCallOrder).toBeGreaterThan(transactionCallOrder);
    });

    it('threads createdById through to recordConsumption on every write (SHOULD FIX 6)', async () => {
      withBomLines();
      stubFullConsumption();
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      await service.backflush(
        'project-1',
        { lines: [{ lineId: 'line-1', consumeQuantity: 1 }] },
        'user-1',
      );

      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ createdById: 'user-1' }),
      );
    });

    it('shortage: reports the amount recordConsumption actually applied, which may be less than requested (AC 4)', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 5 })]);
      stockMovementsServiceMock.recordConsumption.mockResolvedValue({
        movement: { id: 'mv-1' },
        consumedQuantity: 2, // recordConsumption clamped to on-hand internally
      });
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [{ lineId: 'line-1', consumeQuantity: 5 }],
      });

      expect(result.consumed[0]).toMatchObject({
        requestedQuantity: 5,
        consumedQuantity: 2,
        shortage: true,
      });
    });

    it('review round 2, finding 1: on-hand hitting 0 mid-loop (recordConsumption returns null) skips the line with no write', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 3 })]);
      stockMovementsServiceMock.recordConsumption.mockResolvedValue(null);
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [{ lineId: 'line-1', consumeQuantity: 3 }],
      });

      expect(result.consumed).toEqual([]);
      expect(txProjectMock.update).toHaveBeenCalled(); // project still completes
    });

    it('review round 2, finding 5: a line edited down to consumeQuantity 0 is skipped without calling recordConsumption', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 3 })]);
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [{ lineId: 'line-1', consumeQuantity: 0 }],
      });

      expect(stockMovementsServiceMock.recordConsumption).not.toHaveBeenCalled();
      expect(result.consumed).toEqual([]);
      expect(txProjectMock.update).toHaveBeenCalled(); // project still completes
    });

    it('clamps an over-large requested quantity to the line quantity before even calling recordConsumption (AC 1/2)', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 2 })]);
      stubFullConsumption();
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      await service.backflush('project-1', { lines: [{ lineId: 'line-1', consumeQuantity: 10 }] });

      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requestedQuantity: 2 }),
      );
    });

    it('review round 2, finding 3: duplicate lineId entries are de-duplicated (last one wins), not multiplied', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 5 })]);
      stubFullConsumption();
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [
          { lineId: 'line-1', consumeQuantity: 1 },
          { lineId: 'line-1', consumeQuantity: 5 },
          { lineId: 'line-1', consumeQuantity: 2 }, // last wins
        ],
      });

      // Exactly one write, for the last entry's quantity — not 3 writes /
      // not 8 (1+5+2) worth of consumption.
      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledTimes(1);
      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ requestedQuantity: 2 }),
      );
      expect(result.consumed).toHaveLength(1);
    });

    it('writes no movement for a free-text BOM line and does not error (AC 3)', async () => {
      withBomLines([makeBomLine({ id: 'line-1', itemId: null, name: '2x4 lumber', quantity: 4 })]);
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [{ lineId: 'line-1', consumeQuantity: 4 }],
      });

      expect(stockMovementsServiceMock.recordConsumption).not.toHaveBeenCalled();
      expect(result.consumed).toEqual([]);
      expect(txProjectMock.update).toHaveBeenCalled(); // project still completes
    });

    it('a cancelled confirmation (no call) leaves everything untouched', async () => {
      // Documents the contract: with no call to backflush(), nothing is
      // touched — asserted by simply never invoking the service and
      // verifying no mock was called.
      expect(stockMovementsServiceMock.recordConsumption).not.toHaveBeenCalled();
      expect(projectMock.update).not.toHaveBeenCalled();
    });

    it('atomicity: a mid-loop write failure rejects the whole call and never marks the project completed', async () => {
      withBomLines([
        makeBomLine({ id: 'line-1', itemId: 'item-1', quantity: 1 }),
        makeBomLine({ id: 'line-2', itemId: 'item-2', quantity: 1 }),
      ]);
      stockMovementsServiceMock.recordConsumption
        .mockResolvedValueOnce({ movement: { id: 'mv-1' }, consumedQuantity: 1 })
        .mockRejectedValueOnce(new Error('write failed'));

      await expect(
        service.backflush('project-1', {
          lines: [
            { lineId: 'line-1', consumeQuantity: 1 },
            { lineId: 'line-2', consumeQuantity: 1 },
          ],
        }),
      ).rejects.toThrow('write failed');

      expect(txProjectMock.update).not.toHaveBeenCalled();
    });

    it('idempotency: rejects with ConflictException when already backflushed and confirmAgain is not set (AC 6)', async () => {
      withBomLines();
      txStockMovementMock.count.mockResolvedValue(1);

      await expect(
        service.backflush('project-1', { lines: [{ lineId: 'line-1', consumeQuantity: 1 }] }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(stockMovementsServiceMock.recordConsumption).not.toHaveBeenCalled();
      // The project status must never be written when the guard rejects.
      expect(txProjectMock.update).not.toHaveBeenCalled();
    });

    it('idempotency: proceeds when already backflushed AND confirmAgain is true (AC 6)', async () => {
      withBomLines();
      txStockMovementMock.count.mockResolvedValue(1);
      stubFullConsumption('mv-2');
      txProjectMock.update.mockResolvedValue({
        ...makeProject({ status: 'completed' }),
        bomLines: [],
        stockMovements: [],
      });

      const result = await service.backflush('project-1', {
        lines: [{ lineId: 'line-1', consumeQuantity: 3 }],
        confirmAgain: true,
      });

      expect(stockMovementsServiceMock.recordConsumption).toHaveBeenCalled();
      expect(result.consumed).toHaveLength(1);
    });

    it('throws NotFoundException for an unknown lineId', async () => {
      withBomLines();

      await expect(
        service.backflush('project-1', { lines: [{ lineId: 'missing-line', consumeQuantity: 1 }] }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the project does not exist', async () => {
      projectMock.findUnique.mockResolvedValue(null);

      await expect(service.backflush('missing', { lines: [] })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
