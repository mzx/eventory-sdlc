import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsUUID } from 'class-validator';
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
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(PayloadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', photoUploadMulterOptions))
  upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadPhotoDto,
    @Query('analyze') analyze?: string,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    return this.photosService.savePhoto(file, body.itemId, analyze === 'true');
  }

  /** GET /api/photos/:id — metadata row. 404 when not found. */
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.photosService.findById(id);
  }
}
