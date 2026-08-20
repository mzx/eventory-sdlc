import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { STORAGE_DIR } from './photos.service';

/**
 * Authenticated photo file serving (EVT-40) — `GET /storage/:filename`.
 *
 * Replaces the plain `express.static` middleware `main.ts` previously wired
 * up for this prefix. That middleware ran entirely OUTSIDE Nest's routing
 * pipeline (registered as raw Express middleware before Nest's own router
 * ever gets a chance to run), so it bypassed EVERY Nest guard — including
 * the global `JwtAuthGuard` — meaning any caller who could guess/observe a
 * filename could fetch it with no authentication at all. This controller is
 * a real Nest route, so it goes through the full guard chain
 * (`JwtAuthGuard` then `WorkspaceContextGuard`) same as everything else, and
 * additionally checks the requested file's owning `Photo.workspaceId`
 * against the caller's active workspace (EVT-40 AC 3 — "the guessed-URL
 * surface"): 404 for a foreign photo, same as `PhotosService.findById`.
 *
 * Stays mounted at `/storage/*` (no `/api` prefix) via the `exclude` entry
 * on `app.setGlobalPrefix('api', { exclude: [...] })` in `main.ts` — the
 * web app's `STORAGE_URL_PREFIX` constant and the Vite dev proxy both
 * assume this exact path shape, so changing it would be a much larger,
 * unrelated blast radius than this task's scope.
 */
@Controller('storage')
export class StorageController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Res() res: Response,
  ): Promise<void> {
    const photo = await this.prisma.photo.findFirst({
      where: { filename, workspaceId: workspace.id },
      select: { filename: true, mimeType: true },
    });
    if (!photo) {
      throw new NotFoundException();
    }

    res.set({
      'Content-Type': photo.mimeType,
      // Uploaded files never change once written (EVT-6) — safe to cache
      // indefinitely. `private` (not `public`, EVT-40 round-2 review,
      // security finding 5) — these bytes are now authorization-dependent
      // (scoped to the caller's workspace above), so a shared/intermediate
      // cache (e.g. a CDN or corporate proxy) must never serve a response
      // cached for one workspace's caller back to a different workspace's
      // caller; only the requesting browser's own cache may keep it.
      'Cache-Control': 'private, max-age=31536000, immutable',
      // Same defense as the previous `express.static` setup (main.ts):
      // prevents a browser from MIME-sniffing a user-supplied file into
      // something other than its declared content type.
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(path.join(STORAGE_DIR, photo.filename));
  }
}
