---
id: EVT-25
title: 'feat(logistics): stock movement ledger — every quantity change is a recorded event'
status: To Do
priority: high
created_date: '2026-08-12 18:32'
updated_date: '2026-08-12 18:32'
assignee: []
labels:
  - parts-logistics
  - api
  - web
  - enhancement
dependencies: []
references:
  - research/parts-logistics-at-scale.md
  - apps/api/prisma/schema.prisma
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

`Item.quantity` is a mutable integer with no history. Once it changes, there is no
record of when, why, or by whom — no way to answer "where did my M3 screws go?"
Professional systems (see research dossier, Mechanics 03) treat the movement ledger,
not the stock snapshot, as the primary data structure: on-hand is a projection of
transactions.

## Goal

Introduce a `StockMovement` model and route every quantity change through it:

- Prisma model: `id, itemId, kind (enum: add | consume | move | adjust | build),
  delta Int, fromLocationId?, toLocationId?, projectId?, note?, createdById?, createdAt`
- A single service method (`recordMovement`) that atomically writes the movement AND
  updates `Item.quantity` (and `locationId` for moves) in one transaction; all
  existing quantity-touching endpoints (item update, intake) refactored to use it
- `GET /api/items/:id/movements` — paginated history, newest first
- Web: "History" section on the item detail page showing the movement list
  (kind icon, delta, location names, project link when present, relative time)
- Direct edits of quantity in the edit form generate an `adjust` movement with the
  delta computed from the previous value

## Non-goals

- Lot/batch tracking or a Part-vs-StockItem split (future; ledger enables it)
- Rebuilding on-hand purely from the ledger (quantity column stays authoritative;
  the ledger is an audit trail for now)
- Backdating or editing past movements

## Risk

- Refactor touches every quantity write path; regressions here corrupt inventory
  silently. Mitigate with service-level tests asserting movement+quantity always
  change together in one transaction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Migration adds `StockMovement` with the fields and enum above; `prisma migrate` runs clean from an existing database
- [ ] Every existing endpoint that changes `Item.quantity` or `Item.locationId` writes exactly one movement in the same transaction (verified by service specs)
- [ ] Editing quantity from N to M in the web edit form produces an `adjust` movement with delta M−N
- [ ] Moving an item to another location produces a `move` movement carrying both location ids
- [ ] `GET /api/items/:id/movements` returns paginated history newest-first; 404 for unknown item
- [ ] Item detail page renders the history section with kind, delta, locations, and timestamp
- [ ] API + web test coverage for the above meets the repo's 80% threshold
<!-- AC:END -->
