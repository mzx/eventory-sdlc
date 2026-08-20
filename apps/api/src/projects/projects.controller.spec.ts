import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsController } from './projects.controller';
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
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lineCount: 0,
    ...overrides,
  };
}

const CURRENT_USER = { id: 'user-1' } as never;
const WORKSPACE = { id: 'workspace-1', role: 'owner' } as never;

function makeBomLine(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'line-1',
    projectId: 'project-1',
    itemId: null,
    name: '2x4 lumber',
    quantity: 4,
    unit: 'pcs',
    notes: null,
    picked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    item: null,
    ...overrides,
  };
}

// ─── ProjectsController unit tests ─────────────────────────────────────────

describe('ProjectsController', () => {
  let controller: ProjectsController;

  const serviceMock = {
    list: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addBomLine: jest.fn(),
    updateBomLine: jest.fn(),
    removeBomLine: jest.fn(),
    availability: jest.fn(),
    previewBackflush: jest.fn(),
    backflush: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [{ provide: ProjectsService, useValue: serviceMock }],
    }).compile();

    controller = module.get<ProjectsController>(ProjectsController);
  });

  // ── list ──────────────────────────────────────────────────────────────────

  describe('GET /projects (list)', () => {
    it('delegates to ProjectsService.list with the query and caller workspace', async () => {
      const projects = [makeProject(), makeProject({ id: 'project-2' })];
      serviceMock.list.mockResolvedValue(projects);

      const result = await controller.list({}, WORKSPACE);

      expect(serviceMock.list).toHaveBeenCalledWith({}, 'workspace-1');
      expect(result).toBe(projects);
    });

    it('passes the status filter through', async () => {
      serviceMock.list.mockResolvedValue([]);

      await controller.list({ status: 'in_progress' as never }, WORKSPACE);

      expect(serviceMock.list).toHaveBeenCalledWith({ status: 'in_progress' }, 'workspace-1');
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe('GET /projects/:id (findOne)', () => {
    it('delegates to ProjectsService.findOne with the id and caller workspace', async () => {
      const detail = { ...makeProject(), bomLines: [makeBomLine()] };
      serviceMock.findOne.mockResolvedValue(detail);

      const result = await controller.findOne('project-1', WORKSPACE);

      expect(serviceMock.findOne).toHaveBeenCalledWith('project-1', 'workspace-1');
      expect(result).toBe(detail);
    });
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe('POST /projects (create)', () => {
    it('delegates to ProjectsService.create with the body and caller workspace', async () => {
      const body = { name: 'Garage workbench' };
      const created = makeProject();
      serviceMock.create.mockResolvedValue(created);

      const result = await controller.create(body, WORKSPACE);

      expect(serviceMock.create).toHaveBeenCalledWith(body, 'workspace-1');
      expect(result).toBe(created);
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe('PATCH /projects/:id (update)', () => {
    it('delegates to ProjectsService.update with id, body, and caller workspace', async () => {
      const body = { status: 'in_progress' as never };
      const updated = makeProject({ status: 'in_progress' });
      serviceMock.update.mockResolvedValue(updated);

      const result = await controller.update('project-1', body, WORKSPACE);

      expect(serviceMock.update).toHaveBeenCalledWith('project-1', body, 'workspace-1');
      expect(result).toBe(updated);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe('DELETE /projects/:id (remove)', () => {
    it('delegates to ProjectsService.remove with the caller workspace and returns void', async () => {
      serviceMock.remove.mockResolvedValue(undefined);

      await controller.remove('project-1', WORKSPACE);

      expect(serviceMock.remove).toHaveBeenCalledWith('project-1', 'workspace-1');
    });
  });

  // ── addBomLine ───────────────────────────────────────────────────────────

  describe('POST /projects/:id/bom (addBomLine)', () => {
    it('delegates to ProjectsService.addBomLine with id, body, and caller workspace', async () => {
      const body = { itemId: 'item-1' };
      const created = makeBomLine();
      serviceMock.addBomLine.mockResolvedValue(created);

      const result = await controller.addBomLine('project-1', body, WORKSPACE);

      expect(serviceMock.addBomLine).toHaveBeenCalledWith('project-1', body, 'workspace-1');
      expect(result).toBe(created);
    });
  });

  // ── updateBomLine ────────────────────────────────────────────────────────

  describe('PATCH /projects/:id/bom/:lineId (updateBomLine)', () => {
    it('delegates to ProjectsService.updateBomLine with id, lineId, body, and caller workspace', async () => {
      const body = { quantity: 6 };
      const updated = makeBomLine({ quantity: 6 });
      serviceMock.updateBomLine.mockResolvedValue(updated);

      const result = await controller.updateBomLine('project-1', 'line-1', body, WORKSPACE);

      expect(serviceMock.updateBomLine).toHaveBeenCalledWith(
        'project-1',
        'line-1',
        body,
        'workspace-1',
      );
      expect(result).toBe(updated);
    });
  });

  // ── removeBomLine ────────────────────────────────────────────────────────

  describe('DELETE /projects/:id/bom/:lineId (removeBomLine)', () => {
    it('delegates to ProjectsService.removeBomLine with the caller workspace and returns void', async () => {
      serviceMock.removeBomLine.mockResolvedValue(undefined);

      await controller.removeBomLine('project-1', 'line-1', WORKSPACE);

      expect(serviceMock.removeBomLine).toHaveBeenCalledWith('project-1', 'line-1', 'workspace-1');
    });
  });

  // ── availability (EVT-29) ────────────────────────────────────────────────

  describe('GET /projects/:id/availability (availability)', () => {
    it('delegates to ProjectsService.availability with the id and caller workspace', async () => {
      const availability = {
        projectId: 'project-1',
        asOf: '2026-08-13T00:00:00.000Z',
        clearToBuild: true,
        counts: { ok: 0, short: 0, untracked: 0 },
        lines: [],
      };
      serviceMock.availability.mockResolvedValue(availability);

      const result = await controller.availability('project-1', WORKSPACE);

      expect(serviceMock.availability).toHaveBeenCalledWith('project-1', 'workspace-1');
      expect(result).toBe(availability);
    });
  });

  // ── previewBackflush (EVT-28) ────────────────────────────────────────────

  describe('GET /projects/:id/backflush-preview (previewBackflush)', () => {
    it('delegates to ProjectsService.previewBackflush with the id and caller workspace', async () => {
      const preview = { projectId: 'project-1', alreadyBackflushed: false, lines: [] };
      serviceMock.previewBackflush.mockResolvedValue(preview);

      const result = await controller.previewBackflush('project-1', WORKSPACE);

      expect(serviceMock.previewBackflush).toHaveBeenCalledWith('project-1', 'workspace-1');
      expect(result).toBe(preview);
    });
  });

  // ── backflush (EVT-28) ───────────────────────────────────────────────────

  describe('POST /projects/:id/backflush (backflush)', () => {
    it('delegates to ProjectsService.backflush with id, body, caller workspace, and the current user id (SHOULD FIX 6)', async () => {
      const body = { lines: [{ lineId: 'line-1', consumeQuantity: 2 }] };
      const response = { project: makeProject({ status: 'completed' }), consumed: [] };
      serviceMock.backflush.mockResolvedValue(response);

      const result = await controller.backflush('project-1', body, CURRENT_USER, WORKSPACE);

      expect(serviceMock.backflush).toHaveBeenCalledWith(
        'project-1',
        body,
        'workspace-1',
        'user-1',
      );
      expect(result).toBe(response);
    });
  });
});
