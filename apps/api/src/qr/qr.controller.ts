import { Controller, Get, HttpStatus, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { QrService } from './qr.service';

@Controller('qr')
export class QrController {
  constructor(private readonly qrService: QrService) {}

  /**
   * GET /api/qr/:token?size=512
   *
   * Renders a scannable QR code PNG encoding `${PUBLIC_BASE_URL}/r/:token`.
   * `size` (pixels, square) clamps to [64, 2048]; defaults to 512.
   *
   * 404 when `token` matches neither an item nor a location.
   *
   * Manual `@Res()` handling (rather than a return value) because the body is
   * a raw binary PNG buffer, not JSON — Nest's default reply serializer would
   * otherwise treat it as a JSON-serializable object.
   */
  @Get(':token')
  async render(
    @Param('token') token: string,
    @Query('size') size: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const png = await this.qrService.renderPng(token, size);

    res.set({
      'Content-Type': 'image/png',
      // Token is immutable (uuid, never reissued) — safe to cache indefinitely.
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.status(HttpStatus.OK).send(png);
  }
}
