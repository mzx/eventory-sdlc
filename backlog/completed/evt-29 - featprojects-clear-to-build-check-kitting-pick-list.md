---
id: EVT-29
title: 'feat(projects): clear-to-build check + kitting pick list'
status: Done
priority: medium
created_date: '2026-08-12 18:33'
updated_date: '2026-08-13 13:25'
assignee: []
labels:
  - projects
  - parts-logistics
  - api
  - web
  - enhancement
dependencies:
  - EVT-28
references:
  - research/parts-logistics-at-scale.md
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Before starting a build there is no way to know whether all parts are on hand or
where to fetch them from — the two questions every plant answers with clear-to-build
checks and kitting (research dossier, Mechanics 02 and 06). Discovering a shortage
mid-assembly is the personal-scale version of a line stop.

## Goal

- `GET /api/projects/:id/availability` — per BOM line: linked item, required qty,
  on-hand, location (id, name, path), and a status (`ok | short | untracked`);
  summary: `clearToBuild: boolean`, counts per status
- Project detail: "Can I build this?" panel showing the summary at a glance
  (all-clear vs. N short / M untracked) with per-line detail
- Pick list view: item-linked lines grouped by location and ordered by location
  path (a walkable route through the storage tree), each line with a check-off box
  (`picked` boolean on BomLine, persisted); progress indicator (picked/total)
- Short lines offer a one-tap "add to shopping list" (reuses EVT-26 entries)
- Print-friendly CSS for the pick list (it goes to the workbench on paper)

## Non-goals

- Hard reservations that lock stock against other projects (single user; the
  `picked` flag is informational)
- Assembly-step ordering of the pick list (BOM has no step field yet)
- Auto-purchasing

## Risk

- Availability is a point-in-time read; the backflush confirmation (EVT-28) remains
  the source of truth at consume time, so staleness here is acceptable and must be
  labeled with an as-of timestamp.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Availability endpoint returns per-line status and a correct `clearToBuild` summary; untracked (free-text) lines counted separately from shortages
- [x] Project detail renders the panel: green all-clear when every tracked line is ok, otherwise short/untracked counts with per-line breakdown
- [x] Pick list groups lines by location, ordered by location path, and check-off state persists across reloads
- [x] "Add to shopping list" on a short line creates an EVT-26 entry (idempotent with existing open entries)
- [x] Pick list prints legibly (print stylesheet: no nav, readable checkboxes)
- [x] API + web tests cover status computation, grouping/ordering, check-off persistence, and the shopping-list hook; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Implemented the clear-to-build availability check (`GET /api/projects/:id/availability`, per-line `ok | short | untracked` status with a `clearToBuild` summary and as-of timestamp), a "Can I build this?" panel on the project detail page with one-tap add-to-shopping-list on short lines (idempotent with existing open EVT-26 entries), and a print-friendly kitting pick list (`/projects/:id/pick-list`) grouping item-linked BOM lines by storage-location path with a persisted `picked` check-off (new `BomLine.picked` column + migration). Round 2 fixed the reviewer-found aggregation bug: on-hand is now allocated greedily across BOM lines sharing an itemId (createdAt-asc), so combined demand from multiple lines is correctly reflected in per-line status and `clearToBuild`.

## Changes
- `apps/api/prisma/schema.prisma` + migration `20260813130405_add_bom_line_picked` — `BomLine.picked` boolean (default false)
- `apps/api/src/projects/projects.service.ts` — `availability()` with per-item greedy demand allocation; `picked` update path
- `apps/api/src/projects/projects.controller.ts` — `GET :id/availability` route
- `apps/api/src/projects/update-bom-line.dto.ts` — optional `@IsBoolean` `picked`
- `apps/web/src/pages/ProjectDetailPage.tsx` — availability panel + shopping-list hook
- `apps/web/src/pages/PickListPage.tsx` — location-grouped pick list, check-off with error alert, print CSS
- `apps/web/src/api.ts`, `apps/web/src/App.tsx` — client + route wiring
- Tests: `projects.service.spec.ts`, `projects.controller.spec.ts`, `update-bom-line.dto.spec.ts`, `ProjectDetailPage.test.tsx`, `PickListPage.test.tsx`

## Design decisions
- Availability is a point-in-time read labeled with an as-of timestamp; EVT-28 backflush remains the source of truth at consume time.
- Same-item demand allocated greedily in createdAt-asc order; `onHand` reports the raw item total for display while `status` reflects post-allocation outcome.
- `picked` is informational (no hard reservations). `previewBackflush()` intentionally left unchanged (pre-existing pattern; follow-up candidate).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers ran claude-native)

## Follow-up
- Add `id asc` secondary tiebreaker to the createdAt-asc allocation order (nondeterministic ties).
- Fix stale doc comment: `AvailabilityLine.picked` is not forced false for untracked lines.
- `previewBackflush()` (EVT-28) has the same non-aggregated same-item pattern — worth its own task.
- Optional: optimistic update on the pick checkbox.
