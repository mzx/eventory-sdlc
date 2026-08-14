---
id: EVT-37
title: 'fix(web): workshop hot-path mobile friction — intake rows, queue actions, location tree'
status: To Do
priority: medium
created_date: '2026-08-14 14:39'
updated_date: '2026-08-14 14:39'
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
- [ ] Intake photo-step and barcode-match buttons render fully readable (no multi-line crushing) at ~390px, stacked or wrapped
- [ ] Verification and Shopping List rows never overlap action buttons with item text at ~390px; long names truncate with ellipsis
- [ ] Location tree rows at depth ≥2 keep a usable, tappable name at ~390px; secondary actions reachable via overflow menu at xs; desktop unchanged
- [ ] Web tests cover the xs layouts (wrapping/stacking, truncation, overflow menu actions still fire rename/delete); coverage meets the 80% threshold
<!-- AC:END -->
