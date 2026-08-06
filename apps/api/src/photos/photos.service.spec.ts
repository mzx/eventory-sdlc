import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { PhotosService, UploadedPhotoFile } from './photos.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// sharp mock — avoid touching real image-decoding in unit tests
// ---------------------------------------------------------------------------

const metadataMock = jest.fn();
jest.mock('sharp', () => jest.fn(() => ({ metadata: metadataMock })));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PHOTO_ID = '11111111-1111-1111-1111-111111111111';

function makePrismaMock() {
  return {
    photo: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
  };
}

function makeFile(overrides: Partial<UploadedPhotoFile> = {}): UploadedPhotoFile {
  return {
    filename: 'uuid-generated.png',
    path: '/tmp/storage/uuid-generated.png',
    mimetype: 'image/png',
    size: 2048,
    ...overrides,
  };
}

function fkViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Foreign key constraint failed', {
    code: 'P2003',
    clientVersion: '5.22.0',
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhotosService', () => {
  let service: PhotosService;
  let prismaMock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    metadataMock.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [PhotosService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<PhotosService>(PhotosService);
  });

  // =========================================================================
  // savePhoto
  // =========================================================================

  describe('savePhoto', () => {
    it('creates a Photo row with width/height from sharp metadata (AC3)', async () => {
      metadataMock.mockResolvedValue({ width: 640, height: 480 });
      const created = {
        id: PHOTO_ID,
        filename: 'uuid.png',
        mimeType: 'image/png',
        sizeBytes: 2048,
        width: 640,
        height: 480,
        itemId: null,
        aiAnalysis: null,
      };
      prismaMock.photo.create.mockResolvedValue(created);

      const result = await service.savePhoto(makeFile({ filename: 'uuid.png' }));

      expect(prismaMock.photo.create).toHaveBeenCalledWith({
        data: {
          filename: 'uuid.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          width: 640,
          height: 480,
        },
      });
      expect(result).toEqual({ ...created, url: '/storage/uuid.png' });
    });

    it('links itemId when provided', async () => {
      metadataMock.mockResolvedValue({ width: 100, height: 100 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), 'item-1');

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ itemId: 'item-1' }) }),
      );
    });

    it('degrades to null width/height when sharp metadata read fails', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'));
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.heic' });

      await service.savePhoto(makeFile({ filename: 'x.heic', mimetype: 'image/heic' }));

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ width: null, height: null }) }),
      );
    });

    it('throws BadRequestException when itemId does not reference an existing item', async () => {
      metadataMock.mockResolvedValue({ width: 10, height: 10 });
      prismaMock.photo.create.mockRejectedValue(fkViolation());

      await expect(service.savePhoto(makeFile(), 'missing-item')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rethrows unrelated Prisma errors', async () => {
      metadataMock.mockResolvedValue({ width: 10, height: 10 });
      const other = new Error('connection lost');
      prismaMock.photo.create.mockRejectedValue(other);

      await expect(service.savePhoto(makeFile())).rejects.toThrow(other);
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('returns the photo row with a public url', async () => {
      prismaMock.photo.findUnique.mockResolvedValue({ id: PHOTO_ID, filename: 'a.png' });

      const result = await service.findById(PHOTO_ID);

      expect(result).toEqual({ id: PHOTO_ID, filename: 'a.png', url: '/storage/a.png' });
    });

    it('throws NotFoundException when the photo does not exist', async () => {
      prismaMock.photo.findUnique.mockResolvedValue(null);
      await expect(service.findById(PHOTO_ID)).rejects.toThrow(NotFoundException);
    });
  });
});
