---
id: EVT-38
title: 'chore(web): small mobile fixes — numeric keypads, sticker overflow, PWA meta, chip targets'
status: Done
priority: low
created_date: '2026-08-14 14:39'
updated_date: '2026-08-14 14:39'
assignee: []
labels:
  - web
  - mobile
  - pwa
dependencies: []
references:
  - apps/web/src/components/CountDialog.tsx
  - apps/web/src/pages/ItemPrintPage.tsx
  - apps/web/index.html
  - apps/web/vite.config.ts
  - apps/web/src/pages/ItemsPage.tsx
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Four small mobile papercuts (2026-08-14 mobile audit, findings #8–#11):

1. **No numeric keypad**: all integer quantity fields use `type='number'` without
   `inputMode`; iOS shows the full keyboard instead of the digit pad. Affects:
   CountDialog (~line 77), ItemDetailPage "Use" dialog (~610), ShoppingListPage
   restock (~169), IntakePage quantity (~540) and barcode add-quantity (~472).
2. **QR sticker overflow**: ItemPrintPage (~line 43) renders the QR at a fixed
   384×384 with 24px padding → 432px needed, horizontal scroll on a 390px phone.
3. **Stale/incomplete PWA head**: no `theme-color` meta, no apple-touch-icon
   (iOS home-screen gets a screenshot icon), no `viewport-fit=cover`; manifest
   `theme_color`/`background_color` still `#1a237e` (pre-blueprint indigo) vs the
   app's actual `#081b30`/`#0b2138` — Android status bar/splash clash.
4. **Filter chip tap targets**: ItemsPage tag chips (~line 184) are 32px —
   below the 44px commitment the theme itself enforces for buttons (theme.ts
   ~183, ~233–239, which includes an invisible-hit-area `::after` pattern for
   small icon buttons that can be extended to clickable chips).

## Goal

Apply the four localized fixes: `inputProps={{ inputMode: 'numeric', pattern:
'[0-9]*' }}` on integer quantity fields; `maxWidth: '100%', height: 'auto'` on
the sticker image (keep width/height attrs for print); theme-color +
apple-touch-icon (180×180) + viewport-fit=cover + manifest palette update;
44px effective hit area for clickable chips (extend the theme ::after trick or
bump height at xs).

## Non-goals

- Any behavioral changes; icon redesign (a padded 180×180 from the existing 512 is fine)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] All five listed quantity fields carry inputMode numeric + digit pattern (asserted in tests)
- [x] ItemPrintPage causes no horizontal scroll at ~390px; print output size unchanged
- [x] index.html has theme-color (blueprint palette), apple-touch-icon 180×180 (file present in public/), viewport-fit=cover; manifest theme/background colors match the blueprint palette
- [x] Clickable filter chips have a ≥44px effective touch target without visual layout breakage
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Four localized mobile fixes from the 2026-08-14 audit (findings #8–#11): `inputMode: 'numeric'` + `pattern: '[0-9]*'` on all five integer quantity fields (CountDialog, ItemDetailPage "Use", ShoppingListPage restock, IntakePage quantity + barcode add-quantity); ItemPrintPage QR sticker now shrinks on narrow viewports (`maxWidth: 100%`, `height: auto`) while keeping its 384×384 print size; index.html gained theme-color (#081b30), a 180×180 apple-touch-icon (generated from the existing 512 icon via sips, seamless pad), and viewport-fit=cover, with the VitePWA manifest palette updated from pre-blueprint indigo to #081b30/#0b2138; clickable MuiChips get an invisible `::after` inset -6px hit-area extension (mirroring the MuiIconButton sizeSmall pattern) for a ≥44px effective touch target.

## Verification
- `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm format:check` — all passed; web suite 273/273, statement coverage 89.61% (>80% threshold)
- apple-touch-icon verified as a genuine 180×180 PNG by test (IHDR check)
- Reviews: 3/3 approved in one iteration (code ✅ 0 findings, test ✅ 3 suggestions, security ✅ 2 suggestions); ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable, Claude-native reviewers)

## Follow-up (documented, non-blocking)
- `pattern` is inert on `type="number"` inputs (keyboard-hint only; no validation regression — clamps and submit guards unchanged)
- Other numeric fields (EditItemPage ×3, ProjectDetailPage ×2) still lack inputMode — candidate follow-up task
- Verify chip spacing on ItemsPage filter rows: the -6px hit-area overlay can overlap controls closer than 6px
