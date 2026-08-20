import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_WORKSPACE_ID,
  __resetDefaultWorkspaceCacheForTests,
} from '../workspace/default-workspace';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal PrismaService double with the tag model mocked plus `workspace`
 * (EVT-39) — `upsertByName` resolves the Default Workspace's id before
 * building its compound `where`, see `default-workspace.ts`.
 */
function makePrismaMock() {
  return {
    tag: {
      findMany: jest.fn(),
      upsert: jest.fn(),
    },
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DEFAULT_WORKSPACE_ID }),
    },
  };
}

// ---------------------------------------------------------------------------
// TagsService unit tests
// ---------------------------------------------------------------------------

describe('TagsService', () => {
  let service: TagsService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    // The default-workspace lookup caches its result at module scope
    // (EVT-39) — reset it so each test starts from the same "not yet
    // resolved" state and genuinely exercises `workspace.findUniqueOrThrow`.
    __resetDefaultWorkspaceCacheForTests();
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [TagsService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<TagsService>(TagsService);
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('maps Prisma rows to TagWithCount shape', async () => {
      prismaMock.tag.findMany.mockResolvedValue([
        { id: 'id-1', name: 'power-tool', color: null, _count: { items: 3 } },
        { id: 'id-2', name: 'hand-tool', color: '#ff0000', _count: { items: 1 } },
      ]);

      const result = await service.findAll();

      expect(result).toEqual([
        { id: 'id-1', name: 'power-tool', color: null, itemCount: 3 },
        { id: 'id-2', name: 'hand-tool', color: '#ff0000', itemCount: 1 },
      ]);
    });

    it('passes the correct orderBy to Prisma (count desc, then name asc)', async () => {
      prismaMock.tag.findMany.mockResolvedValue([]);

      await service.findAll();

      expect(prismaMock.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ items: { _count: 'desc' } }, { name: 'asc' }],
        }),
      );
    });

    it('reflects correct counts — simulates tag/untag lifecycle', async () => {
      // After tagging two items with "drill" and one item with "battery"
      prismaMock.tag.findMany.mockResolvedValue([
        { id: 'id-drill', name: 'drill', color: null, _count: { items: 2 } },
        { id: 'id-battery', name: 'battery', color: null, _count: { items: 1 } },
      ]);

      const afterTagging = await service.findAll();
      expect(afterTagging[0]).toEqual({ id: 'id-drill', name: 'drill', color: null, itemCount: 2 });
      expect(afterTagging[1]).toEqual({
        id: 'id-battery',
        name: 'battery',
        color: null,
        itemCount: 1,
      });

      // After untagging one item from "drill"
      prismaMock.tag.findMany.mockResolvedValue([
        { id: 'id-battery', name: 'battery', color: null, _count: { items: 1 } },
        { id: 'id-drill', name: 'drill', color: null, _count: { items: 1 } },
      ]);

      const afterUntagging = await service.findAll();
      expect(afterUntagging[0].itemCount).toBe(1);
      expect(afterUntagging[1].itemCount).toBe(1);
    });

    it('returns an empty array when no tags exist', async () => {
      prismaMock.tag.findMany.mockResolvedValue([]);
      expect(await service.findAll()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // upsertByName
  // -------------------------------------------------------------------------

  describe('upsertByName', () => {
    it('creates a new tag when the name does not exist', async () => {
      const created = { id: 'new-id', name: 'cordless', color: null };
      prismaMock.tag.upsert.mockResolvedValue(created);

      const result = await service.upsertByName('cordless');

      expect(prismaMock.tag.upsert).toHaveBeenCalledWith({
        where: { workspaceId_name: { workspaceId: DEFAULT_WORKSPACE_ID, name: 'cordless' } },
        update: {},
        create: { name: 'cordless' },
      });
      expect(result).toEqual(created);
    });

    it('returns the existing tag when the name already exists', async () => {
      const existing = { id: 'existing-id', name: 'drill', color: null };
      prismaMock.tag.upsert.mockResolvedValue(existing);

      const result = await service.upsertByName('drill');
      expect(result).toEqual(existing);
    });

    it('resolves the default workspace id once and caches it across calls (EVT-39)', async () => {
      prismaMock.tag.upsert
        .mockResolvedValueOnce({ id: 'id-1', name: 'a', color: null })
        .mockResolvedValueOnce({ id: 'id-2', name: 'b', color: null });

      await service.upsertByName('a');
      await service.upsertByName('b');

      // Two upserts, but only a single `workspace.findUniqueOrThrow` round-trip
      // — the module-level cache serves the second call.
      expect(prismaMock.tag.upsert).toHaveBeenCalledTimes(2);
      expect(prismaMock.workspace.findUniqueOrThrow).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // upsertMany
  // -------------------------------------------------------------------------

  describe('upsertMany', () => {
    it('returns tag IDs in the same order as the input names', async () => {
      prismaMock.tag.upsert
        .mockResolvedValueOnce({ id: 'id-a', name: 'a', color: null })
        .mockResolvedValueOnce({ id: 'id-b', name: 'b', color: null });

      const ids = await service.upsertMany(['a', 'b']);
      expect(ids).toEqual(['id-a', 'id-b']);
    });

    it('returns an empty array for an empty input', async () => {
      expect(await service.upsertMany([])).toEqual([]);
    });

    it('deduplication: upsertByName called once per name', async () => {
      prismaMock.tag.upsert.mockResolvedValue({ id: 'id-x', name: 'x', color: null });

      await service.upsertMany(['x', 'x']);
      // Called twice (Promise.all over input array — dedup is the caller's responsibility)
      expect(prismaMock.tag.upsert).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // EVT-3 flow: new tag created via upsertByName appears in findAll (AC 2)
  // -------------------------------------------------------------------------

  describe('EVT-3 flow — new tag appears in GET /api/tags', () => {
    it('tag created by upsertByName is returned by findAll', async () => {
      // Step 1: item create uses upsertByName → tag row inserted
      const newTag = { id: 'tag-new', name: 'multimeter', color: null };
      prismaMock.tag.upsert.mockResolvedValue(newTag);
      await service.upsertByName('multimeter');

      // Step 2: subsequent findAll picks up the new tag (DB now has it)
      prismaMock.tag.findMany.mockResolvedValue([{ ...newTag, _count: { items: 1 } }]);

      const tags = await service.findAll();
      expect(tags).toContainEqual({ id: 'tag-new', name: 'multimeter', color: null, itemCount: 1 });
    });
  });
});
