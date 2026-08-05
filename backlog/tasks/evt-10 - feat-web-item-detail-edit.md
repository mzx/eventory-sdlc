---
id: EVT-10
title: 'feat(web): Item detail + edit — photos, properties, tags, location picker, QR sticker'
status: To Do
labels: [web, items]
dependencies: [EVT-9, EVT-8]
references: [PRODUCT.md]
priority: medium
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
- [ ] Detail renders all fields incl. arbitrary properties; QR image loads; print view shows only sticker + name
- [ ] Edit round-trip: change name/tags/properties/location → save → detail reflects it
- [ ] Adding a photo on edit shows it in gallery; setting primary changes the list-card thumbnail
- [ ] Delete removes item and returns to list with it gone
<!-- AC:END -->
