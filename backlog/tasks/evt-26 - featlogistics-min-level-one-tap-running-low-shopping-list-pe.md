---
id: EVT-26
title: 'feat(logistics): min level + one-tap "running low" + shopping list (personal e-kanban)'
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
- [ ] Migration adds `minQuantity` and `ShoppingListEntry` with a partial unique index guaranteeing at most one open entry per item
- [ ] A consume movement dropping quantity to ≤ min creates exactly one open low-stock entry; further drops do not duplicate it
- [ ] "Running low" button on item detail and scan landing creates a manual entry with one tap and gives visual confirmation
- [ ] Shopping List page lists open entries with thumbnail, on-hand/min, and location; empty state is designed, not blank
- [ ] "Restocked" prompts for new quantity, records an `add` movement, closes the entry, and the item's badge/state updates without reload
- [ ] Nav shows an accurate open-entry count badge
- [ ] API + web tests cover trigger, idempotency, restock flow; coverage meets the 80% threshold
<!-- AC:END -->
