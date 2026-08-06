import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import type { MulterModuleOptions } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import * as path from 'path';
import {
  ALLOWED_PHOTO_MIME_TYPES,
  EXTENSION_BY_MIME_TYPE,
  MAX_UPLOAD_SIZE_BYTES,
  STORAGE_DIR,
} from './photos.service';

// ---------------------------------------------------------------------------
// photoUploadMulterOptions — multer config for POST /api/photos/upload
// ---------------------------------------------------------------------------

/**
 * - Writes accepted files straight to {@link STORAGE_DIR} under a uuid
 *   filename that preserves the original extension (mapped from mimetype
 *   so we don't trust client-supplied filenames).
 * - Rejects anything over 20 MB (handled by `PayloadTooLargeFilter` below).
 * - Rejects unsupported mimetypes with a 415 before the file is written.
 *
 * Typed as Nest's own (vendored) `MulterModuleOptions` rather than `multer`'s
 * `Options` — the two packages' `fileFilter` callback signatures aren't
 * structurally identical, and `FileInterceptor` expects the former.
 */
export const photoUploadMulterOptions: MulterModuleOptions = {
  storage: diskStorage({
    destination: STORAGE_DIR,
    filename: (_req, file, callback) => {
      const ext = EXTENSION_BY_MIME_TYPE[file.mimetype] ?? path.extname(file.originalname);
      callback(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_SIZE_BYTES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_PHOTO_MIME_TYPES.has(file.mimetype)) {
      callback(new UnsupportedMediaTypeException(`Unsupported file type: ${file.mimetype}`), false);
      return;
    }
    callback(null, true);
  },
};

// ---------------------------------------------------------------------------
// PayloadTooLargeFilter — remaps multer's 413 to the AC-specified 400
// ---------------------------------------------------------------------------

/**
 * `FileInterceptor` (via Nest's `transformException`) maps Multer's
 * `LIMIT_FILE_SIZE` error to the built-in `PayloadTooLargeException` (413).
 * EVT-6's AC2 specifies oversized uploads must return 400, not 413 — remap
 * it here rather than fighting Multer's internals.
 */
@Catch(PayloadTooLargeException)
export class PayloadTooLargeFilter implements ExceptionFilter {
  catch(_exception: PayloadTooLargeException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const badRequest = new BadRequestException('File exceeds the 20 MB upload limit');
    response.status(badRequest.getStatus()).json(badRequest.getResponse());
  }
}
