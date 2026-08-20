import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { uploadThrottlerConfig } from '../common/throttle.config';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

// `@nestjs/throttler`'s `@Throttle()` decorator stashes its config under
// these Reflect metadata keys (see `throttler.constants.ts` — not part of
// the package's public export surface, so the string literals are
// duplicated here rather than deep-importing `dist/throttler.constants`).
const THROTTLER_LIMIT_METADATA_KEY = 'THROTTLER:LIMIT';
const THROTTLER_TTL_METADATA_KEY = 'THROTTLER:TTL';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHOTO_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';
const WORKSPACE_ID = '33333333-3333-3333-3333-333333333333';
/** Minimal `AuthenticatedUser` stand-in — only `.id` is read by the controller. */
const CURRENT_USER = { id: USER_ID } as never;
/** `@CurrentWorkspace()` resolves this shape (EVT-40) — see workspace-context.ts. */
const CURRENT_WORKSPACE = { id: WORKSPACE_ID, role: 'member' } as never;

function makePhotosServiceMock() {
  return {
    savePhoto: jest.fn(),
    findById: jest.fn(),
    remove: jest.fn(),
  };
}

function makeMulterFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname: 'photo.png',
    encoding: '7bit',
    mimetype: 'image/png',
    filename: 'uuid-generated.png',
    path: '/tmp/storage/uuid-generated.png',
    size: 1024,
    destination: '/tmp/storage',
    buffer: Buffer.from(''),
    stream: undefined as unknown as Express.Multer.File['stream'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhotosController', () => {
  let controller: PhotosController;
  let service: ReturnType<typeof makePhotosServiceMock>;

  beforeEach(async () => {
    service = makePhotosServiceMock();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhotosController],
      providers: [{ provide: PhotosService, useValue: service }],
    }).compile();

    controller = module.get<PhotosController>(PhotosController);
  });

  // =========================================================================
  // upload
  // =========================================================================

  describe('upload', () => {
    it('delegates to PhotosService.savePhoto with the file and itemId, analyze defaulting to false', async () => {
      const file = makeMulterFile();
      const photo = { id: PHOTO_ID, filename: file.filename, url: `/storage/${file.filename}` };
      service.savePhoto.mockResolvedValue(photo);

      const result = await controller.upload(
        file,
        { itemId: 'item-id' },
        undefined,
        CURRENT_USER,
        CURRENT_WORKSPACE,
      );

      expect(result).toBe(photo);
      expect(service.savePhoto).toHaveBeenCalledWith(file, 'item-id', false, USER_ID, WORKSPACE_ID);
    });

    it('delegates without itemId when not provided', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {}, undefined, CURRENT_USER, CURRENT_WORKSPACE);

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, false, USER_ID, WORKSPACE_ID);
    });

    it('passes analyze=true through to the service when ?analyze=true', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {}, 'true', CURRENT_USER, CURRENT_WORKSPACE);

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, true, USER_ID, WORKSPACE_ID);
    });

    it('treats any non-"true" value (including missing) as analyze=false', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {}, 'yes', CURRENT_USER, CURRENT_WORKSPACE);

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, false, USER_ID, WORKSPACE_ID);
    });

    it('throws BadRequestException when no file is present (multer rejected it)', () => {
      expect(() =>
        controller.upload(
          undefined as unknown as Express.Multer.File,
          {},
          undefined,
          CURRENT_USER,
          CURRENT_WORKSPACE,
        ),
      ).toThrow(BadRequestException);
      expect(service.savePhoto).not.toHaveBeenCalled();
    });

    it('propagates BadRequestException from the service (e.g. unknown itemId)', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockRejectedValue(new BadRequestException('Item x not found'));

      await expect(
        controller.upload(file, { itemId: 'missing' }, undefined, CURRENT_USER, CURRENT_WORKSPACE),
      ).rejects.toThrow(BadRequestException);
    });

    // =========================================================================
    // Rate limiting (EVT-7 review round 2, finding 1)
    // =========================================================================

    it('carries the stricter upload throttle config from @Throttle metadata', () => {
      const expected = uploadThrottlerConfig();
      const limit = Reflect.getMetadata(
        THROTTLER_LIMIT_METADATA_KEY + 'default',
        controller.upload,
      );
      const ttl = Reflect.getMetadata(THROTTLER_TTL_METADATA_KEY + 'default', controller.upload);

      expect(limit).toBe(expected.default.limit);
      expect(ttl).toBe(expected.default.ttl);
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('delegates to PhotosService.findById and returns the photo', async () => {
      const photo = { id: PHOTO_ID, filename: 'a.png', url: '/storage/a.png' };
      service.findById.mockResolvedValue(photo);

      expect(await controller.findById(PHOTO_ID, CURRENT_WORKSPACE)).toBe(photo);
      expect(service.findById).toHaveBeenCalledWith(PHOTO_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.findById.mockRejectedValue(new NotFoundException());
      await expect(controller.findById(PHOTO_ID, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // remove
  // =========================================================================

  describe('remove', () => {
    it('delegates to PhotosService.remove', async () => {
      service.remove.mockResolvedValue(undefined);
      await controller.remove(PHOTO_ID, CURRENT_WORKSPACE);
      expect(service.remove).toHaveBeenCalledWith(PHOTO_ID, WORKSPACE_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.remove.mockRejectedValue(new NotFoundException());
      await expect(controller.remove(PHOTO_ID, CURRENT_WORKSPACE)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
