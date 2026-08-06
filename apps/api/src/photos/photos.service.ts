import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync } from 'fs';
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
  'image/heif': '.heic',
};

/**
 * Ensures the storage directory exists. Called eagerly on module import
 * (multer's diskStorage requires the destination to already exist when the
 * first upload arrives) and again defensively from `savePhoto`.
 */
export function ensureStorageDir(): void {
  mkdirSync(STORAGE_DIR, { recursive: true });
}

ensureStorageDir();

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
   * Reads width/height via `sharp` metadata (best-effort — a metadata read
   * failure degrades to `null` dimensions rather than failing the upload).
   * `aiAnalysis` is always `null`; EVT-7 fills it in.
   */
  async savePhoto(file: UploadedPhotoFile, itemId?: string) {
    ensureStorageDir();
    const { width, height } = await this.readDimensions(file.path);

    try {
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

  private async readDimensions(
    filePath: string,
  ): Promise<{ width: number | null; height: number | null }> {
    try {
      const metadata = await sharp(filePath).metadata();
      return { width: metadata.width ?? null, height: metadata.height ?? null };
    } catch {
      // Not every accepted mimetype is guaranteed decodable by the sharp
      // build in every environment (e.g. HEIC without libheif) — degrade
      // gracefully rather than failing the whole upload.
      return { width: null, height: null };
    }
  }
}
