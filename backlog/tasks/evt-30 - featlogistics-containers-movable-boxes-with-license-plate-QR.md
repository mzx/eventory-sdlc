---
id: EVT-30
title: 'feat(logistics): containers — movable boxes with license-plate QR'
status: To Do
priority: medium
created_date: '2026-08-12 18:33'
updated_date: '2026-08-12 18:33'
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

Moving a box of parts to a new shelf currently means re-locating every item in it
one by one. The single most reusable enterprise mechanic is the license plate
(research dossier, Mechanics 01): identity lives on the container, contents follow
it via one scan. Locations already form a tree with QR codes — but all nodes are
equal, and nothing distinguishes a fixed shelf from a box that travels.

## Goal

- `Location.kind` enum: `area` (default — rooms, shelves; existing rows migrate to
  this) | `container` (boxes, cases — movable)
- Containers are location nodes: items inside them just have the container as their
  `locationId`, so contents-by-lookup already works; child containers allowed
  (box in a box)
- "Move container" flow: scanning a container QR (or its detail page) offers
  "Move to…" with a location picker — re-parents the node; all contents implicitly
  move with it; one `move` movement is recorded for the container event (itemless
  container-move entries: extend StockMovement with nullable `containerId`)
- Web: containers visually distinct in the location tree (icon), and the item count
  badge shows recursive contents
- Guard rails: a container cannot be moved into itself or its descendants; `area`
  nodes keep the existing management flows

## Non-goals

- Capacity limits, weight, or slotting suggestions
- Separate container entity outside the location tree (deliberate — reuse the tree)
- Batch re-parenting of multiple containers at once

## Risk

- Cycle creation on re-parent (box into its own child) — validate ancestry
  server-side, not just in the picker.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Migration adds `kind` with default `area`; existing locations unaffected; containers creatable from the locations page and as children of any node
- [ ] Scanning a container QR lands on a page offering "Move to…"; completing it re-parents the node and all recursive contents resolve to the new ancestry
- [ ] Container move records a movement entry visible in history; item-level histories are NOT spammed with per-item entries
- [ ] Server rejects moving a container into itself or any descendant (422 with a clear message)
- [ ] Location tree renders containers with a distinct icon and recursive item count
- [ ] API + web tests cover re-parenting, ancestry validation, recursive counts; coverage meets the 80% threshold
<!-- AC:END -->
