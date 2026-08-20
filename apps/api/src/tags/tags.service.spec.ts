import { Test, TestingModule } from '@nestjs/testing';
import { TagsService } from './tags.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = '99999999-9999-9999-9999-999999999999';

function makePrismaMock() {
  return {
    tag: {
      findMany: jest.fn(),
      upsert: jest.fn(),
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
  // upsertByName (EVT-40: scoped to the caller's workspace, not always Default)
  // -------------------------------------------------------------------------

  describe('upsertByName', () => {
    it('creates a new tag scoped to the given workspace when the name does not exist', async () => {
      const created = { id: 'new-id', name: 'cordless', color: null };
      prismaMock.tag.upsert.mockResolvedValue(created);

      const result = await service.upsertByName('cordless', WORKSPACE_ID);

      expect(prismaMock.tag.upsert).toHaveBeenCalledWith({
        where: { workspaceId_name: { workspaceId: WORKSPACE_ID, name: 'cordless' } },
        update: {},
        create: { name: 'cordless', workspaceId: WORKSPACE_ID },
      });
      expect(result).toEqual(created);
    });

    it('returns the existing tag when the name already exists in that workspace', async () => {
      const existing = { id: 'existing-id', name: 'drill', color: null };
      prismaMock.tag.upsert.mockResolvedValue(existing);

      const result = await service.upsertByName('drill', WORKSPACE_ID);
      expect(result).toEqual(existing);
    });

    it('scopes the compound where by workspace — two different workspace ids produce different where clauses', async () => {
      const OTHER_WORKSPACE_ID = '88888888-8888-8888-8888-888888888888';
      prismaMock.tag.upsert.mockResolvedValue({ id: 'id-1', name: 'drill-bit', color: null });

      await service.upsertByName('drill-bit', WORKSPACE_ID);
      await service.upsertByName('drill-bit', OTHER_WORKSPACE_ID);

      expect(prismaMock.tag.upsert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { workspaceId_name: { workspaceId: WORKSPACE_ID, name: 'drill-bit' } },
        }),
      );
      expect(prismaMock.tag.upsert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { workspaceId_name: { workspaceId: OTHER_WORKSPACE_ID, name: 'drill-bit' } },
        }),
      );
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

      const ids = await service.upsertMany(['a', 'b'], WORKSPACE_ID);
      expect(ids).toEqual(['id-a', 'id-b']);
    });

    it('returns an empty array for an empty input', async () => {
      expect(await service.upsertMany([], WORKSPACE_ID)).toEqual([]);
    });

    it('deduplication: upsertByName called once per name', async () => {
      prismaMock.tag.upsert.mockResolvedValue({ id: 'id-x', name: 'x', color: null });

      await service.upsertMany(['x', 'x'], WORKSPACE_ID);
      // Called twice (Promise.all over input array — dedup is the caller's responsibility)
      expect(prismaMock.tag.upsert).toHaveBeenCalledTimes(2);
    });

    it('passes the same workspaceId to every upsertByName call', async () => {
      prismaMock.tag.upsert.mockResolvedValue({ id: 'id-x', name: 'x', color: null });

      await service.upsertMany(['a', 'b'], WORKSPACE_ID);

      for (const call of prismaMock.tag.upsert.mock.calls) {
        expect(call[0].where.workspaceId_name.workspaceId).toBe(WORKSPACE_ID);
      }
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
      await service.upsertByName('multimeter', WORKSPACE_ID);

      // Step 2: subsequent findAll picks up the new tag (DB now has it)
      prismaMock.tag.findMany.mockResolvedValue([{ ...newTag, _count: { items: 1 } }]);

      const tags = await service.findAll();
      expect(tags).toContainEqual({ id: 'tag-new', name: 'multimeter', color: null, itemCount: 1 });
    });
  });
});
