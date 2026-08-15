import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { theme } from './theme';

// EVT-38 finding #11 — ItemsPage filter/tag chips are 32px tall (MUI's
// default Chip size), below the 44px gloved-thumb commitment MuiButton and
// MuiIconButton's sizeSmall already enforce elsewhere in this theme. Mirrors
// the invisible ::after hit-area trick MuiIconButton's sizeSmall uses.
describe('theme — MuiChip clickable hit target (EVT-38 AC4)', () => {
  it('extends clickable chips to a >=44px effective hit area via an invisible ::after overlay', () => {
    const chipOverrides = theme.components?.MuiChip?.styleOverrides as
      | Record<string, Record<string, unknown>>
      | undefined;
    expect(chipOverrides).toBeDefined();

    const clickable = chipOverrides!.clickable;
    expect(clickable).toBeDefined();
    expect(clickable.position).toBe('relative');

    const after = clickable['&::after'] as Record<string, unknown>;
    expect(after).toBeDefined();
    expect(after.content).toBe('""');
    expect(after.position).toBe('absolute');

    // A 32px-tall default Chip + a 6px inset on every side = 44px effective
    // hit area (matches MuiIconButton sizeSmall's identical -6 inset).
    expect(after.inset).toBe(-6);
    const insetPx = Math.abs(after.inset as number);
    expect(32 + insetPx * 2).toBeGreaterThanOrEqual(44);
  });

  it('does not change the drawn (visual) chip styles — only adds the invisible overlay', () => {
    const chipOverrides = theme.components?.MuiChip?.styleOverrides as
      | Record<string, Record<string, unknown>>
      | undefined;
    const clickable = chipOverrides!.clickable;
    // Only position + the pseudo-element overlay — no size/padding/border
    // changes that would alter the chip's drawn appearance.
    expect(Object.keys(clickable).sort()).toEqual(['&::after', 'position']);
  });
});

// EVT-38 finding #10 — stale/incomplete PWA head: no theme-color, no
// apple-touch-icon (iOS home-screen falls back to a screenshot icon), no
// viewport-fit=cover; the manifest's theme_color/background_color were
// still the pre-blueprint indigo, clashing with the app's actual
// drawn-blueprint palette (theme.ts APPBAR/CANVAS) on Android's status
// bar/splash screen. Read the source text of index.html / vite.config.ts
// rather than importing them — vite.config.ts in particular has build-time
// side effects (resolveBuildVersion, cert probing) irrelevant here.
const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(webRoot, 'index.html'), 'utf-8');
const viteConfigSource = readFileSync(join(webRoot, 'vite.config.ts'), 'utf-8');

describe('index.html — PWA head (EVT-38 AC3)', () => {
  it('sets viewport-fit=cover alongside the existing width/initial-scale viewport meta', () => {
    expect(indexHtml).toMatch(
      /<meta name="viewport" content="width=device-width, initial-scale=1\.0, viewport-fit=cover" \/>/,
    );
  });

  it('sets theme-color to the blueprint title-block color, not the pre-blueprint indigo', () => {
    expect(indexHtml).toMatch(/<meta name="theme-color" content="#081b30" \/>/);
    expect(indexHtml).not.toContain('#1a237e');
  });

  it('links a 180x180 apple-touch-icon so iOS home-screen gets a real icon, not a screenshot', () => {
    expect(indexHtml).toMatch(
      /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/,
    );
  });

  it('the linked apple-touch-icon.png exists in public/ and is exactly 180x180', () => {
    const iconPath = join(webRoot, 'public', 'apple-touch-icon.png');
    expect(statSync(iconPath).isFile()).toBe(true);

    // PNG IHDR: bytes 16-19 = width (big-endian uint32), 20-23 = height.
    const buf = readFileSync(iconPath);
    expect(buf.readUInt32BE(16)).toBe(180);
    expect(buf.readUInt32BE(20)).toBe(180);
  });
});

describe('vite.config.ts — VitePWA manifest palette (EVT-38 AC3)', () => {
  it('theme_color matches the blueprint title-block color (theme.ts APPBAR)', () => {
    expect(viteConfigSource).toMatch(/theme_color:\s*'#081b30'/);
  });

  it('background_color matches the blueprint canvas color (theme.ts CANVAS)', () => {
    expect(viteConfigSource).toMatch(/background_color:\s*'#0b2138'/);
  });

  it('no longer references the pre-blueprint indigo', () => {
    expect(viteConfigSource).not.toContain('#1a237e');
  });
});
