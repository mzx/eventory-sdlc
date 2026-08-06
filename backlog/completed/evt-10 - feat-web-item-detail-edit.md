---
id: EVT-10
title: 'feat(web): Item detail + edit — photos, properties, tags, location picker, QR sticker'
status: Done
labels: [web, items]
dependencies: [EVT-9, EVT-8]
references: [PRODUCT.md]
priority: medium
updated_date: '2026-08-06 17:30'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Cards on the list go nowhere; items can't be inspected or corrected.

## Goal

- **ItemDetailPage** (`/items/:id`): photo gallery (primary first), name, quantity+unit,
  description, tag chips, location breadcrumb (links to location page), category,
  properties rendered as a key-value table, QR sticker block (`QrThumb` component:
  `GET /api/qr/:token` image + a print button that opens a minimal print view).
  Delete with confirm dialog → back to list.
- **EditItemPage** (`/items/:id/edit`): form for name, description, quantity, unit,
  tags (MUI Autocomplete freeSolo multiple, options from `/api/tags`), location picker
  (select with indented tree from `/api/locations`), category picker, properties editor
  (dynamic key/value rows, add/remove). Saves via `PATCH /api/items/:id`.
- Photo management on edit: upload additional photos (`POST /api/photos/upload` with
  `itemId`), set primary, remove photo.

## Non-goals

- AI-assisted intake (EVT-11) — this is the manual editing path
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Detail renders all fields incl. arbitrary properties; QR image loads; print view shows only sticker + name
- [x] Edit round-trip: change name/tags/properties/location → save → detail reflects it
- [x] Adding a photo on edit shows it in gallery; setting primary changes the list-card thumbnail
- [x] Delete removes item and returns to list with it gone
<!-- AC:END -->

## Final Summary

Built ItemDetailPage (photo gallery primary-first, name/qty/unit/description, tag chips, location breadcrumb, category, properties key-value table, QR sticker via QrThumb + print button, delete with confirm dialog) and EditItemPage (name/description/qty/unit form, freeSolo tag Autocomplete from /api/tags, indented location/category Select pickers, dynamic properties editor, photo upload/set-primary/remove via PATCH /api/items/:id). Added minimal ItemPrintPage outside the AppBar shell (QR sticker + name only) and a new DELETE /api/photos/:id endpoint (controller + service + tests) required for photo removal.

Review-driven hardening across 4 rounds: breadcrumb leaf de-duplication; removed dead /locations/:id link (plain text until follow-up wires it to EVT-12's pages); explicit `null` semantics so location/category can be CLEARED via the edit form (UpdateItemDto widened to `string | null`, web sends null on "No location"/"No category", with tests both sides); error Alerts for delete + all photo mutations; stale deleteError reset. Rebased onto main after EVT-12 merged — QrThumb add/add merged into one component (main's XSS-safe print popup + optional printHref for the in-app print route) serving both location and item call sites, api.ts union-merged keeping main's encodeURIComponent'd qrImageUrl.

Verification: pnpm build/test/lint/format:check all passed (web 39 tests, api 218 tests). Reviews: 4 rounds × 3 reviewers (code/test/security), final round approved with no critical/major findings (independence note: codex unavailable, all reviewers claude-code). PR #11.
