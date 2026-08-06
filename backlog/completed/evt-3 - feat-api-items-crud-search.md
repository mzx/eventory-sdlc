---
id: EVT-3
title: 'feat(api): Items CRUD + search — list with ?search=&tag=&locationId=, by-qr lookup'
status: Done
labels: [api, items, search]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

No way to create or find items — the heart of the inventory.

## Goal

`ItemsModule` in the NestJS API:

- `GET /api/items?search=&tag=&locationId=` — list, newest first, each row with tags,
  location (id+name+path), primary photo. `search` matches name/description
  case-insensitively (use `pg_trgm`-backed `ILIKE`/similarity) and also matches values
  inside `properties` JSONB. `tag` filters by tag name; `locationId` includes items in
  that location's whole subtree (path prefix match).
- `GET /api/items/:id` — full detail: photos, tags, location, category.
- `GET /api/items/by-qr/:qr` — resolves a QR token to `{ kind: 'item', item }` or
  `{ kind: 'location', location }` (checks both tables — this powers scanning).
- `POST /api/items` — create with optional `tags: string[]` (upsert tags by name),
  `locationId`, `categoryId`, `properties`, `photoIds` to attach + first becomes primary.
- `PATCH /api/items/:id` — partial update incl. tag list replacement.
- `DELETE /api/items/:id` — cascades photos/itemTags per schema.
- DTO validation via `class-validator`; global `ValidationPipe`.

## Non-goals

- Photo upload (EVT-6), QR PNG rendering (EVT-8), visual search (EVT-17), auth guards (EVT-14)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] e2e (supertest) or integration tests cover: create → list → search hit/miss → filter by tag → filter by locationId subtree → patch tags → delete
- [ ] `by-qr` returns an item for an item token, a location for a location token, 404 otherwise
- [ ] Search for a value stored only in `properties` JSONB finds the item
- [ ] Invalid payloads (missing name, bad uuid) return 400 with messages
<!-- AC:END -->
