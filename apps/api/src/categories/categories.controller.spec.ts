import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

const WORKSPACE = { id: 'workspace-1', role: 'owner' } as never;

describe('CategoriesController', () => {
  let controller: CategoriesController;
  let service: CategoriesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoriesController],
      providers: [
        {
          provide: CategoriesService,
          useValue: { findAll: jest.fn(), create: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<CategoriesController>(CategoriesController);
    service = module.get<CategoriesService>(CategoriesService);
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------

  describe('findAll', () => {
    it('delegates to CategoriesService.findAll with the caller workspace and returns the result', async () => {
      const rows = [{ id: '1', name: 'Power Tools', path: 'power-tools', parentId: null }];
      (service.findAll as jest.Mock).mockResolvedValue(rows);

      const result = await controller.findAll(WORKSPACE);
      expect(result).toBe(rows);
      expect(service.findAll).toHaveBeenCalledWith('workspace-1');
    });

    it('returns an empty array when no categories exist', async () => {
      (service.findAll as jest.Mock).mockResolvedValue([]);
      expect(await controller.findAll(WORKSPACE)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------

  describe('create', () => {
    it('delegates to CategoriesService.create with the caller workspace and returns the new row', async () => {
      const dto = { name: 'Hand Tools' };
      const created = { id: 'new-id', name: 'Hand Tools', path: 'hand-tools', parentId: null };
      (service.create as jest.Mock).mockResolvedValue(created);

      const result = await controller.create(dto, WORKSPACE);
      expect(result).toBe(created);
      expect(service.create).toHaveBeenCalledWith(dto, 'workspace-1');
    });

    it('propagates ConflictException from the service', async () => {
      (service.create as jest.Mock).mockRejectedValue(new ConflictException('duplicate'));
      await expect(controller.create({ name: 'Duplicate' }, WORKSPACE)).rejects.toThrow(
        ConflictException,
      );
    });

    it('propagates NotFoundException from the service', async () => {
      (service.create as jest.Mock).mockRejectedValue(new NotFoundException('not found'));
      await expect(
        controller.create({ name: 'Child', parentId: 'bad-id' }, WORKSPACE),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
