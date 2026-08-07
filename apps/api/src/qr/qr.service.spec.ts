import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_PUBLIC_BASE_URL, DEFAULT_SIZE, MAX_SIZE, MIN_SIZE, QrService } from './qr.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ITEM_TOKEN = 'item-qr-token';
const LOCATION_TOKEN = 'location-qr-token';

function makePrismaMock() {
  return {
    item: { findUnique: jest.fn() },
    location: { findUnique: jest.fn() },
  };
}

/** Decodes a PNG buffer (as produced by `qrcode`) back to the encoded text. */
function decodeQrPng(buffer: Buffer): string {
  const png = PNG.sync.read(buffer);
  const result = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!result) {
    throw new Error('Failed to decode QR PNG in test');
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('QrService', () => {
  let service: QrService;
  let prismaMock: ReturnType<typeof makePrismaMock>;
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;

  beforeEach(async () => {
    prismaMock = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [QrService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();

    service = module.get<QrService>(QrService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalPublicBaseUrl === undefined) {
      delete process.env.PUBLIC_BASE_URL;
    } else {
      process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
    }
  });

  // =========================================================================
  // clampSize — AC 2 (pure function, no I/O)
  // =========================================================================

  describe('clampSize (AC2: size clamping)', () => {
    it('AC2: size=10 clamps up to 64 (MIN_SIZE)', () => {
      expect(QrService.clampSize('10')).toBe(MIN_SIZE);
      expect(MIN_SIZE).toBe(64);
    });

    it('AC2: size=99999 clamps down to 2048 (MAX_SIZE)', () => {
      expect(QrService.clampSize('99999')).toBe(MAX_SIZE);
      expect(MAX_SIZE).toBe(2048);
    });

    it('defaults to 512 when size is omitted', () => {
      expect(QrService.clampSize(undefined)).toBe(DEFAULT_SIZE);
      expect(DEFAULT_SIZE).toBe(512);
    });

    it('defaults to 512 when size is a blank string', () => {
      expect(QrService.clampSize('')).toBe(DEFAULT_SIZE);
      expect(QrService.clampSize('   ')).toBe(DEFAULT_SIZE);
    });

    it('defaults to 512 when size is not numeric', () => {
      expect(QrService.clampSize('not-a-number')).toBe(DEFAULT_SIZE);
    });

    it('passes through an in-range value unchanged', () => {
      expect(QrService.clampSize('300')).toBe(300);
    });

    it('truncates a fractional value to an integer', () => {
      expect(QrService.clampSize('128.9')).toBe(128);
    });

    it('clamps a negative value up to MIN_SIZE', () => {
      expect(QrService.clampSize('-100')).toBe(MIN_SIZE);
    });

    it('respects the exact boundary values', () => {
      expect(QrService.clampSize(String(MIN_SIZE))).toBe(MIN_SIZE);
      expect(QrService.clampSize(String(MAX_SIZE))).toBe(MAX_SIZE);
    });
  });

  // =========================================================================
  // renderPng — AC 1 + AC 3 (real encode + real decode, small/default sizes)
  // =========================================================================

  describe('renderPng', () => {
    // Real 512px PNG encode + decode can exceed jest's default 5s on slow CI
    // runners — give this test its own generous timeout.
    it('AC1 + AC3: item token → 200 PNG that decodes to ${PUBLIC_BASE_URL}/r/:token', async () => {
      delete process.env.PUBLIC_BASE_URL;
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });

      const png = await service.renderPng(ITEM_TOKEN, undefined);

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(decodeQrPng(png)).toBe(`${DEFAULT_PUBLIC_BASE_URL}/r/${ITEM_TOKEN}`);
    }, 20_000);

    it('default size (no size param) renders a 512x512 PNG', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });

      const png = await service.renderPng(ITEM_TOKEN, undefined);
      const decodedPng = PNG.sync.read(png);

      expect(decodedPng.width).toBe(DEFAULT_SIZE);
      expect(decodedPng.height).toBe(DEFAULT_SIZE);
    });

    it('AC3: location token → 200 PNG (checks location table when item lookup misses)', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue({ id: 'loc-1' });

      // Use MIN_SIZE here purely to keep the real PNG render fast in tests.
      const png = await service.renderPng(LOCATION_TOKEN, String(MIN_SIZE));

      expect(Buffer.isBuffer(png)).toBe(true);
      expect(decodeQrPng(png)).toBe(`${DEFAULT_PUBLIC_BASE_URL}/r/${LOCATION_TOKEN}`);
      expect(prismaMock.item.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { qrCode: LOCATION_TOKEN } }),
      );
    });

    it('checks item table before location table (short-circuits on item hit)', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });
      prismaMock.location.findUnique.mockResolvedValue({ id: 'loc-1' });

      await service.renderPng(ITEM_TOKEN, String(MIN_SIZE));

      expect(prismaMock.location.findUnique).not.toHaveBeenCalled();
    });

    it('AC3: unknown token → throws NotFoundException (404) — item and location both missing', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.renderPng('unknown-token', undefined)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('NotFoundException message mentions the unknown token', async () => {
      prismaMock.item.findUnique.mockResolvedValue(null);
      prismaMock.location.findUnique.mockResolvedValue(null);

      await expect(service.renderPng('mystery-token', undefined)).rejects.toThrow(/mystery-token/);
    });

    it('honors a custom PUBLIC_BASE_URL when encoding the URL', async () => {
      process.env.PUBLIC_BASE_URL = 'https://eventory.example.com';
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });

      const png = await service.renderPng(ITEM_TOKEN, String(MIN_SIZE));

      expect(decodeQrPng(png)).toBe(`https://eventory.example.com/r/${ITEM_TOKEN}`);
    });

    it('AC2: a small requested size clamps to MIN_SIZE and still decodes correctly', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });

      const png = await service.renderPng(ITEM_TOKEN, '10');
      const decodedPng = PNG.sync.read(png);

      // Clamped to MIN_SIZE (64), not the raw requested 10.
      expect(decodedPng.width).toBe(MIN_SIZE);
      expect(decodedPng.height).toBe(MIN_SIZE);
      expect(decodeQrPng(png)).toBe(`${DEFAULT_PUBLIC_BASE_URL}/r/${ITEM_TOKEN}`);
    });

    // AC2's exact boundary values (size=10 → 64, size=99999 → 2048) are
    // asserted precisely by the pure `clampSize` unit tests above. This
    // service-level test proves the *wiring*: `renderPng` forwards the
    // clamped width through to the actual encoder rather than dropping it.
    // Deliberately NOT re-testing the full 2048 boundary here — a real
    // 2048x2048 render is multi-second under ts-jest, which would make the
    // suite unnecessarily slow without adding assurance beyond what
    // `clampSize` (proven above) already covers.
    it('AC2: honors an in-range requested size — wiring from clampSize into the actual render', async () => {
      prismaMock.item.findUnique.mockResolvedValue({ id: 'item-1' });

      const png = await service.renderPng(ITEM_TOKEN, '200');
      const decodedPng = PNG.sync.read(png);

      expect(decodedPng.width).toBe(200);
      expect(decodedPng.height).toBe(200);
    });
  });
});
