import { UnsupportedMediaTypeException } from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ALLOWED_PHOTO_MIME_TYPES, MAX_ANALYSIS_SIZE_BYTES } from '../photos/photos.service';

// ---------------------------------------------------------------------------
// searchByPhotoMulterOptions — multer config for POST /api/items/search-by-photo
// ---------------------------------------------------------------------------

/**
 * The photo posted to this endpoint is used ONLY to drive a single Claude
 * vision call (via `AiService.analyzePhoto`, reused from EVT-7) — it must
 * never be persisted to disk or the DB (task AC 2). `memoryStorage()` keeps
 * the file entirely in the request's `file.buffer`; nothing is ever written
 * to `STORAGE_DIR`, so there's no temp file to clean up afterwards (unlike
 * `photoUploadMulterOptions` in `photo-upload.helpers.ts`, which uses
 * `diskStorage` because its uploads ARE persisted).
 *
 * Mime allowlist is shared with `photos.service.ts` (`ALLOWED_PHOTO_MIME_TYPES`
 * — jpeg/png/webp/heic/heif) rather than the narrower vision-only set in
 * `ai.service.ts`: an unsupported-for-vision mimetype (e.g. heic) is still a
 * legitimate *upload*, and `AiService.analyzePhoto` already degrades that
 * case to a stub analysis (`stub_reason: 'unsupported-image-format'`) rather
 * than erroring — same pattern `PhotosService` uses for `?analyze=true`.
 *
 * Size ceiling is `MAX_ANALYSIS_SIZE_BYTES` (5 MB), not the general 20 MB
 * upload ceiling — this endpoint never stores the file, its only cost is the
 * vision call, so the same reasoning that caps `?analyze=true` in
 * `photos.service.ts` applies directly here (EVT-7 review round 2, finding 3).
 */
export const searchByPhotoMulterOptions: MulterModuleOptions = {
  storage: memoryStorage(),
  limits: {
    fileSize: MAX_ANALYSIS_SIZE_BYTES,
    files: 1,
    fields: 0,
    fieldSize: 1024,
    parts: 4,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      callback(new UnsupportedMediaTypeException(`Unsupported file type: ${file.mimetype}`), false);
      return;
    }
    callback(null, true);
  },
};
