---
id: EVT-28
title: 'feat(projects): build completion backflush — consume BOM stock with genealogy'
status: Done
priority: high
created_date: '2026-08-12 18:33'
updated_date: '2026-08-13 09:51'
assignee: []
labels:
  - projects
  - parts-logistics
  - api
  - web
  - enhancement
dependencies:
  - EVT-25
references:
  - research/parts-logistics-at-scale.md
  - apps/api/src/projects/projects.service.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Completing a project today changes only its status — the parts it consumed stay in
inventory on paper. Every serious system backflushes: when a build is confirmed,
explode the BOM and deduct component stock automatically, recording what went where
(research dossier, Mechanics 03). Without this, project completion silently corrupts
on-hand counts, and "which projects used this part?" is unanswerable.

## Goal

- Marking a Project `completed` triggers a backflush confirmation screen: every BOM
  line linked to an Item, with line quantity vs. current on-hand, shortages
  highlighted; free-text lines (no `itemId`) listed as "not tracked — skipped"
- Per-line override: user can adjust the consumed quantity (0..line qty) before
  confirming — real builds deviate from plan
- Confirming records one `build` movement per consumed line (kind `build`,
  `projectId` set, from EVT-25) and decrements the items, all in one transaction;
  cancelling leaves everything untouched
- Shortage handling: lines where on-hand < consume quantity are clamped to on-hand
  and flagged in the confirmation; never drive quantity negative
- Genealogy, both directions: project detail gains a "Consumed" section (what was
  actually deducted, when); item history (EVT-25) already links back via `projectId`
- Re-opening a completed project does NOT auto-reverse movements; a notice explains
  consumption stands and can be adjusted manually

## Non-goals

- Reservations/allocation before completion (EVT-29)
- Multi-build projects (quantity-of-assemblies multiplier) — single build per project
- Lot-level tracking

## Risk

- Double-backflush on status flapping (completed → planned → completed) — guard with
  an idempotency check: a project that already has build movements requires explicit
  "consume again" confirmation.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Completing a project with item-linked BOM lines shows the confirmation screen with per-line on-hand, editable consume quantity, and highlighted shortages before anything is written
- [x] Confirming writes one `build` movement per line and decrements items atomically — a mid-transaction failure leaves no partial consumption (service spec proves it)
- [x] Free-text BOM lines are listed as skipped and cause no writes
- [x] Shortage lines clamp to on-hand and never produce negative quantity
- [x] Project detail shows the consumed record; item movement history links back to the project
- [x] Completing the same project twice requires explicit re-confirmation (idempotency guard)
- [x] API + web tests cover happy path, shortage clamp, skip, cancel, and double-completion; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
BOM backflush on project completion: GET /api/projects/:id/backflush-preview + POST /api/projects/:id/backflush confirm and atomically write one `build` StockMovement (negative delta) per consumed item-linked BOM line via the new race-safe StockMovementsService.recordConsumption (conditional updateMany with quantity >= n guard + bounded retry), clamp shortages to on-hand, skip free-text lines, and require confirmAgain to re-consume an already-backflushed project. Web ProjectDetailPage gains the confirmation dialog (editable per-line quantities, shortage chips, skipped list, idempotency checkbox), a "Consumed" section, and a reopen notice; ItemDetailPage renders backflush rows as "Consumed in build".

## Changes
- apps/api/src/projects/projects.service.ts — previewBackflush + backflush (in-tx idempotency guard, lineId dedupe, clamp)
- apps/api/src/stock-movements/stock-movements.service.ts — new atomic recordConsumption
- apps/api/src/projects/backflush.dto.ts / backflush-line.dto.ts (+ specs) — DTOs with ArrayMaxSize(200), full ValidationPipe spec
- apps/api/src/projects/projects.controller.ts — endpoints, createdById threading from session
- apps/api/prisma/schema.prisma — doc comments reconciled for negative-delta build movements
- apps/web/src/pages/ProjectDetailPage.tsx / ItemDetailPage.tsx (+ tests), apps/web/src/api.ts — dialog, Consumed section, reopen notice, movement rendering

## Design decisions
- Kept `kind: 'build'` with negative delta per the task AC (schema docs + web rendering reconciled instead of switching to `consume`)
- Plain PATCH status:'completed' intentionally bypasses backflush (documented); only the web flow routes through confirm
- Re-opening a completed project does not auto-reverse movements

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (474 API + 145 web)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 2 review rounds × 3 reviewers (code/test/security); round 2 unanimously approved (⚠ independence not enforced — codex unavailable, all reviewers claude-native)

## Follow-up
- (minor) Concurrent first-time confirms under READ COMMITTED can each consume once — consider SELECT ... FOR UPDATE on the project row or a partial unique index
- (minor) Sort consumption loop by itemId to avoid self-inflicted deadlocks; e2e test for real Prisma rollback; stale Project.stockMovements doc comment; CHECK (quantity >= 0) constraint as defense-in-depth
