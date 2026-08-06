import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

  const prismaMock = {
    project: projectMock,
    bomLine: bomLineMock,
    item: itemMock,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [ProjectsService, { provide: PrismaService, useValue: prismaMock }],
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
});
