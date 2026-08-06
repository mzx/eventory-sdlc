import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHOTO_ID = '11111111-1111-1111-1111-111111111111';

function makePhotosServiceMock() {
  return {
    savePhoto: jest.fn(),
    findById: jest.fn(),
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

      const result = await controller.upload(file, { itemId: 'item-id' });

      expect(result).toBe(photo);
      expect(service.savePhoto).toHaveBeenCalledWith(file, 'item-id', false);
    });

    it('delegates without itemId when not provided', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {});

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, false);
    });

    it('passes analyze=true through to the service when ?analyze=true', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {}, 'true');

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, true);
    });

    it('treats any non-"true" value (including missing) as analyze=false', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockResolvedValue({ id: PHOTO_ID });

      await controller.upload(file, {}, 'yes');

      expect(service.savePhoto).toHaveBeenCalledWith(file, undefined, false);
    });

    it('throws BadRequestException when no file is present (multer rejected it)', () => {
      expect(() => controller.upload(undefined as unknown as Express.Multer.File, {})).toThrow(
        BadRequestException,
      );
      expect(service.savePhoto).not.toHaveBeenCalled();
    });

    it('propagates BadRequestException from the service (e.g. unknown itemId)', async () => {
      const file = makeMulterFile();
      service.savePhoto.mockRejectedValue(new BadRequestException('Item x not found'));

      await expect(controller.upload(file, { itemId: 'missing' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('delegates to PhotosService.findById and returns the photo', async () => {
      const photo = { id: PHOTO_ID, filename: 'a.png', url: '/storage/a.png' };
      service.findById.mockResolvedValue(photo);

      expect(await controller.findById(PHOTO_ID)).toBe(photo);
      expect(service.findById).toHaveBeenCalledWith(PHOTO_ID);
    });

    it('propagates NotFoundException from service', async () => {
      service.findById.mockRejectedValue(new NotFoundException());
      await expect(controller.findById(PHOTO_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
