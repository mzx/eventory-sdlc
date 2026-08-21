# Eventory brand assets

Pure vector, hand-authored SVG. No font dependency — the wordmark is drawn as
monoline stroke paths, so it renders identically everywhere.

## The mark

A three-drawer workshop cabinet that also reads as an **E**: the case forms the
stem, the drawer fronts form the arms, and a handle slot is knocked *through*
each front (`fill-rule="evenodd"`), so the slots stay transparent on any
background. The middle drawer carries the cyan accent — the theme's "live line".

It is drawn on the same grid as [`apps/web/src/theme.ts`](../apps/web/src/theme.ts):
sharp corners, flat fills, no gradients, no shadows.

## Files

| File | Use |
| --- | --- |
| `eventory-logo-horizontal.svg` | Primary lockup — app bar, headers, docs (dark surfaces) |
| `eventory-logo-horizontal-navy.svg` | Same, for light surfaces |
| `eventory-logo-stacked.svg` | Square-ish contexts — splash, README hero, print |
| `eventory-logo-stacked-navy.svg` | Same, for light surfaces |
| `eventory-mark.svg` | Mark alone (dark surfaces) |
| `eventory-mark-navy.svg` | Mark alone (light surfaces) |
| `eventory-mark-mono.svg` | Single colour via `currentColor` — inline in JSX, inherits `color` |
| `eventory-icon-tile.svg` | App / PWA icon: navy drafting paper + grid, padded for maskable |
| `favicon.svg` | Full-bleed, simplified (handle slots dropped — sub-pixel at 16px) |
| `preview.html` | Open in a browser to see every variant, both backgrounds, size tests |

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| canvas | `#0B2138` | drafting paper — the navy in the tile/favicon |
| title block | `#081B30` | app bar, `theme-color` |
| ink | `#E8F2FB` | line work on dark |
| accent | `#64D2FF` | the middle drawer, focus, actions |

## Rules

- **Clear space** — keep one drawer-front height (¼ of the mark's height) clear
  on all sides.
- **Minimum size** — mark 16px, horizontal lockup 96px wide. Below the lockup
  minimum, use the mark alone.
- Never recolour the accent drawer to anything but `#64D2FF`, restack the
  drawers, round the corners, or add a shadow — the theme is flat line work and
  the elevation ramp is deliberately empty.
- On a photo or busy surface, use `eventory-icon-tile.svg` rather than the bare
  mark.

## Raster exports

The SVGs are the source of truth. To regenerate the PWA PNGs in
`apps/web/public/icons/`:

```bash
rsvg-convert -w 192 -h 192 brand/eventory-icon-tile.svg -o apps/web/public/icons/pwa-192.png
rsvg-convert -w 512 -h 512 brand/eventory-icon-tile.svg -o apps/web/public/icons/pwa-512.png
rsvg-convert -w 180 -h 180 brand/eventory-icon-tile.svg -o apps/web/public/apple-touch-icon.png
```
