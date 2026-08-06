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
   * - `?analyze=true` is accepted but ignored — `aiAnalysis` is always
   *   `null` for now; EVT-7 fills it in.
   *
   * Returns the Photo row plus a public `url` the file is served at.
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseFilters(PayloadTooLargeFilter)
  @UseInterceptors(FileInterceptor('file', photoUploadMulterOptions))
  upload(@UploadedFile() file: Express.Multer.File, @Body() body: UploadPhotoDto) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    // aiAnalysis is null on the created row by default (see Photo schema) —
    // the `?analyze` query param is accepted (no DTO error) but has no
    // effect yet; EVT-7 wires up the actual analysis.
    return this.photosService.savePhoto(file, body.itemId);
  }

  /** GET /api/photos/:id — metadata row. 404 when not found. */
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.photosService.findById(id);
  }
}
