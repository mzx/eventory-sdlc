---
id: EVT-28
title: 'feat(projects): build completion backflush — consume BOM stock with genealogy'
status: To Do
priority: high
created_date: '2026-08-12 18:33'
updated_date: '2026-08-12 18:33'
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
- [ ] Completing a project with item-linked BOM lines shows the confirmation screen with per-line on-hand, editable consume quantity, and highlighted shortages before anything is written
- [ ] Confirming writes one `build` movement per line and decrements items atomically — a mid-transaction failure leaves no partial consumption (service spec proves it)
- [ ] Free-text BOM lines are listed as skipped and cause no writes
- [ ] Shortage lines clamp to on-hand and never produce negative quantity
- [ ] Project detail shows the consumed record; item movement history links back to the project
- [ ] Completing the same project twice requires explicit re-confirmation (idempotency guard)
- [ ] API + web tests cover happy path, shortage clamp, skip, cancel, and double-completion; coverage meets the 80% threshold
<!-- AC:END -->
