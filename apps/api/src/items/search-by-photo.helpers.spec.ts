import { Readable } from 'stream';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_ANALYSIS_SIZE_BYTES } from '../photos/photos.service';
import { searchByPhotoMulterOptions } from './search-by-photo.helpers';

// ---------------------------------------------------------------------------
// AC2 — the search photo must never be persisted to storage or DB.
//
// These tests exercise the multer `StorageEngine` directly (rather than
// spinning up a full HTTP request) to prove the configured storage is
// memory-only: a real `diskStorage` engine's `_handleFile` callback returns
// `{ path, filename }` (bytes already written to disk by the time the
// callback fires); `memoryStorage()`'s callback returns `{ buffer, size }`
// and never touches the filesystem.
// ---------------------------------------------------------------------------

describe('searchByPhotoMulterOptions', () => {
  describe('AC2: storage never persists to disk', () => {
    it('uses memory storage — the handled file comes back as an in-memory buffer, not a disk path', (done) => {
      const fakeBytes = Buffer.from('fake-image-bytes');
      const stream = Readable.from([fakeBytes]);

      const storage = searchByPhotoMulterOptions.storage as {
        _handleFile: (
          req: unknown,
          file: { stream: Readable },
          callback: (error: unknown, info?: Record<string, unknown>) => void,
        ) => void;
      };

      storage._handleFile({}, { stream }, (error, info) => {
        expect(error).toBeFalsy();
        // memoryStorage's callback info: { buffer, size } — no `path` or
        // `filename`, because nothing was ever written to disk.
        expect(info).toBeDefined();
        expect(Buffer.isBuffer(info?.buffer)).toBe(true);
        expect((info?.buffer as Buffer).equals(fakeBytes)).toBe(true);
        expect(info?.path).toBeUndefined();
        expect(info?.filename).toBeUndefined();
        done();
      });
    });
  });

  describe('limits', () => {
    it('caps fileSize at MAX_ANALYSIS_SIZE_BYTES (the vision-analysis ceiling, not the 20MB upload ceiling)', () => {
      expect(searchByPhotoMulterOptions.limits?.fileSize).toBe(MAX_ANALYSIS_SIZE_BYTES);
    });

    it('allows only a single file', () => {
      expect(searchByPhotoMulterOptions.limits?.files).toBe(1);
    });
  });

  describe('fileFilter', () => {
    function runFilter(mimetype: string): Promise<boolean> {
      return new Promise((resolve, reject) => {
        searchByPhotoMulterOptions.fileFilter?.(
          {} as never,
          { mimetype } as Express.Multer.File,
          (error, acceptFile) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(Boolean(acceptFile));
          },
        );
      });
    }

    it.each([...ALLOWED_PHOTO_MIME_TYPES])(
      'accepts %s (shared storage-upload allowlist)',
      async (mimeType) => {
        await expect(runFilter(mimeType)).resolves.toBe(true);
      },
    );

    it('rejects an unsupported mimetype with UnsupportedMediaTypeException', async () => {
      await expect(runFilter('application/pdf')).rejects.toThrow(/Unsupported file type/);
    });
  });
});
