import {
  BadRequestException,
  NotFoundException,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { uploadThrottlerConfig } from '../common/throttle.config';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CreateItemDto } from './create-item.dto';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';
import { ReceiveItemDto } from './receive-item.dto';
import { UpdateItemDto } from './update-item.dto';
import { ConsumeItemDto, CountItemDto } from './verification.dto';

// `@nestjs/throttler`'s `@Throttle()` decorator stashes its config under
// these Reflect metadata keys — see the same pattern in
// `photos.controller.spec.ts`.
const THROTTLER_LIMIT_METADATA_KEY = 'THROTTLER:LIMIT';
const THROTTLER_TTL_METADATA_KEY = 'THROTTLER:TTL';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';
/** Minimal `AuthenticatedUser` stand-in — only `.id` is read by the controller. */
const CURRENT_USER = { id: USER_ID } as never;
/** `@CurrentWorkspace()` resolves this shape (EVT-40) — see workspace-context.ts. */
const CURRENT_WORKSPACE = { id: WORKSPACE_ID, role: 'member' } as never;

function makeItemServiceMock() {
  return {
    list: jest.fn(),
    findById: jest.fn(),
    findByQr: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    searchByPhoto: jest.fn(),
    receive: jest.fn(),
    count: jest.fn(),
    consume: jest.fn(),
    listVerificationQueue: jest.fn(),
  };
}

function makeStockMovementsServiceMock() {
  return {
    listForItem: jest.fn(),
  };
}

function makeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1024,
    buffer: Buffer.from('fake-image-bytes'),
    stream: undefined as unknown as Express.Multer.File['stream'],
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemsController', () => {
  let controller: ItemsController;
  let service: ReturnType<typeof makeItemServiceMock>;
  let stockMovementsService: ReturnType<typeof makeStockMovementsServiceMock>;

  beforeEach(async () => {
    service = makeItemServiceMock();
    stockMovementsService = makeStockMovementsServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ItemsController],
      providers: [
        { provide: ItemsService, useValue: service },
        { provide: StockMovementsService, useValue: stockMovementsService },
      ],
    }).compile();

    controller = module.get<ItemsController>(ItemsController);
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('delegates to ItemsService.list and returns results', async () => {
      const rows = [{ id: ITEM_ID, name: 'Drill' }];
      service.list.mockResolvedValue(rows);

      const result = await controller.list({}, CURRENT_WORKSPACE);
      expect(result).toBe(rows);
      expect(service.list).toHaveBeenCalledWith({}, WORKSPACE_ID);
    });

    it('passes query params to service', async () => {
      service.list.mockResolvedValue([]);
      await controller.list(
        { search: 'drill', tag: 'power-tool', locationId: ITEM_ID },
        CURRENT_WORKSPACE,
      );
      expect(service.list).toHaveBeenCalledWith(
        {
          search: 'drill',
          tag: 'power-tool',
          locationId: ITEM_ID,
        },
        WORKSPACE_ID,
      );
    });

    it('returns empty array when no items match', async () => {
      service.list.mockResolvedValue([]);
      expect(await controller.list({}, CURRENT_WORKSPACE)).toEqual([]);
    });
  });

  // =========================================================================
  // findByQr — EVT-40 AC 4: scoped by the CALLER's membership, not the
  // current workspace context, so this deliberately passes `user.id` only.
  // =========================================================================

  describe('findByQr', () => {
    it('returns item result for an item QR token', async () => {
      const result = { kind: 'item' as const, item: { id: ITEM_ID, name: 'Drill' } };
      service.findByQr.mockResolvedValue(result);

      expect(await controller.findByQr('some-token', CURRENT_USER)).toBe(result);
      expect(service.findByQr).toHaveBeenCalledWith('some-token', USER_ID);
    });

    it('returns location result for a location QR token', async () => {
      const result = { kind: 'location' as const, location: { id: 'loc-id', name: 'Garage' } };
      service.findByQr.mockResolvedValue(result);

      expect(await controller.findByQr('loc-token', CURRENT_USER)).toBe(result);
    });

    it('propagates NotFoundException from service (unknown QR token)', async () => {
      service.findByQr.mockRejectedValue(new NotFoundException('not found'));
      await expect(controller.findByQr('unknown', CURRENT_USER)).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('delegates to ItemsService.findById and returns the item', async () => {
      const item = { id: ITEM_ID };
      service.findById.mockResolvedValue(item);

      expect(await controller.findById(ITEM_ID, CURRENT_WORKSPACE)).toBe(item);
      expect(service.findById).toHaveBeenCalledWith(ITEM_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.findById.mockRejectedValue(new NotFoundException());
      await expect(controller.findById(ITEM_ID, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // searchByPhoto (EVT-17)
  // =========================================================================

  describe('searchByPhoto', () => {
    it('delegates to ItemsService.searchByPhoto with the file buffer, mimetype, and workspace', async () => {
      const file = makeMulterFile();
      const result = {
        analysis: { suggested_name: 'M4 hex bolt', tags: [], search_keywords: [] },
        matches: [{ id: ITEM_ID }],
      };
      service.searchByPhoto.mockResolvedValue(result);

      const response = await controller.searchByPhoto(file, CURRENT_WORKSPACE);

      expect(response).toBe(result);
      expect(service.searchByPhoto).toHaveBeenCalledWith(file.buffer, file.mimetype, WORKSPACE_ID);
    });

    it('throws BadRequestException when no file is present (multer rejected it)', () => {
      expect(() =>
        controller.searchByPhoto(undefined as unknown as Express.Multer.File, CURRENT_WORKSPACE),
      ).toThrow(BadRequestException);
      expect(service.searchByPhoto).not.toHaveBeenCalled();
    });

    it('carries the stricter upload throttle config from @Throttle metadata', () => {
      const expected = uploadThrottlerConfig();
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_METADATA_KEY + 'default',
        controller.searchByPhoto,
      );
      const ttl = Reflect.getMetadata(
        THROTTLER_TTL_METADATA_KEY + 'default',
        controller.searchByPhoto,
      );

      expect(limit).toBe(expected.default.limit);
      expect(ttl).toBe(expected.default.ttl);
    });
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('delegates to ItemsService.create and returns the new item', async () => {
      const item = { id: ITEM_ID, name: 'Drill' };
      service.create.mockResolvedValue(item);

      const dto: CreateItemDto = { name: 'Drill' };
      expect(await controller.create(dto, CURRENT_USER, CURRENT_WORKSPACE)).toBe(item);
      expect(service.create).toHaveBeenCalledWith(dto, USER_ID, WORKSPACE_ID);
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('delegates to ItemsService.update and returns the updated item', async () => {
      const updated = { id: ITEM_ID, name: 'Updated' };
      service.update.mockResolvedValue(updated);

      const dto: UpdateItemDto = { name: 'Updated' };
      expect(await controller.update(ITEM_ID, dto, CURRENT_USER, CURRENT_WORKSPACE)).toBe(updated);
      expect(service.update).toHaveBeenCalledWith(ITEM_ID, dto, USER_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.update.mockRejectedValue(new NotFoundException());
      await expect(controller.update(ITEM_ID, {}, CURRENT_USER, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // receive (EVT-31 AC 4)
  // =========================================================================

  describe('receive', () => {
    it('delegates to ItemsService.receive with the quantity, caller id, and workspace', async () => {
      const received = { id: ITEM_ID, quantity: 125 };
      service.receive.mockResolvedValue(received);

      const dto: ReceiveItemDto = { quantity: 25 };
      expect(await controller.receive(ITEM_ID, dto, CURRENT_USER, CURRENT_WORKSPACE)).toBe(
        received,
      );
      expect(service.receive).toHaveBeenCalledWith(ITEM_ID, 25, USER_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service (unknown item)', async () => {
      service.receive.mockRejectedValue(new NotFoundException());
      await expect(
        controller.receive(ITEM_ID, { quantity: 5 }, CURRENT_USER, CURRENT_WORKSPACE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // listMovements (EVT-25)
  // =========================================================================

  describe('listMovements', () => {
    it('delegates to StockMovementsService.listForItem and returns the page', async () => {
      const page = { data: [{ id: 'mv-1' }], page: 1, pageSize: 20, total: 1, totalPages: 1 };
      stockMovementsService.listForItem.mockResolvedValue(page);

      const result = await controller.listMovements(ITEM_ID, {}, CURRENT_WORKSPACE);

      expect(result).toBe(page);
      expect(stockMovementsService.listForItem).toHaveBeenCalledWith(ITEM_ID, {}, WORKSPACE_ID);
    });

    it('forwards page/pageSize query params', async () => {
      stockMovementsService.listForItem.mockResolvedValue({
        data: [],
        page: 2,
        pageSize: 5,
        total: 0,
        totalPages: 1,
      });

      await controller.listMovements(ITEM_ID, { page: 2, pageSize: 5 }, CURRENT_WORKSPACE);

      expect(stockMovementsService.listForItem).toHaveBeenCalledWith(
        ITEM_ID,
        {
          page: 2,
          pageSize: 5,
        },
        WORKSPACE_ID,
      );
    });

    it('propagates NotFoundException from the service (unknown item)', async () => {
      stockMovementsService.listForItem.mockRejectedValue(new NotFoundException());
      await expect(controller.listMovements(ITEM_ID, {}, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // listVerificationQueue (EVT-27 AC 3)
  // =========================================================================

  describe('listVerificationQueue', () => {
    it('delegates to ItemsService.listVerificationQueue and returns the queue', async () => {
      const queue = [{ id: ITEM_ID, daysOverdue: 3 }];
      service.listVerificationQueue.mockResolvedValue(queue);

      expect(await controller.listVerificationQueue(CURRENT_WORKSPACE)).toBe(queue);
      expect(service.listVerificationQueue).toHaveBeenCalledWith(undefined, WORKSPACE_ID);
    });
  });

  // =========================================================================
  // count (EVT-27 AC 2)
  // =========================================================================

  describe('count', () => {
    it('delegates to ItemsService.count with id, quantity, caller id, and workspace', async () => {
      const result = { item: { id: ITEM_ID }, bookQuantity: 3, countedQuantity: 5, delta: 2 };
      service.count.mockResolvedValue(result);

      const dto: CountItemDto = { quantity: 5 };
      expect(await controller.count(ITEM_ID, dto, CURRENT_USER, CURRENT_WORKSPACE)).toBe(result);
      expect(service.count).toHaveBeenCalledWith(ITEM_ID, 5, USER_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.count.mockRejectedValue(new NotFoundException());
      await expect(
        controller.count(ITEM_ID, { quantity: 1 }, CURRENT_USER, CURRENT_WORKSPACE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // consume (EVT-27 AC 4)
  // =========================================================================

  describe('consume', () => {
    it('delegates to ItemsService.consume with id, quantity, caller id, and workspace', async () => {
      const result = { item: { id: ITEM_ID }, offerVerification: true };
      service.consume.mockResolvedValue(result);

      const dto: ConsumeItemDto = { quantity: 2 };
      expect(await controller.consume(ITEM_ID, dto, CURRENT_USER, CURRENT_WORKSPACE)).toBe(result);
      expect(service.consume).toHaveBeenCalledWith(ITEM_ID, 2, USER_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.consume.mockRejectedValue(new NotFoundException());
      await expect(
        controller.consume(ITEM_ID, { quantity: 1 }, CURRENT_USER, CURRENT_WORKSPACE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // remove
  // =========================================================================

  describe('remove', () => {
    it('delegates to ItemsService.remove', async () => {
      service.remove.mockResolvedValue(undefined);
      await controller.remove(ITEM_ID, CURRENT_WORKSPACE);
      expect(service.remove).toHaveBeenCalledWith(ITEM_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.remove.mockRejectedValue(new NotFoundException());
      await expect(controller.remove(ITEM_ID, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // AC 4: DTO validation — missing name or bad UUID → 400
  // =========================================================================

  describe('AC4: input validation', () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    });

    // -----------------------------------------------------------------------
    // CreateItemDto
    // -----------------------------------------------------------------------

    describe('CreateItemDto', () => {
      it('throws BadRequestException when name is missing', async () => {
        await expect(pipe.transform({}, { type: 'body', metatype: CreateItemDto })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('throws BadRequestException when name is an empty string', async () => {
        await expect(
          pipe.transform({ name: '' }, { type: 'body', metatype: CreateItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when locationId is not a valid UUID', async () => {
        await expect(
          pipe.transform(
            { name: 'Drill', locationId: 'not-a-uuid' },
            { type: 'body', metatype: CreateItemDto },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when categoryId is not a valid UUID', async () => {
        await expect(
          pipe.transform(
            { name: 'Drill', categoryId: 'bad' },
            { type: 'body', metatype: CreateItemDto },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when photoIds contains a non-UUID value', async () => {
        await expect(
          pipe.transform(
            { name: 'Drill', photoIds: ['not-uuid'] },
            { type: 'body', metatype: CreateItemDto },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a valid payload without extra errors', async () => {
        const validDto = await pipe.transform(
          { name: 'Cordless Drill', tags: ['power-tool'], quantity: 2 },
          { type: 'body', metatype: CreateItemDto },
        );
        expect(validDto.name).toBe('Cordless Drill');
        expect(validDto.quantity).toBe(2);
      });
    });

    // -----------------------------------------------------------------------
    // UpdateItemDto
    // -----------------------------------------------------------------------

    describe('UpdateItemDto', () => {
      it('throws BadRequestException when name is empty string (not blank)', async () => {
        await expect(
          pipe.transform({ name: '' }, { type: 'body', metatype: UpdateItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when locationId is not a valid UUID', async () => {
        await expect(
          pipe.transform({ locationId: 'bad-id' }, { type: 'body', metatype: UpdateItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts an empty update DTO', async () => {
        const dto = await pipe.transform({}, { type: 'body', metatype: UpdateItemDto });
        expect(dto).toEqual({});
      });

      // Round-3 review fix: explicit `null` must pass validation (it means
      // "clear the relation"), distinct from an absent key ("leave unchanged").
      it('accepts explicit null for locationId (clears the relation)', async () => {
        const dto = await pipe.transform(
          { locationId: null },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ locationId: null });
      });

      it('accepts explicit null for categoryId (clears the relation)', async () => {
        const dto = await pipe.transform(
          { categoryId: null },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ categoryId: null });
      });

      // EVT-27 AC 1
      it('accepts a valid countIntervalDays', async () => {
        const dto = await pipe.transform(
          { countIntervalDays: 30 },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ countIntervalDays: 30 });
      });

      it('accepts explicit null for countIntervalDays (clears the count schedule)', async () => {
        const dto = await pipe.transform(
          { countIntervalDays: null },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ countIntervalDays: null });
      });

      it('throws BadRequestException when countIntervalDays is 0 or below', async () => {
        await expect(
          pipe.transform({ countIntervalDays: 0 }, { type: 'body', metatype: UpdateItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a valid lastVerifiedAt ISO date string', async () => {
        const dto = await pipe.transform(
          { lastVerifiedAt: '2026-08-01T00:00:00.000Z' },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ lastVerifiedAt: '2026-08-01T00:00:00.000Z' });
      });

      it('accepts explicit null for lastVerifiedAt (clears "never verified")', async () => {
        const dto = await pipe.transform(
          { lastVerifiedAt: null },
          { type: 'body', metatype: UpdateItemDto },
        );
        expect(dto).toEqual({ lastVerifiedAt: null });
      });

      it('throws BadRequestException when lastVerifiedAt is not a valid date string', async () => {
        await expect(
          pipe.transform(
            { lastVerifiedAt: 'not-a-date' },
            { type: 'body', metatype: UpdateItemDto },
          ),
        ).rejects.toThrow(BadRequestException);
      });

      // EVT-27 review round 2, finding 3: `@IsISO8601({ strict: true })`
      // (not `@IsDateString()`) rejects calendar-invalid dates like
      // 2026-02-30, which the plain `Date` constructor would otherwise
      // silently roll over into a value that fails later as an unhandled
      // 500 in Prisma.
      it('throws BadRequestException when lastVerifiedAt is a calendar-invalid date', async () => {
        await expect(
          pipe.transform(
            { lastVerifiedAt: '2026-02-30T00:00:00.000Z' },
            { type: 'body', metatype: UpdateItemDto },
          ),
        ).rejects.toThrow(BadRequestException);
      });
    });

    // -----------------------------------------------------------------------
    // CountItemDto / ConsumeItemDto (EVT-27)
    // -----------------------------------------------------------------------

    describe('CountItemDto', () => {
      it('accepts a valid non-negative quantity, including 0', async () => {
        const dto = await pipe.transform({ quantity: 0 }, { type: 'body', metatype: CountItemDto });
        expect(dto).toEqual({ quantity: 0 });
      });

      it('throws BadRequestException when quantity is negative', async () => {
        await expect(
          pipe.transform({ quantity: -1 }, { type: 'body', metatype: CountItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when quantity is missing', async () => {
        await expect(pipe.transform({}, { type: 'body', metatype: CountItemDto })).rejects.toThrow(
          BadRequestException,
        );
      });

      // EVT-27 review round 2, finding 2: the Postgres INTEGER upper bound
      // must be enforced at the DTO layer, not left to fail as an
      // unhandled 500 in Prisma.
      it('accepts quantity at the INTEGER upper bound (2147483647)', async () => {
        const dto = await pipe.transform(
          { quantity: 2147483647 },
          { type: 'body', metatype: CountItemDto },
        );
        expect(dto).toEqual({ quantity: 2147483647 });
      });

      it('throws BadRequestException when quantity exceeds the INTEGER upper bound', async () => {
        await expect(
          pipe.transform({ quantity: 2147483648 }, { type: 'body', metatype: CountItemDto }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    describe('ConsumeItemDto', () => {
      it('accepts a valid positive quantity', async () => {
        const dto = await pipe.transform(
          { quantity: 2 },
          { type: 'body', metatype: ConsumeItemDto },
        );
        expect(dto).toEqual({ quantity: 2 });
      });

      it('throws BadRequestException when quantity is 0 (nothing to consume)', async () => {
        await expect(
          pipe.transform({ quantity: 0 }, { type: 'body', metatype: ConsumeItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      // EVT-27 review round 2, finding 2 — see CountItemDto above.
      it('accepts quantity at the INTEGER upper bound (2147483647)', async () => {
        const dto = await pipe.transform(
          { quantity: 2147483647 },
          { type: 'body', metatype: ConsumeItemDto },
        );
        expect(dto).toEqual({ quantity: 2147483647 });
      });

      it('throws BadRequestException when quantity exceeds the INTEGER upper bound', async () => {
        await expect(
          pipe.transform({ quantity: 2147483648 }, { type: 'body', metatype: ConsumeItemDto }),
        ).rejects.toThrow(BadRequestException);
      });
    });

    // -----------------------------------------------------------------------
    // ReceiveItemDto (EVT-31 AC 4)
    // -----------------------------------------------------------------------

    describe('ReceiveItemDto', () => {
      it('throws BadRequestException when quantity is missing', async () => {
        await expect(
          pipe.transform({}, { type: 'body', metatype: ReceiveItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when quantity is 0 (must add at least 1)', async () => {
        await expect(
          pipe.transform({ quantity: 0 }, { type: 'body', metatype: ReceiveItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('throws BadRequestException when quantity is not an integer', async () => {
        await expect(
          pipe.transform({ quantity: 1.5 }, { type: 'body', metatype: ReceiveItemDto }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a valid positive integer quantity', async () => {
        const dto = await pipe.transform(
          { quantity: 25 },
          { type: 'body', metatype: ReceiveItemDto },
        );
        expect(dto.quantity).toBe(25);
      });
    });

    // -----------------------------------------------------------------------
    // ParseUUIDPipe — bad UUID in :id param → 400
    // -----------------------------------------------------------------------

    describe('ParseUUIDPipe', () => {
      const uuidPipe = new ParseUUIDPipe();

      it('throws BadRequestException for a non-UUID id param', async () => {
        await expect(
          uuidPipe.transform('not-a-uuid', { type: 'param', data: 'id' }),
        ).rejects.toThrow(BadRequestException);
      });

      it('accepts a valid UUID', async () => {
        const result = await uuidPipe.transform(ITEM_ID, { type: 'param', data: 'id' });
        expect(result).toBe(ITEM_ID);
      });

      it('rejects a plain string that looks nothing like a UUID', async () => {
        await expect(
          uuidPipe.transform('hello-world', { type: 'param', data: 'id' }),
        ).rejects.toThrow(BadRequestException);
      });
    });
  });
});
