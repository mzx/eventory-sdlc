---
id: EVT-11
title: 'feat(web): photo intake flow — camera capture → AI draft → confirm → saved item with QR'
status: Done
labels: [web, intake, ai]
dependencies: [EVT-7, EVT-9, EVT-10]
references: [PRODUCT.md]
priority: high
updated_date: '2026-08-07 07:18'
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
- [x] Desktop flow with stub AI (no key): upload → form prefilled with stub → save → detail page shows photo as primary
- [x] With `?locationId=` the location field is pre-selected and saved
- [x] AI failure/timeout degrades to empty form with photo attached (never blocks saving)
- [x] Component test: form prefill mapping from a canned aiAnalysis fixture
<!-- AC:END -->

## Final Summary

## Summary
Implemented the IntakePage photo-intake flow: photo step (camera-capable file input with `capture="environment"`, preview, "Skip photo" manual path) → upload to `POST /api/photos/upload?analyze=true` with an "Analyzing…" state → form step reusing EditItemPage's field set prefilled from the AI draft (suggested_name → name, tags, quantity/unit, color merged into properties, description with search_keywords appended so they stay ILIKE-searchable per EVT-3), visibly marked as an AI draft → `?locationId=` pre-selects the location (validated against the user's loaded locations list) → save POSTs `createItem` with `photoIds` so the uploaded photo becomes primary → navigates to ItemDetailPage, which shows a "Print QR" Snackbar for freshly created items via router state.

## Changes
- `apps/web/src/api.ts` — `uploadPhoto` gained an `analyze` param; `UploadedPhoto.aiAnalysis` optional field; new `createItem`.
- `apps/web/src/pages/IntakePage.tsx` — full intake flow (was a stub): photo step, analyzed upload with plain-upload fallback, AI-draft-prefilled form, locationId validation, object-URL cleanup.
- `apps/web/src/pages/IntakePage.test.tsx` — component tests covering all four ACs, incl. canned aiAnalysis prefill fixture.
- `apps/web/src/pages/ItemDetailPage.tsx` — "Print QR" Snackbar driven by `justCreated` router state.
- `apps/web/src/pages/ItemDetailPage.test.tsx` — tests for the Snackbar (appears with state, navigates to print route, absent without state).

## Design decisions
- search_keywords are appended to the description ("Keywords: …") rather than a hidden field — description is already covered by EVT-3 ILIKE search and this avoids a new schema-adjacent convention.
- If the analyzed upload fails outright (network), the page retries as a plain unanalyzed upload so the photo still attaches and the form comes up empty rather than blocking the save (AC 3).
- `?locationId=` only seeds after the locations query resolves and the id validates against the user's own locations (fails closed; prevents crafted-link mis-filing).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (apps/web 66/66 incl. new tests; apps/api 367/367)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

## Follow-up
(none blocking) Reviewer suggestions left open: test for bogus `?locationId=` being dropped, file-picker-cancel branch coverage, encodeURIComponent in the shared `photoUrl` helper, server-side authorization of `locationId` on POST /api/items noted as defence-in-depth.
