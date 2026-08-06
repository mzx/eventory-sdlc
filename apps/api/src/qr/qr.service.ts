import { Injectable, NotFoundException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Clamp bounds for the `size` query param (pixels, square PNG). */
export const MIN_SIZE = 64;
export const MAX_SIZE = 2048;
export const DEFAULT_SIZE = 512;

/** Fallback WEB origin when `PUBLIC_BASE_URL` is not configured. */
export const DEFAULT_PUBLIC_BASE_URL = 'https://localhost:5173';

// ---------------------------------------------------------------------------
// QrService
// ---------------------------------------------------------------------------

@Injectable()
export class QrService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The WEB origin a scanned sticker should resolve against. Read lazily
   * (not cached in a constructor field) so tests can flip `process.env`
   * between calls without re-instantiating the service.
   */
  private get publicBaseUrl(): string {
    const configured = process.env.PUBLIC_BASE_URL;
    return configured && configured.length > 0 ? configured : DEFAULT_PUBLIC_BASE_URL;
  }

  /**
   * Clamp a raw `size` query param string to `[MIN_SIZE, MAX_SIZE]`.
   * Missing, blank, or non-numeric input falls back to `DEFAULT_SIZE`.
   */
  static clampSize(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') {
      return DEFAULT_SIZE;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_SIZE;
    }
    return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(parsed)));
  }

  /**
   * Render a scannable QR code PNG for `token`, encoding
   * `${PUBLIC_BASE_URL}/r/:token`.
   *
   * 404 when `token` matches neither an item nor a location (prevents
   * printing stickers for orphaned/typo'd tokens).
   */
  async renderPng(token: string, rawSize: string | undefined): Promise<Buffer> {
    await this.assertTokenExists(token);

    const size = QrService.clampSize(rawSize);
    const url = `${this.publicBaseUrl}/r/${token}`;

    return QRCode.toBuffer(url, {
      type: 'png',
      width: size,
      margin: 1,
    });
  }

  /**
   * Throws `NotFoundException` unless `token` is the `qrCode` of an item or
   * a location. Checks items first (same convention as `ItemsService.findByQr`
   * / `LocationsService.findByQr`).
   */
  private async assertTokenExists(token: string): Promise<void> {
    const item = await this.prisma.item.findUnique({
      where: { qrCode: token },
      select: { id: true },
    });
    if (item) {
      return;
    }

    const location = await this.prisma.location.findUnique({
      where: { qrCode: token },
      select: { id: true },
    });
    if (location) {
      return;
    }

    throw new NotFoundException(`No item or location found for QR token: ${token}`);
  }
}
