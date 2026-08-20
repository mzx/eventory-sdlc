import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CategoriesService, slugify } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'workspace-1';
const OTHER_WORKSPACE_ID = 'workspace-2';

function makePrismaMock() {
  return {
    category: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  };
}

function makeP2002Error() {
  const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
  });
  return err;
}

// ---------------------------------------------------------------------------
// slugify unit tests
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it.each([
    ['Hand Tools', 'hand-tools'],
    ['West Wall / Cabinet #3', 'west-wall-cabinet-3'],
    ['18V Batteries & Chargers', '18v-batteries-chargers'],
    ['  leading trailing  ', 'leading-trailing'],
    ['already-slug', 'already-slug'],
    ['UPPER CASE', 'upper-case'],
  ])('slugify(%s) → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// slugify — empty-slug edge cases
// ---------------------------------------------------------------------------

describe('slugify — empty result edge cases', () => {
  it('returns empty string for a name composed entirely of special characters', () => {
    expect(slugify('!!!')).toBe('');
    expect(slugify('@@@')).toBe('');
    expect(slugify('---')).toBe('');
    expect(slugify('...')).toBe('');
  });

  it('returns empty string for a blank name', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// CategoriesService unit tests
// ---------------------------------------------------------------------------

describe('CategoriesService', () => {
  let service: CategoriesService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriesService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<CategoriesService>(CategoriesService);
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('returns categories ordered by path, scoped to workspaceId (EVT-41)', async () => {
      const rows = [
        { id: 'id-1', name: 'Power Tools', path: 'power-tools', parentId: null },
        { id: 'id-2', name: 'Drills', path: 'power-tools.drills', parentId: 'id-1' },
      ];
      prismaMock.category.findMany.mockResolvedValue(rows);

      const result = await service.findAll(WORKSPACE_ID);
      expect(result).toEqual(rows);
      expect(prismaMock.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: WORKSPACE_ID }, orderBy: { path: 'asc' } }),
      );
    });

    it('returns an empty array when no categories exist', async () => {
      prismaMock.category.findMany.mockResolvedValue([]);
      expect(await service.findAll(WORKSPACE_ID)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // create — root category
  // -------------------------------------------------------------------------

  describe('create — root category', () => {
    it('creates a root category with slugified name as path, stamped with workspaceId', async () => {
      const created = { id: 'root-id', name: 'Hand Tools', path: 'hand-tools', parentId: null };
      prismaMock.category.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Hand Tools' }, WORKSPACE_ID);

      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Hand Tools',
            path: 'hand-tools',
            parentId: null,
            workspaceId: WORKSPACE_ID,
          },
        }),
      );
      expect(result).toEqual(created);
    });

    it('treats null parentId the same as omitted (root category)', async () => {
      const created = { id: 'root-id', name: 'Fasteners', path: 'fasteners', parentId: null };
      prismaMock.category.create.mockResolvedValue(created);

      await service.create({ name: 'Fasteners', parentId: null }, WORKSPACE_ID);

      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Fasteners',
            path: 'fasteners',
            parentId: null,
            workspaceId: WORKSPACE_ID,
          },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // create — child category (path composition)
  // -------------------------------------------------------------------------

  describe('create — child category (path composition)', () => {
    it('composes path as parent.path + "." + slug, looking up the parent scoped to workspaceId', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'parent-id',
        name: 'Power Tools',
        path: 'power-tools',
        parentId: null,
      });
      const created = {
        id: 'child-id',
        name: 'Drills',
        path: 'power-tools.drills',
        parentId: 'parent-id',
      };
      prismaMock.category.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Drills', parentId: 'parent-id' }, WORKSPACE_ID);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'parent-id', workspaceId: WORKSPACE_ID },
      });
      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            name: 'Drills',
            path: 'power-tools.drills',
            parentId: 'parent-id',
            workspaceId: WORKSPACE_ID,
          },
        }),
      );
      expect(result.path).toBe('power-tools.drills');
    });

    it('composes a deep nested path correctly', async () => {
      prismaMock.category.findFirst.mockResolvedValue({
        id: 'grand-id',
        name: 'Drills',
        path: 'power-tools.drills',
        parentId: 'parent-id',
      });
      const created = {
        id: 'great-id',
        name: 'Cordless Drills',
        path: 'power-tools.drills.cordless-drills',
        parentId: 'grand-id',
      };
      prismaMock.category.create.mockResolvedValue(created);

      const result = await service.create(
        { name: 'Cordless Drills', parentId: 'grand-id' },
        WORKSPACE_ID,
      );
      expect(result.path).toBe('power-tools.drills.cordless-drills');
    });
  });

  // -------------------------------------------------------------------------
  // create — empty-slug guard (defence in depth for names like "!!!")
  // -------------------------------------------------------------------------

  describe('create — empty-slug guard', () => {
    it('throws BadRequestException when name slugifies to empty string (e.g., "!!!")', async () => {
      await expect(service.create({ name: '!!!' }, WORKSPACE_ID)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('includes the offending name in the BadRequestException message', async () => {
      await expect(service.create({ name: '@@@' }, WORKSPACE_ID)).rejects.toThrow(/@@@/);
    });

    it('does NOT call prisma.create when slug is empty', async () => {
      await expect(service.create({ name: '---' }, WORKSPACE_ID)).rejects.toThrow(
        BadRequestException,
      );
      expect(prismaMock.category.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for blank-string name', async () => {
      await expect(service.create({ name: '   ' }, WORKSPACE_ID)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // -------------------------------------------------------------------------
  // create — duplicate sibling rejection (AC 1)
  // -------------------------------------------------------------------------

  describe('create — duplicate sibling rejection', () => {
    it('throws ConflictException when path already exists (P2002)', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null); // no parent → root
      prismaMock.category.create.mockRejectedValue(makeP2002Error());

      await expect(service.create({ name: 'Hand Tools' }, WORKSPACE_ID)).rejects.toThrow(
        ConflictException,
      );
    });

    it('includes the conflicting path in the ConflictException message', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);
      prismaMock.category.create.mockRejectedValue(makeP2002Error());

      await expect(service.create({ name: 'Hand Tools' }, WORKSPACE_ID)).rejects.toThrow(
        /hand-tools/,
      );
    });

    it('re-throws non-unique-constraint Prisma errors unchanged', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);
      const otherErr = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.22.0',
      });
      prismaMock.category.create.mockRejectedValue(otherErr);

      await expect(service.create({ name: 'Widgets' }, WORKSPACE_ID)).rejects.toThrow(otherErr);
    });

    it('re-throws generic (non-Prisma) errors unchanged', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);
      const genericErr = new Error('network failure');
      prismaMock.category.create.mockRejectedValue(genericErr);

      await expect(service.create({ name: 'Widgets' }, WORKSPACE_ID)).rejects.toThrow(genericErr);
    });
  });

  // -------------------------------------------------------------------------
  // create — unknown parentId
  // -------------------------------------------------------------------------

  describe('create — unknown parentId', () => {
    it('throws NotFoundException when parentId does not exist', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Drills', parentId: 'nonexistent-uuid' }, WORKSPACE_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('EVT-41: throws NotFoundException (not distinguished from unknown) when parentId belongs to a different workspace', async () => {
      // The mock simulates the workspace-scoped findFirst finding nothing —
      // exactly the same behavior as a genuinely unknown parentId, proving
      // the two are indistinguishable from the caller's perspective.
      prismaMock.category.findFirst.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Drills', parentId: 'foreign-parent-id' }, WORKSPACE_ID),
      ).rejects.toThrow(NotFoundException);
      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-parent-id', workspaceId: WORKSPACE_ID },
      });
    });
  });

  // -------------------------------------------------------------------------
  // EVT-41: workspace isolation — the same slug/path may exist independently
  // in two different workspaces (per-workspace `@@unique([workspaceId, path])`).
  // -------------------------------------------------------------------------

  describe('EVT-41: cross-workspace independence', () => {
    it('does not consider a different workspace when looking up parentId', async () => {
      prismaMock.category.findFirst.mockResolvedValue(null);

      await service
        .create({ name: 'Drills', parentId: 'parent-in-other-workspace' }, OTHER_WORKSPACE_ID)
        .catch(() => undefined);

      expect(prismaMock.category.findFirst).toHaveBeenCalledWith({
        where: { id: 'parent-in-other-workspace', workspaceId: OTHER_WORKSPACE_ID },
      });
    });
  });
});
