---
id: EVT-30
title: 'feat(logistics): containers — movable boxes with license-plate QR'
status: Done
priority: medium
created_date: '2026-08-12 18:33'
updated_date: '2026-08-13 12:37'
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
- [x] Migration adds `kind` with default `area`; existing locations unaffected; containers creatable from the locations page and as children of any node
- [x] Scanning a container QR lands on a page offering "Move to…"; completing it re-parents the node and all recursive contents resolve to the new ancestry
- [x] Container move records a movement entry visible in history; item-level histories are NOT spammed with per-item entries
- [x] Server rejects moving a container into itself or any descendant (422 with a clear message)
- [x] Location tree renders containers with a distinct icon and recursive item count
- [x] API + web tests cover re-parenting, ancestry validation, recursive counts; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Containers: `Location.kind` (`area`/`container`), container-only "Move to…" re-parent endpoint with cycle guards, one itemless `StockMovement` per container move (`containerId`, SetNull on delete), distinct tree icons + recursive item counts, move dialog + container history in the web UI.

## Review history (6 rounds — needs-human-attention resolved by operator direction)
- R1: security major (TOCTOU ancestry guard) → fixed R2 (FOR UPDATE row locks)
- R2: test-reviewer majors (missing ValidationPipe + DB-level SetNull tests) → PR shipped `[needs-human-attention]` at cap
- R3 (operator-directed): rebase onto 3 merged siblings; both regression tests added; e2e against real Postgres **caught a production bug** (uuid[] cast missing — every move would have 500'd); subtree-lock hardening
- R4: reviewers converged on cross-statement deadlock → single-statement union lock + P2034 retry
- R5: code reviewer **empirically disproved** the CTE variant on live Postgres (EvalPlanQual reuses stale CTE snapshot)
- R6: **operator design decision via rubric** — `pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY)` serializes all structural tree mutations (moveContainer + rename); row-lock machinery deleted; `$executeRaw` (not `$queryRaw` — void return, P2010). Selected over SERIALIZABLE-retry and further row-locking; escalation path = narrow the lock key.

## Verification
- `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm format:check` — all passed
- locations e2e against real dockerized Postgres — passed
- Final verdicts: code approved (1 suggestion), test approved (1 suggestion), security approved (1 minor + 3 suggestions)

## Follow-up
- Map Prisma P2028 (transaction timeout under lock wait) to 409
- Empty-slug guard in LocationsService.create (parity with Categories)
- Deleted-container ledger rows unreachable via listForContainer (needs a global movements view)
- Pre-existing on main: projects/search-by-photo e2e specs fail with 401 (missing AuthedHttp helper) — file separately
