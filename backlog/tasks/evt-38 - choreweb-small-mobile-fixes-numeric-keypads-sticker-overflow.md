---
id: EVT-38
title: 'chore(web): small mobile fixes — numeric keypads, sticker overflow, PWA meta, chip targets'
status: To Do
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
- [ ] All five listed quantity fields carry inputMode numeric + digit pattern (asserted in tests)
- [ ] ItemPrintPage causes no horizontal scroll at ~390px; print output size unchanged
- [ ] index.html has theme-color (blueprint palette), apple-touch-icon 180×180 (file present in public/), viewport-fit=cover; manifest theme/background colors match the blueprint palette
- [ ] Clickable filter chips have a ≥44px effective touch target without visual layout breakage
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
