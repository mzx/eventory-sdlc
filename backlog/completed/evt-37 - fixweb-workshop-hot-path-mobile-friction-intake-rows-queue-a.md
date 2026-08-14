---
id: EVT-37
title: 'fix(web): workshop hot-path mobile friction — intake rows, queue actions, location tree'
status: Done
priority: medium
created_date: '2026-08-14 14:39'
updated_date: '2026-08-15 00:15'
assignee: []
labels:
  - web
  - mobile
  - bug
dependencies: []
references:
  - apps/web/src/pages/IntakePage.tsx
  - apps/web/src/pages/VerificationPage.tsx
  - apps/web/src/pages/ShoppingListPage.tsx
  - apps/web/src/components/LocationTree.tsx
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Three friction points on the phone hot paths (2026-08-14 mobile audit,
findings #5–#7):

1. **IntakePage non-wrapping action rows** (~line 408): the photo-step buttons
   ("Take photo"/"Retake photo", "Choose image", "Skip photo") and the
   barcode-match row ("Add to existing" + "Create new item instead", ~line 488)
   are `Stack direction='row'` with no wrap; with the uppercase mono button font
   they need 400–500px+ and crush into multi-line fragments at 390px.
2. **Queue list action overlap**: VerificationPage (~line 106) and
   ShoppingListPage (~line 133) put wide outlined buttons ("Count", "Restocked")
   in `ListItem secondaryAction`, which reserves only 48px — the ~90–130px
   buttons overlap item names on 390px screens, exactly mid-count/mid-shopping.
3. **LocationTree rows cramped at depth** (~line 137): 5 always-visible controls
   (~190–210px fixed) + `pl: depth*3` indentation leave <100px for the name at
   depth 2 and ~nothing at depth 3+; the inline add-child row (~line 223) is
   similarly over-wide.

## Goal

- Intake rows: `flexWrap: 'wrap'` or `direction={{ xs: 'column', sm: 'row' }}`
  with fullWidth buttons at xs (the page is already a maxWidth-480 column)
- Queue lists: reserve real space (e.g. `pr: 14` on ListItem) or restructure to
  a flex row with `minWidth: 0` + noWrap truncation so action buttons never
  overlap text
- LocationTree at xs: move rename/delete (and optionally add-child) behind one
  overflow IconButton + Menu per row; name gets `minWidth: 0` + noWrap; cap
  visual indent (e.g. `pl: Math.min(depth, 3) * 1.5`)

## Non-goals

- Any behavior/API changes — layout only
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Intake photo-step and barcode-match buttons render fully readable (no multi-line crushing) at ~390px, stacked or wrapped
- [x] Verification and Shopping List rows never overlap action buttons with item text at ~390px; long names truncate with ellipsis
- [x] Location tree rows at depth ≥2 keep a usable, tappable name at ~390px; secondary actions reachable via overflow menu at xs; desktop unchanged
- [x] Web tests cover the xs layouts (wrapping/stacking, truncation, overflow menu actions still fire rename/delete); coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

### Summary
Fixed the three mobile hot-path friction points: IntakePage's photo-step and barcode-match button rows now stack (column, full-width) below `sm` instead of crushing at 390px; VerificationPage/ShoppingListPage queue rows moved off `secondaryAction` into a flex row with `minWidth: 0` + `noWrap` truncation so the Count/Restocked buttons never overlap long item names; LocationTree caps visual indent at xs only (desktop keeps `depth * 3`), truncates names, and moves rename/add-child/delete behind one overflow menu at xs while leaving desktop's inline icon buttons untouched.

### Changes
- `apps/web/src/pages/IntakePage.tsx` — photo-step + barcode-match rows: responsive `direction={{ xs: 'column', sm: 'row' }}` with full-width buttons at xs
- `apps/web/src/pages/VerificationPage.tsx` — queue rows restructured off `secondaryAction`; `minWidth: 0` + `noWrap` truncation
- `apps/web/src/pages/ShoppingListPage.tsx` — same restructure as VerificationPage
- `apps/web/src/components/LocationTree.tsx` — xs-gated indent cap (`{ xs: Math.min(depth,3)*1.5, sm: depth*3 }`), name truncation, xs overflow menu (Tooltip'd) for rename/add-child/delete, deferred-rename timer cleaned up on unmount
- `apps/web/src/test/responsiveStyle.ts` — new test helper reading emitted emotion CSS so breakpoint toggles are genuinely assertable in jsdom
- Four test suites extended: xs stacking, truncation, overflow-menu handler wiring, breakpoint-exclusivity + indent-cap style assertions

### Design decisions
- Overflow-menu Rename defers `startRename()` via `setTimeout(fn, 0)` (documented inline) to avoid MUI Menu focus-restoration re-focusing the anchor and blurring the fresh rename TextField; timer id is cleared on unmount.
- Breakpoint exclusivity can't be asserted via `getComputedStyle` in jsdom, so tests assert the emitted per-breakpoint CSS rules directly (mutation-tested by the reviewer: deleting the toggles fails the tests).

### Verification
- `pnpm build` — passed
- `pnpm test` — passed (apps/web 274/274 direct; apps/api qr.service PNG-encode timeouts reproduce on base, pre-existing)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved in round 2 (round 1 found 2 majors, both fixed) — ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable, fell back to claude-code)
- Post-rebase onto EVT-36: no file overlap, web suite re-verified (flakes in untouched files are environmental/pre-existing)

### Follow-up
(none)
