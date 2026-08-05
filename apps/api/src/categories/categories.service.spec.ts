import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CategoriesService, slugify } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrismaMock() {
  return {
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
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
    it('returns categories ordered by path', async () => {
      const rows = [
        { id: 'id-1', name: 'Power Tools', path: 'power-tools', parentId: null },
        { id: 'id-2', name: 'Drills', path: 'power-tools.drills', parentId: 'id-1' },
      ];
      prismaMock.category.findMany.mockResolvedValue(rows);

      const result = await service.findAll();
      expect(result).toEqual(rows);
      expect(prismaMock.category.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { path: 'asc' } }),
      );
    });

    it('returns an empty array when no categories exist', async () => {
      prismaMock.category.findMany.mockResolvedValue([]);
      expect(await service.findAll()).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // create — root category
  // -------------------------------------------------------------------------

  describe('create — root category', () => {
    it('creates a root category with slugified name as path', async () => {
      const created = { id: 'root-id', name: 'Hand Tools', path: 'hand-tools', parentId: null };
      prismaMock.category.create.mockResolvedValue(created);

      const result = await service.create({ name: 'Hand Tools' });

      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Hand Tools', path: 'hand-tools', parentId: null },
        }),
      );
      expect(result).toEqual(created);
    });

    it('treats null parentId the same as omitted (root category)', async () => {
      const created = { id: 'root-id', name: 'Fasteners', path: 'fasteners', parentId: null };
      prismaMock.category.create.mockResolvedValue(created);

      await service.create({ name: 'Fasteners', parentId: null });

      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Fasteners', path: 'fasteners', parentId: null },
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // create — child category (path composition)
  // -------------------------------------------------------------------------

  describe('create — child category (path composition)', () => {
    it('composes path as parent.path + "." + slug', async () => {
      prismaMock.category.findUnique.mockResolvedValue({
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

      const result = await service.create({ name: 'Drills', parentId: 'parent-id' });

      expect(prismaMock.category.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { name: 'Drills', path: 'power-tools.drills', parentId: 'parent-id' },
        }),
      );
      expect(result.path).toBe('power-tools.drills');
    });

    it('composes a deep nested path correctly', async () => {
      prismaMock.category.findUnique.mockResolvedValue({
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

      const result = await service.create({ name: 'Cordless Drills', parentId: 'grand-id' });
      expect(result.path).toBe('power-tools.drills.cordless-drills');
    });
  });

  // -------------------------------------------------------------------------
  // create — duplicate sibling rejection (AC 1)
  // -------------------------------------------------------------------------

  describe('create — duplicate sibling rejection', () => {
    it('throws ConflictException when path already exists (P2002)', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null); // no parent → root
      prismaMock.category.create.mockRejectedValue(makeP2002Error());

      await expect(service.create({ name: 'Hand Tools' })).rejects.toThrow(ConflictException);
    });

    it('includes the conflicting path in the ConflictException message', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      prismaMock.category.create.mockRejectedValue(makeP2002Error());

      await expect(service.create({ name: 'Hand Tools' })).rejects.toThrow(/hand-tools/);
    });

    it('re-throws non-unique-constraint Prisma errors unchanged', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      const otherErr = new Prisma.PrismaClientKnownRequestError('Not found', {
        code: 'P2025',
        clientVersion: '5.22.0',
      });
      prismaMock.category.create.mockRejectedValue(otherErr);

      await expect(service.create({ name: 'Widgets' })).rejects.toThrow(otherErr);
    });

    it('re-throws generic (non-Prisma) errors unchanged', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);
      const genericErr = new Error('network failure');
      prismaMock.category.create.mockRejectedValue(genericErr);

      await expect(service.create({ name: 'Widgets' })).rejects.toThrow(genericErr);
    });
  });

  // -------------------------------------------------------------------------
  // create — unknown parentId
  // -------------------------------------------------------------------------

  describe('create — unknown parentId', () => {
    it('throws NotFoundException when parentId does not exist', async () => {
      prismaMock.category.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ name: 'Drills', parentId: 'nonexistent-uuid' }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
