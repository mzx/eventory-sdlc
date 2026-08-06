import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync } from 'fs';
import { unlink } from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Storage constants — shared with photo-upload.helpers.ts (multer config)
// and main.ts (static-asset serving).
// ---------------------------------------------------------------------------

/**
 * Absolute path to the on-disk photo storage directory.
 *
 * Resolved relative to `process.cwd()`, which is `apps/api/` in every
 * runtime mode this app runs in:
 * - `pnpm --filter @eventory/api run start:dev` / `test` (pnpm sets cwd to
 *   the package dir for filtered/workspace-recursive scripts)
 * - the production Docker image (`Dockerfile` sets `WORKDIR
 *   /workspace/apps/api` before `CMD node dist/main.js`)
 *
 * `docker-compose.yml` mounts a named volume at this path in the `api`
 * service so uploaded photos survive `docker compose down && up` (AC 4).
 */
export const STORAGE_DIR = path.resolve(process.cwd(), 'storage');

/** Public URL prefix static files are served under (see main.ts bootstrap). */
export const STORAGE_URL_PREFIX = '/storage';

/** Max accepted upload size: 20 MB. */
export const MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024;

/** Accepted photo MIME types (jpeg/png/webp/heic per EVT-6 scope). */
export const ALLOWED_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

/** File extension to write for each accepted MIME type. */
export const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  // `image/heif` is a distinct mimetype/extension from `image/heic` (both
  // are HEIF-family containers, but the extension should reflect what the
  // client declared rather than collapsing both onto `.heic`) — serving a
  // heif upload back with a `.heic` filename mislabels its format.
  'image/heif': '.heif',
};

/**
 * Ensures the storage directory exists. Called once, eagerly, on module
 * import — before Multer's diskStorage ever needs it, since the storage
 * engine requires the destination to already exist when the first upload
 * arrives. `savePhoto` used to call this again per-upload defensively, but
 * that's redundant: nothing in this module removes `STORAGE_DIR` after
 * process start, so a second directory-existence check on every request
 * bought no additional safety.
 */
export function ensureStorageDir(): void {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

ensureStorageDir();

/**
 * Sharp's decoded `format` for each mimetype we can reliably validate the
 * *actual bytes* of. Deliberately excludes `image/heic` / `image/heif` — see
 * the carve-out comment on `readDimensions` below.
 */
const SHARP_FORMAT_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Builds the public URL for a stored filename. */
export function publicUrlFor(filename: string): string {
  return `${STORAGE_URL_PREFIX}/${filename}`;
}

// ---------------------------------------------------------------------------
// PhotosService
// ---------------------------------------------------------------------------

/** Minimal shape of `Express.Multer.File` this service needs (keeps tests light). */
export interface UploadedPhotoFile {
  filename: string;
  path: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class PhotosService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // savePhoto — POST /api/photos/upload
  // -------------------------------------------------------------------------

  /**
   * Persists a Photo row for a file multer has already written to disk.
   *
   * Reads width/height via `sharp` metadata — for the mimetypes we can
   * reliably validate (jpeg/png/webp) a decode failure or format mismatch
   * *rejects* the upload (see `readDimensions`), since `fileFilter` only
   * checked the client-supplied `Content-Type` header, not the actual
   * bytes. `aiAnalysis` is always `null`; EVT-7 fills it in.
   *
   * On any failure past this point — decode rejection or a DB error — the
   * file Multer already wrote to `STORAGE_DIR` is unlinked so rejected /
   * failed uploads don't accumulate as orphaned disk usage.
   */
  async savePhoto(file: UploadedPhotoFile, itemId?: string) {
    try {
      const { width, height } = await this.readDimensions(file.path, file.mimetype);
      const photo = await this.prisma.photo.create({
        data: {
          filename: file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          width,
          height,
          ...(itemId && { itemId }),
        },
      });
      return this.withUrl(photo);
    } catch (err) {
      await this.unlinkQuietly(file.path);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new BadRequestException(`Item ${itemId} not found`);
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // findById — GET /api/photos/:id
  // -------------------------------------------------------------------------

  async findById(id: string) {
    const photo = await this.prisma.photo.findUnique({ where: { id } });
    if (!photo) {
      throw new NotFoundException(`Photo ${id} not found`);
    }
    return this.withUrl(photo);
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private withUrl<T extends { filename: string }>(photo: T): T & { url: string } {
    return { ...photo, url: publicUrlFor(photo.filename) };
  }

  /**
   * Reads width/height via `sharp` metadata, and — for the mimetypes listed
   * in `SHARP_FORMAT_BY_MIME_TYPE` — validates that sharp actually decoded
   * the bytes as the declared format.
   *
   * `fileFilter` in `photo-upload.helpers.ts` only inspects the
   * client-supplied `Content-Type` header; nothing before this point
   * confirms the uploaded bytes are really an image. Without this check,
   * arbitrary bytes declared `image/png` would be persisted and served
   * back to the public `/storage/*` prefix. For jpeg/png/webp — formats
   * this sharp build reliably decodes — a decode failure or a
   * decoded-format mismatch is treated as a rejected upload.
   *
   * HEIC/HEIF carve-out: whether this sharp/libvips build can decode HEIC
   * (HEVC-coded) bytes depends on the platform's libheif build (the AVIF
   * flavor of the HEIF container decodes fine here, but real-world iPhone
   * HEIC photos use HEVC coding, which is not guaranteed available — see
   * EVT-6 review). We can't reliably distinguish "legitimate HEIC our
   * build can't decode" from "garbage bytes" for this mimetype, so rather
   * than silently accepting garbage under a false sense of validation, we
   * explicitly do NOT reject on decode failure for heic/heif and instead
   * degrade to `null` dimensions, same as before this change.
   */
  private async readDimensions(
    filePath: string,
    mimetype: string,
  ): Promise<{ width: number | null; height: number | null }> {
    const expectedFormat = SHARP_FORMAT_BY_MIME_TYPE[mimetype];
    try {
      const metadata = await sharp(filePath).metadata();
      if (expectedFormat && metadata.format !== expectedFormat) {
        throw new BadRequestException(
          `Uploaded file does not contain valid ${mimetype} image data`,
        );
      }
      return { width: metadata.width ?? null, height: metadata.height ?? null };
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      if (expectedFormat) {
        // sharp couldn't decode bytes declared as a format we know this
        // build supports — reject rather than persist unverifiable/garbage
        // bytes under an image mimetype.
        throw new BadRequestException(
          `Uploaded file does not contain valid ${mimetype} image data`,
        );
      }
      // HEIC/HEIF carve-out (see doc comment above) — degrade gracefully.
      return { width: null, height: null };
    }
  }

  /** Best-effort cleanup of a file already written to disk by Multer. */
  private async unlinkQuietly(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Don't mask the original failure with a cleanup error — e.g. the
      // file may already be gone, or the path may be unwritable.
    }
  }
}
