import { Test, TestingModule } from '@nestjs/testing';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

describe('TagsController', () => {
  let controller: TagsController;
  let service: TagsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TagsController],
      providers: [
        {
          provide: TagsService,
          useValue: { findAll: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<TagsController>(TagsController);
    service = module.get<TagsService>(TagsService);
  });

  describe('findAll', () => {
    it('delegates to TagsService.findAll and returns the result', async () => {
      const expected = [
        { id: '1', name: 'drill', color: null, itemCount: 5 },
        { id: '2', name: 'battery', color: null, itemCount: 2 },
      ];
      (service.findAll as jest.Mock).mockResolvedValue(expected);

      const result = await controller.findAll();
      expect(result).toBe(expected);
      expect(service.findAll).toHaveBeenCalledTimes(1);
    });

    it('returns an empty array when no tags exist', async () => {
      (service.findAll as jest.Mock).mockResolvedValue([]);
      expect(await controller.findAll()).toEqual([]);
    });
  });
});
