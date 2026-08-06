import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync } from 'fs';
import { readFile, unlink } from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { AiAnalysisResult, AiService, stubAnalysis } from '../ai/ai.service';
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

/**
 * Max file size, in bytes, eligible for `?analyze=true` Claude vision
 * analysis — independent of and stricter than `MAX_UPLOAD_SIZE_BYTES`.
 *
 * A file at the 20 MB upload ceiling would base64-encode to ~27 MB
 * (base64 is ~4/3 the input size), and Anthropic rejects base64 image
 * payloads above ~5 MB anyway. Enforcing this ceiling *before* reading the
 * file into memory / encoding it avoids paying that cost (and, combined
 * with finding 1's throttling, narrows the cost-amplification surface of
 * an unauthenticated `?analyze=true` caller) for a request that would fail
 * regardless (EVT-7 review round 2, finding 3).
 */
export const MAX_ANALYSIS_SIZE_BYTES = 5 * 1024 * 1024;

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
  private readonly logger = new Logger(PhotosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiService: AiService,
  ) {}

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
   * bytes.
   *
   * When `analyze` is true, runs Claude vision analysis (`AiService`) and
   * persists the raw structured result to `Photo.aiAnalysis`; otherwise
   * `aiAnalysis` stays `null`. `AiService.analyzePhoto` never throws (it
   * degrades to a stub on any failure), so analysis never blocks an
   * otherwise-valid upload.
   *
   * On any failure past this point — decode rejection or a DB error — the
   * file Multer already wrote to `STORAGE_DIR` is unlinked so rejected /
   * failed uploads don't accumulate as orphaned disk usage.
   */
  async savePhoto(file: UploadedPhotoFile, itemId?: string, analyze = false) {
    try {
      const { width, height } = await this.readDimensions(file.path, file.mimetype);
      // Pre-validate itemId before paying for a billed AI call —
      // `photo.create`'s own FK-violation handling below (P2003 → 400)
      // remains the source of truth for the final persisted row; this is a
      // cheap short-circuit for the case this task actually cares about:
      // `analyze=true` previously ran the vision call before Prisma ever
      // got a chance to reject an invalid FK (EVT-7 review round 2,
      // finding 5). Skipped when `analyze` is false since there's no
      // billed call to protect and `photo.create` already validates the FK
      // for free in that path.
      if (analyze && itemId) {
        await this.assertItemExists(itemId);
      }
      // undefined (not null) when `analyze` is false, so the `data` object
      // below omits the key entirely and the column keeps its schema
      // default (null) — matching the shape callers/tests rely on when
      // analysis wasn't requested.
      const aiAnalysis = analyze ? await this.analyzePhoto(file) : undefined;
      const photo = await this.prisma.photo.create({
        data: {
          filename: file.filename,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          width,
          height,
          ...(aiAnalysis !== undefined && {
            aiAnalysis: aiAnalysis as unknown as Prisma.InputJsonValue,
          }),
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
   * Reads the file Multer already wrote to disk and runs Claude vision
   * analysis on it. `AiService.analyzePhoto` never throws (it degrades to
   * a stub on any internal failure); a `readFile` failure here is the only
   * way this can reject, which propagates to the same catch in
   * `savePhoto` that unlinks the file — appropriate, since something is
   * already wrong with the file on disk at that point.
   *
   * Files over `MAX_ANALYSIS_SIZE_BYTES` skip analysis entirely — no
   * `readFile`, no base64 encode, no `AiService` call — and get the same
   * "not analyzed" stub signal `AiService` returns for an unsupported MIME
   * type (EVT-7 review round 2, finding 3).
   */
  private async analyzePhoto(file: UploadedPhotoFile): Promise<AiAnalysisResult> {
    if (file.size > MAX_ANALYSIS_SIZE_BYTES) {
      this.logger.log(
        `Skipping AI analysis for ${file.filename} (${file.size} bytes exceeds the ${MAX_ANALYSIS_SIZE_BYTES}-byte analysis ceiling) — returning stub`,
      );
      return stubAnalysis('oversized');
    }
    const buffer = await readFile(file.path);
    this.logger.log(`Running AI analysis for ${file.filename}`);
    return this.aiService.analyzePhoto(buffer, file.mimetype);
  }

  /**
   * Cheap `itemId` FK pre-check invoked only from the `analyze && itemId`
   * branch of `savePhoto` — see the call site for why.
   */
  private async assertItemExists(itemId: string): Promise<void> {
    const item = await this.prisma.item.findUnique({
      where: { id: itemId },
      select: { id: true },
    });
    if (!item) {
      throw new BadRequestException(`Item ${itemId} not found`);
    }
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
