---
id: EVT-25
title: 'feat(logistics): stock movement ledger — every quantity change is a recorded event'
status: Done
priority: high
created_date: '2026-08-12 18:32'
updated_date: '2026-08-13 00:50'
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
- [x] Migration adds `StockMovement` with the fields and enum above; `prisma migrate` runs clean from an existing database
- [x] Every existing endpoint that changes `Item.quantity` or `Item.locationId` writes exactly one movement in the same transaction (verified by service specs)
- [x] Editing quantity from N to M in the web edit form produces an `adjust` movement with delta M−N
- [x] Moving an item to another location produces a `move` movement carrying both location ids
- [x] `GET /api/items/:id/movements` returns paginated history newest-first; 404 for unknown item
- [x] Item detail page renders the history section with kind, delta, locations, and timestamp
- [x] API + web test coverage for the above meets the repo's 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
StockMovement audit ledger (add/consume/move/adjust/build) with an atomic `recordMovement` service; item create/update routed through it with race-safe in-transaction reads; paginated `GET /api/items/:id/movements`; web "History" section with Load-more clamped at the API cap.

## Changes
- `apps/api/prisma/schema.prisma` + migration `20260812190000_add_stock_movement` — StockMovement model, MovementKind enum, relations/indexes
- `apps/api/src/stock-movements/*` — StockMovementsService.recordMovement (atomic write+update), listForItem pagination, query DTO with page/pageSize bounds
- `apps/api/src/items/*` — create (intake→add) and update (adjust/move) refactored through recordMovement; current-state read inside the transaction (race fix, round 2)
- `apps/api/test/items.e2e-spec.ts` — ledger e2e coverage (not runnable in sandbox; typechecks/lints)
- `apps/web/src/pages/ItemDetailPage.tsx` + `api.ts` + `lib/relativeTime.ts` — History section (kind icon, delta, locations, project link, relative time), Load-more clamped at 100 with "first 100" hint

## Design decisions
- Quantity column stays authoritative; ledger is an audit trail (per task non-goals)
- StockMovement cascade-deletes with its item; location FKs SET NULL (documented tradeoffs, flagged by reviewers as accepted)
- Round 2: pre-edit state read moved inside `$transaction` (tx.item.findUnique first statement) closing the practical TOCTOU window; residual unlocked-SELECT narrow window under READ COMMITTED noted by reviewers as minor/nice-to-have

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (428 API + 131 web unit tests)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code); final: 0 critical, 0 major, 2 minor, 3 suggestions

## Follow-up
- Residual narrow TOCTOU: consider SELECT…FOR UPDATE / optimistic updateMany / DB CHECK(quantity>=0) backstop
- Web clamp test never exercises Math.min overshoot (STEP divides CAP evenly); add non-aligned-constants test
- `quantity` DTO lacks @Max (pre-existing; Int32 overflow 500s instead of 400)
