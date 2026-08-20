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
const WORKSPACE_ID = '99999999-9999-9999-9999-999999999999';

function makePrismaMock() {
  return {
    photo: {
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
    item: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
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
    it('creates a Photo row with width/height from sharp metadata (AC3), stamped with workspaceId', async () => {
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

      const result = await service.savePhoto(
        makeFile({ filename: 'uuid.png' }),
        undefined,
        false,
        undefined,
        WORKSPACE_ID,
      );

      expect(prismaMock.photo.create).toHaveBeenCalledWith({
        data: {
          filename: 'uuid.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          width: 640,
          height: 480,
          workspaceId: WORKSPACE_ID,
        },
      });
      expect(result).toEqual({ ...created, url: '/storage/uuid.png' });
    });

    it('links itemId when it belongs to the same workspace', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), 'item-1', false, undefined, WORKSPACE_ID);

      expect(prismaMock.item.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', workspaceId: WORKSPACE_ID },
        select: { id: true },
      });
      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ itemId: 'item-1' }) }),
      );
    });

    // =======================================================================
    // EVT-40 — itemId is ALWAYS validated against the caller's workspace,
    // regardless of `analyze` (previously this only ran on the
    // `analyze && itemId` path — see PhotosService.savePhoto's doc comment).
    // =======================================================================

    it('EVT-40: throws BadRequestException when itemId belongs to a different workspace, even with analyze=false', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.item.findFirst.mockResolvedValue(null);

      const file = makeFile();
      await expect(
        service.savePhoto(file, 'foreign-item', false, undefined, WORKSPACE_ID),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    // =======================================================================
    // EVT-24 AC1/AC2 — first upload becomes primary, subsequent uploads don't
    // steal it
    // =======================================================================

    it('EVT-24 AC1: auto-promotes the uploaded photo to primary when the item has none yet', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });
      prismaMock.item.updateMany.mockResolvedValue({ count: 1 });

      await service.savePhoto(makeFile(), 'item-1', false, undefined, WORKSPACE_ID);

      expect(prismaMock.item.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1', primaryPhotoId: null },
        data: { primaryPhotoId: PHOTO_ID },
      });
    });

    it('EVT-24 AC2: does not steal an existing primary — updateMany matches zero rows when primaryPhotoId is already set', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'second.png' });
      // `updateMany`'s `where: { primaryPhotoId: null }` is what actually
      // enforces AC2 against the real DB; here we assert the call shape and
      // that a zero-row match (simulated via `count: 0`) doesn't throw or
      // otherwise change behavior.
      prismaMock.item.updateMany.mockResolvedValue({ count: 0 });

      await service.savePhoto(makeFile(), 'item-1', false, undefined, WORKSPACE_ID);

      expect(prismaMock.item.updateMany).toHaveBeenCalledWith({
        where: { id: 'item-1', primaryPhotoId: null },
        data: { primaryPhotoId: PHOTO_ID },
      });
    });

    it('EVT-24: does not touch primaryPhotoId when itemId is not provided', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'unlinked.png' });

      await service.savePhoto(makeFile(), undefined, false, undefined, WORKSPACE_ID);

      expect(prismaMock.item.updateMany).not.toHaveBeenCalled();
    });

    it('EVT-24: logs and swallows a failure promoting to primary rather than unwinding the upload', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      const created = { id: PHOTO_ID, filename: 'x.png' };
      prismaMock.photo.create.mockResolvedValue(created);
      prismaMock.item.updateMany.mockRejectedValue(new Error('connection lost'));

      const result = await service.savePhoto(makeFile(), 'item-1', false, undefined, WORKSPACE_ID);

      expect(result).toEqual({ ...created, url: '/storage/x.png' });
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('EVT-14: stamps uploadedById when provided', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), undefined, false, 'user-1', WORKSPACE_ID);

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ uploadedById: 'user-1' }) }),
      );
    });

    it('EVT-14: omits uploadedById from the write when not provided', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 100, height: 100 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), undefined, false, undefined, WORKSPACE_ID);

      const createArg = prismaMock.photo.create.mock.calls[0][0];
      expect(createArg.data).not.toHaveProperty('uploadedById');
    });

    it('degrades to null width/height when sharp metadata read fails for the HEIC/HEIF carve-out', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'));
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.heic' });

      await service.savePhoto(
        makeFile({ filename: 'x.heic', mimetype: 'image/heic' }),
        undefined,
        false,
        undefined,
        WORKSPACE_ID,
      );

      expect(prismaMock.photo.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ width: null, height: null }) }),
      );
      expect(unlinkMock).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the item.create FK check itself fails (race: item deleted between check and write)', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 10, height: 10 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'missing-item' });
      prismaMock.photo.create.mockRejectedValue(fkViolation());

      const file = makeFile();
      await expect(
        service.savePhoto(file, 'missing-item', false, undefined, WORKSPACE_ID),
      ).rejects.toThrow(BadRequestException);
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rethrows unrelated Prisma errors', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 10, height: 10 });
      const other = new Error('connection lost');
      prismaMock.photo.create.mockRejectedValue(other);

      const file = makeFile();
      await expect(
        service.savePhoto(file, undefined, false, undefined, WORKSPACE_ID),
      ).rejects.toThrow(other);
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rejects undecodable bytes declared as image/png with 400 and unlinks the file', async () => {
      // sharp resolves metadata but the decoded format doesn't match the
      // declared mimetype — e.g. a renamed .txt file uploaded as image/png.
      metadataMock.mockResolvedValue({ format: undefined, width: undefined, height: undefined });

      const file = makeFile({ mimetype: 'image/png' });
      await expect(
        service.savePhoto(file, undefined, false, undefined, WORKSPACE_ID),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('rejects bytes sharp cannot decode at all when declared image/jpeg, and unlinks the file', async () => {
      metadataMock.mockRejectedValue(new Error('unsupported image format'));

      const file = makeFile({ mimetype: 'image/jpeg', filename: 'x.jpg' });
      await expect(
        service.savePhoto(file, undefined, false, undefined, WORKSPACE_ID),
      ).rejects.toThrow(BadRequestException);
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('does NOT unlink or reject when sharp successfully decodes the declared format', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'ok.png' });

      const file = makeFile();
      await service.savePhoto(file, undefined, false, undefined, WORKSPACE_ID);

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

      await service.savePhoto(makeFile(), undefined, false, undefined, WORKSPACE_ID);

      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(prismaMock.photo.create).toHaveBeenCalledWith({
        data: {
          filename: 'uuid-generated.png',
          mimeType: 'image/png',
          sizeBytes: 2048,
          width: 640,
          height: 480,
          workspaceId: WORKSPACE_ID,
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
      const result = await service.savePhoto(file, undefined, true, undefined, WORKSPACE_ID);

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

      await service.savePhoto(makeFile(), undefined, true, undefined, WORKSPACE_ID);

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
      await service.savePhoto(file, undefined, true, undefined, WORKSPACE_ID);

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
      await service.savePhoto(file, undefined, true, undefined, WORKSPACE_ID);

      expect(aiServiceMock.analyzePhoto).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // savePhoto — itemId workspace pre-validation (EVT-40; formerly EVT-7
  // review round 2 finding 5's narrower "only when analyze=true" check)
  // =========================================================================

  describe('savePhoto — itemId workspace pre-validation', () => {
    it('throws BadRequestException and never calls AiService when itemId does not exist in the workspace', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.item.findFirst.mockResolvedValue(null);

      const file = makeFile();
      await expect(
        service.savePhoto(file, 'missing-item', true, undefined, WORKSPACE_ID),
      ).rejects.toThrow(BadRequestException);

      expect(prismaMock.item.findFirst).toHaveBeenCalledWith({
        where: { id: 'missing-item', workspaceId: WORKSPACE_ID },
        select: { id: true },
      });
      expect(aiServiceMock.analyzePhoto).not.toHaveBeenCalled();
      expect(prismaMock.photo.create).not.toHaveBeenCalled();
      expect(unlinkMock).toHaveBeenCalledWith(file.path);
    });

    it('proceeds to run AiService.analyzePhoto when itemId exists in the workspace', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      aiServiceMock.analyzePhoto.mockResolvedValue(STUB_ANALYSIS);
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'ok.png' });

      await service.savePhoto(makeFile(), 'item-1', true, undefined, WORKSPACE_ID);

      expect(aiServiceMock.analyzePhoto).toHaveBeenCalled();
    });

    it('EVT-40: still validates itemId when analyze is false (no longer skipped)', async () => {
      metadataMock.mockResolvedValue({ format: 'png', width: 640, height: 480 });
      prismaMock.item.findFirst.mockResolvedValue({ id: 'item-1' });
      prismaMock.photo.create.mockResolvedValue({ id: PHOTO_ID, filename: 'x.png' });

      await service.savePhoto(makeFile(), 'item-1', false, undefined, WORKSPACE_ID);

      expect(prismaMock.item.findFirst).toHaveBeenCalledWith({
        where: { id: 'item-1', workspaceId: WORKSPACE_ID },
        select: { id: true },
      });
    });
  });

  // =========================================================================
  // findById
  // =========================================================================

  describe('findById', () => {
    it('returns the photo row with a public url when it belongs to the workspace', async () => {
      prismaMock.photo.findFirst.mockResolvedValue({ id: PHOTO_ID, filename: 'a.png' });

      const result = await service.findById(PHOTO_ID, WORKSPACE_ID);

      expect(result).toEqual({ id: PHOTO_ID, filename: 'a.png', url: '/storage/a.png' });
      expect(prismaMock.photo.findFirst).toHaveBeenCalledWith({
        where: { id: PHOTO_ID, workspaceId: WORKSPACE_ID },
      });
    });

    it('throws NotFoundException when the photo does not exist', async () => {
      prismaMock.photo.findFirst.mockResolvedValue(null);
      await expect(service.findById(PHOTO_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
    });

    it('EVT-40: 404s for a foreign-workspace photo, same as an unknown id', async () => {
      prismaMock.photo.findFirst.mockResolvedValue(null);
      await expect(service.findById(PHOTO_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
    });
  });

  // =========================================================================
  // remove
  // =========================================================================

  describe('remove', () => {
    it('deletes the Photo row and unlinks its on-disk file', async () => {
      prismaMock.photo.findFirst.mockResolvedValue({ id: PHOTO_ID, filename: 'a.png' });
      prismaMock.photo.delete.mockResolvedValue({ id: PHOTO_ID, filename: 'a.png' });

      await service.remove(PHOTO_ID, WORKSPACE_ID);

      expect(prismaMock.photo.findFirst).toHaveBeenCalledWith({
        where: { id: PHOTO_ID, workspaceId: WORKSPACE_ID },
      });
      expect(prismaMock.photo.delete).toHaveBeenCalledWith({ where: { id: PHOTO_ID } });
      expect(unlinkMock).toHaveBeenCalledWith(expect.stringContaining('a.png'));
    });

    it('throws NotFoundException when the photo does not exist, without attempting delete', async () => {
      prismaMock.photo.findFirst.mockResolvedValue(null);

      await expect(service.remove(PHOTO_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
      expect(prismaMock.photo.delete).not.toHaveBeenCalled();
    });

    it('EVT-40: throws NotFoundException for a foreign-workspace photo, without attempting delete', async () => {
      prismaMock.photo.findFirst.mockResolvedValue(null);

      await expect(service.remove(PHOTO_ID, WORKSPACE_ID)).rejects.toThrow(NotFoundException);
      expect(prismaMock.photo.delete).not.toHaveBeenCalled();
    });
  });
});
