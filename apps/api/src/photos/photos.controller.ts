import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsUUID } from 'class-validator';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { uploadThrottlerConfig } from '../common/throttle.config';
import { CurrentWorkspace, WorkspaceContext } from '../workspace/workspace-context';
import { WorkspaceWriteGuard } from '../workspace/workspace-write.guard';
import { photoUploadMulterOptions, PayloadTooLargeFilter } from './photo-upload.helpers';
import { PhotosService } from './photos.service';

/**
 * Non-file form fields of `POST /api/photos/upload` (the `file` field itself
 * is handled by multer via `FileInterceptor`, not class-validator).
 */
export class UploadPhotoDto {
  /** Optional Item UUID to link the photo to immediately. */
  @IsOptional()
  @IsUUID()
  itemId?: string;
}

@Controller('photos')
export class PhotosController {
  constructor(private readonly photosService: PhotosService) {}

  /**
   * POST /api/photos/upload
   *
   * Multipart upload (`file` field, optional `itemId` field to link
   * immediately). Accepts jpeg/png/webp/heic up to 20 MB.
   * - Wrong mimetype → 415.
   * - Oversized (>20 MB) → 400.
   * - `?analyze=true` runs Claude vision analysis and persists the raw
   *   result to `Photo.aiAnalysis` (see `AiService.analyzePhoto`). Without
   *   the flag `aiAnalysis` stays `null`. The result is a DRAFT for the
   *   intake form — nothing is auto-created from it.
   *
   * Returns the Photo row plus a public `url` the file is served at.
   * `uploadedById` is stamped from the caller's session (EVT-14). Persisted
   * into the caller's active workspace (EVT-40) — when `itemId` is
   * provided it must belong to the same workspace (400 otherwise). Mutating
   * — a `viewer` gets 403 (EVT-40 AC 5).
   *
   * Rate-limited more strictly than the app-wide default (10/min per IP by
   * default, env-tunable — see `common/throttle.config.ts`) since this
   * route can trigger a billed Anthropic vision call; this route now also
   * requires an approved user (EVT-14 global guard), which narrows — but
   * does not replace — the throttle as a defense against runaway spend; see
   * EVT-7 review round 2, finding 1.
   */
  @Post('upload')
  @UseGuards(WorkspaceWriteGuard)
  @Throttle(uploadThrottlerConfig())
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(new PayloadTooLargeFilter())
  @UseInterceptors(FileInterceptor('file', photoUploadMulterOptions))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPhotoDto,
    @Query('analyze') analyze: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.photosService.savePhoto(
      file,
      body.itemId,
      analyze === 'true',
      user.id,
      workspace.id,
    );
  }

  /**
   * GET /api/photos/:id — metadata row. 404 when not found OR belonging to
   * a different workspace (EVT-40 AC 3).
   */
  @Get(':id')
  findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ) {
    return this.photosService.findById(id, workspace.id);
  }

  /**
   * DELETE /api/photos/:id
   *
   * Removes a photo (row + on-disk file). If it was an item's primary
   * photo, `Item.primaryPhotoId` is cleared automatically (schema
   * `onDelete: SetNull`). 404 when the photo does not exist OR belongs to a
   * different workspace (EVT-40 AC 3). Mutating — a `viewer` gets 403
   * (EVT-40 AC 5).
   */
  @Delete(':id')
  @UseGuards(WorkspaceWriteGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentWorkspace() workspace: WorkspaceContext,
  ): Promise<void> {
    return this.photosService.remove(id, workspace.id);
  }
}
