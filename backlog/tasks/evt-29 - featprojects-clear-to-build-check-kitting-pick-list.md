---
id: EVT-29
title: 'feat(projects): clear-to-build check + kitting pick list'
status: To Do
priority: medium
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
- [ ] Availability endpoint returns per-line status and a correct `clearToBuild` summary; untracked (free-text) lines counted separately from shortages
- [ ] Project detail renders the panel: green all-clear when every tracked line is ok, otherwise short/untracked counts with per-line breakdown
- [ ] Pick list groups lines by location, ordered by location path, and check-off state persists across reloads
- [ ] "Add to shopping list" on a short line creates an EVT-26 entry (idempotent with existing open entries)
- [ ] Pick list prints legibly (print stylesheet: no nav, readable checkboxes)
- [ ] API + web tests cover status computation, grouping/ordering, check-off persistence, and the shopping-list hook; coverage meets the 80% threshold
<!-- AC:END -->
