import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { AiService, STUB_ANALYSIS } from '../ai/ai.service';
import { PhotosService, UploadedPhotoFile } from './photos.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// sharp mock — avoid touching real image-decoding in unit tests
// ---------------------------------------------------------------------------

const metadataMock = jest.fn();
jest.mock('sharp', () => jest.fn(() => ({ metadata: metadataMock })));

// ---------------------------------------------------------------------------
// fs/promises mock — verify orphaned-file cleanup without touching real disk
// ---------------------------------------------------------------------------

const unlinkMock = jest.fn();
const readFileMock = jest.fn();
jest.mock('fs/promises', () => ({
  unlink: (...args: unknown[]) => unlinkMock(...args),
  readFile: (...args: unknown[]) => readFileMock(...args),
}));

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
    item: {
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

function makeAiServiceMock() {
  return { analyzePhoto: jest.fn() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PhotosService', () => {
  let service: PhotosService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  let aiServiceMock: ReturnType<typeof makeAiServiceMock>;

  beforeEach(async () => {
    prismaMock = makePrismaMock();
    aiServiceMock = makeAiServiceMock();
    metadataMock.mockReset();
    unlinkMock.mockReset();
    unlinkMock.mockResolvedValue(undefined);
    readFileMock.mockReset();
    readFileMock.mockResolvedValue(Buffer.from('fake-bytes'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PhotosService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: AiService, useValue: aiServiceMock },
      ],
    }).compile();

    service = module.get<PhotosService>(PhotosService);
  });

  // =========================================================================
  // savePhoto
  // =========================================================================

  describe('savePhoto', () => {
    it('creates a Photo row with width/height from sharp metadata (AC3)', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
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
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), 'item-1');

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ itemId: 'item-1' }) }),
      );
    });

    it('degrades to null width/height when sharp metadata read fails for the HEIC/HEIF carve-out', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'));
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.heic' });

      await service.savePhoto(makeFile({ filename: 'x.heic', mimetype: 'image/heic' }));

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ width: null, height: null }) }),
      );
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when itemId does not reference an existing item', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 10, height: 10 });
      prismaMock.photo.create.mockRejectedValue(fkViolation());

      const file = makeFile();
      await expect(service.savePhoto(file, 'missing-item')).rejects.toThrow(BadRequestException);
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rethrows unrelated Prisma errors', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 10, height: 10 });
      const other = new Error('connection lost');
      prismaMock.photo.create.mockRejectedValue(other);

      const file = makeFile();
      await expect(service.savePhoto(file)).rejects.toThrow(other);
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rejects undecodable bytes declared as image/png with 400 and unlinks the file', async () => {
      // sharp resolves metadata but the decoded format doesn't match the
      // declared mimetype — e.g. a renamed .txt file uploaded as image/png.
      metadataMock.mockResolvedValue({ format: undefined, width: undefined, height: undefined });

      const file = makeFile({ mimetype: 'image/png' });
      await expect(service.savePhoto(file)).rejects.toThrow(BadRequestException);
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rejects bytes sharp cannot decode at all when declared image/jpeg, and unlinks the file', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'));

      const file = makeFile({ mimetype: 'image/jpeg', filename: 'x.jpg' });
      await expect(service.savePhoto(file)).rejects.toThrow(BadRequestException);
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('does NOT unlink or reject when sharp successfully decodes the declared format', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'ok.png' });

      const file = makeFile();
      await service.savePhoto(file);

      expect(unlinkMock).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // savePhoto — AI analysis (?analyze=true, EVT-7 AC 2)
  // =========================================================================

  describe('savePhoto — AI analysis', () => {
    it('does NOT call AiService and persists aiAnalysis as null when analyze is not requested', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'uuid.png' });

      await service.savePhoto(makeFile());

      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(prismaMock.photo.create).toHaveBeenCalledWith({
        data: {
          filename: 'uuid-generated.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          width: 640,
          height: 480,
        },
      });
    });

    it('runs AiService.analyzePhoto and persists the result to aiAnalysis when analyze is true', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      const analysis = { suggested_name: 'Cordless Drill', tags: ['power-tools'] };
      aiServiceMock.analyzePhoto.mockResolvedValue(analysis);
      prismaMock.photo.create.mockResolvedValue({
        id: PHOTO_ID,
        filename: 'uuid.png',
        aiAnalysis: analysis,
      });

      const file = makeFile();
      const result = await service.savePhoto(file, undefined, true);

      const buffer = await readFileMock.mock.results[0].value;
      expect(readFileMock).toHaveBeenCalledWith(file.path);
      expect(aiServiceMock.analyzePhoto).toHaveBeenCalledWith(buffer, file.mimetype);
      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ aiAnalysis: analysis }) }),
      );
      expect(result.aiAnalysis).toEqual(analysis);
    });

    it('persists the stub analysis returned by AiService when no key is configured', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      aiServiceMock.analyzePhoto.mockResolvedValue(STUB_ANALYSIS);
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'uuid.png' });

      await service.savePhoto(makeFile(), undefined, true);

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ aiAnalysis: STUB_ANALYSIS }) }),
      );
    });

    // =======================================================================
    // Analysis-specific size ceiling (EVT-7 review round 2, finding 3)
    // =======================================================================

    it('skips AiService entirely and persists an oversized stub when the file exceeds the analysis size ceiling', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'big.png' });

      const file = makeFile({ size: 6 * 1024 * 1024 }); // > MAX_ANALYSIS_SIZE_BYTES (5 MB)
      await service.savePhoto(file, undefined, true);

      expect(readFileMock).not.toHaveBeenCalled();
      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            aiAnalysis: expect.objectContaining({ stub_reason: 'oversized' }),
          }),
        }),
      );
    });

    it('still runs AiService.analyzePhoto for a file at/under the analysis size ceiling', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      aiServiceMock.analyzePhoto.mockResolvedValue(STUB_ANALYSIS);
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'ok.png' });

      const file = makeFile({ size: 5 * 1024 * 1024 }); // exactly at the ceiling
      await service.savePhoto(file, undefined, true);

      expect(aiServiceMock.analyzePhoto).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // savePhoto — itemId pre-validation before a billed AI call
  // (EVT-7 review round 2, finding 5)
  // =========================================================================

  describe('savePhoto — itemId pre-validation for analyze=true', () => {
    it('throws BadRequestException and never calls AiService when itemId does not exist', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.item.findUnique.mockResolvedValue(null);

      const file = makeFile();
      await expect(service.savePhoto(file, 'missing-item', true)).rejects.toThrow(
        BadRequestException,
      );

      expect(prismaMock.item.findUnique).toHaveBeenCalledWith({
        where: { id: 'missing-item' },
        select: { id: true },
      });
      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('proceeds to run AiService.analyzePhoto when itemId exists', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });
      aiServiceMock.analyzePhoto.mockResolvedValue(STUB_ANALYSIS);
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'ok.png' });

      await service.savePhoto(makeFile(), 'item-1', true);

      expect(aiServiceMock.analyzePhoto).toHaveBeenCalled();
    });

    it('does not pre-validate itemId when analyze is false (photo.create FK handling covers it)', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), 'item-1', false);

      expect(prismaMock.item.findUnique).not.toHaveBeenCalled();
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
