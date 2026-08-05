---
id: EVT-11
title: 'feat(web): photo intake flow — camera capture → AI draft → confirm → saved item with QR'
status: To Do
labels: [web, intake, ai]
dependencies: [EVT-7, EVT-9, EVT-10]
references: [PRODUCT.md]
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

This is the signature flow of the product: photograph a thing, confirm the AI draft, done.

## Goal

**IntakePage** (`/intake`, launched from the AppBar "Add item" action):

1. Photo step: `<input type="file" accept="image/*" capture="environment">` (opens phone
   camera directly; file picker on desktop). Preview before upload. "Skip photo" path
   for manual entry.
2. Upload to `POST /api/photos/upload?analyze=true` with progress indicator and a
   "Analyzing…" state.
3. Form step: same form fields as EditItemPage, PREFILLED from `aiAnalysis`
   (suggested_name → name, tags, quantity, unit, color merged into properties,
   properties, description). Visibly marked as AI draft ("check before saving").
   `search_keywords` appended to description or kept as a hidden searchable field —
   implementer's choice, but they must be searchable via EVT-3 search.
4. Optional `?locationId=` query param pre-selects the location (used by
   "Add item here" from the location page, EVT-12).
5. Save → `POST /api/items` with `photoIds` → navigate to the new ItemDetailPage,
   toast with "Print QR" shortcut.

## Non-goals

- Multi-photo intake in one pass, batch intake, offline queue
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Desktop flow with stub AI (no key): upload → form prefilled with stub → save → detail page shows photo as primary
- [ ] With `?locationId=` the location field is pre-selected and saved
- [ ] AI failure/timeout degrades to empty form with photo attached (never blocks saving)
- [ ] Component test: form prefill mapping from a canned aiAnalysis fixture
<!-- AC:END -->
