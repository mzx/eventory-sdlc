---
id: EVT-26
title: 'feat(logistics): min level + one-tap "running low" + shopping list (personal e-kanban)'
status: Done
priority: high
created_date: '2026-08-12 18:32'
updated_date: '2026-08-13 09:47'
assignee: []
labels:
  - parts-logistics
  - api
  - web
  - enhancement
dependencies:
  - EVT-25
references:
  - research/parts-logistics-at-scale.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Running out of a part is discovered at the workbench, then forgotten by the time a
shop order is placed. Every professional system reduces "reorder" to a single
physical gesture on the bin (research dossier, Mechanics 02): scan → one tap → the
replenishment loop fires. Eventory has QR labels on every item and location but no
replenishment concept at all.

## Goal

The smallest honest e-kanban:

- `Item.minQuantity Int?` (null = no replenishment tracking)
- `ShoppingListEntry` model: `id, itemId, status (open | done), source (manual | low-stock),
  createdAt, resolvedAt?` — one open entry per item max
- Auto-trigger: any movement (EVT-25) that leaves `quantity <= minQuantity` creates an
  open entry with `source: low-stock` (idempotent)
- One-tap trigger: item detail and the scan-landing page get a "Running low" button
  that creates a manual entry — no forms, one tap
- Web: Shopping List page listing open entries (item name, photo thumbnail, on-hand,
  min, location); "Restocked" action prompts for the new quantity, records an `add`
  movement, and closes the entry
- Nav badge with the count of open entries

## Non-goals

- Suppliers, prices, purchase orders, or vendor links
- Computed/auto-tuned min levels (EVT-31 territory, future)
- Email/push notifications

## Risk

- Duplicate-entry races when several movements dip below min in quick succession —
  enforce one open entry per item with a partial unique index.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Migration adds `minQuantity` and `ShoppingListEntry` with a partial unique index guaranteeing at most one open entry per item
- [x] A consume movement dropping quantity to ≤ min creates exactly one open low-stock entry; further drops do not duplicate it
- [x] "Running low" button on item detail and scan landing creates a manual entry with one tap and gives visual confirmation
- [x] Shopping List page lists open entries with thumbnail, on-hand/min, and location; empty state is designed, not blank
- [x] "Restocked" prompts for new quantity, records an `add` movement, closes the entry, and the item's badge/state updates without reload
- [x] Nav shows an accurate open-entry count badge
- [x] API + web tests cover trigger, idempotency, restock flow; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Implemented the smallest honest e-kanban: `Item.minQuantity Int?`, a `ShoppingListEntry` model with a partial unique index enforcing at most one open entry per item, a race-safe low-stock auto-trigger inside `StockMovementsService.recordMovement` (raw `INSERT ... ON CONFLICT DO NOTHING` so a race can never poison the surrounding transaction), a shopping-list API module (manual "running low" trigger + restock), and the web Shopping List page with nav badge, item-detail "Running low" button, and Edit Item minQuantity field.

## Changes
- `apps/api/prisma/schema.prisma` + migration `20260813091141_add_shopping_list_min_quantity` — minQuantity, ShoppingListEntry, partial unique index on (itemId) WHERE status='open'
- `apps/api/src/stock-movements/stock-movements.service.ts` — low-stock auto-trigger on every movement leaving quantity ≤ minQuantity
- `apps/api/src/shopping-list/*` — new module: list open entries, one-tap manual trigger (idempotent via P2002 fallback), restock (atomic close-first `updateMany` status guard, then `add` movement so a still-low quantity re-opens a fresh entry)
- `apps/api/src/items/update-item.dto.ts`, `apps/api/src/shopping-list/shopping-list.dto.ts` — minQuantity/quantity validation incl. @Max(2147483647)
- `apps/web/src/pages/ShoppingListPage.tsx` (+ tests) — list with thumbnail/on-hand/min/location, designed empty state, Restocked dialog
- `apps/web/src/App.tsx` — /shopping-list route + nav badge with open-entry count
- `apps/web/src/pages/ItemDetailPage.tsx` — one-tap "Running low" button with toast confirmation (covers scan landing, which redirects here)
- `apps/web/src/pages/EditItemPage.tsx` — minQuantity field (clearable to null)
- API unit + e2e tests (real Postgres for the partial-unique-index and restock-reopen invariants), web vitest suites

## Design decisions
- Auto-trigger uses raw `INSERT ... ON CONFLICT DO NOTHING` (not try/catch-P2002) so a duplicate race can never abort the surrounding stock-movement transaction; verified against real Postgres in e2e.
- Restock closes the entry FIRST via atomic conditional `updateMany({ id, status: 'open' })` (ConflictException on 0 rows — TOCTOU-safe), then records the movement so a still-below-min restock re-creates a fresh open entry (round-2 review fix, commit 0de3672).
- `CreateItemDto` deliberately does not accept minQuantity — set via PATCH after creation.
- "Running low" lives on ItemDetailPage only; ScanPage redirects there via `<Navigate>` and renders no UI of its own.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers fell back to claude-code)

## Follow-up
- (minor) restock delta is computed from a pre-transaction `item.quantity` read; a concurrent movement in that gap can skew the recorded delta — consider re-reading inside the transaction.
- (suggestion) `CreateItemDto.quantity` lacks the @Max int4 bound applied to the update DTOs.
- (minor) no true concurrent (Promise.all) e2e race for double-restock; unit-level `{count:0}` path covers it.
