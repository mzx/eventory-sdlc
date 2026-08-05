---
id: EVT-16
title: 'feat(projects): Projects + BOM — api module and web pages, link BOM lines to inventory items'
status: To Do
labels: [api, web, projects]
dependencies: [EVT-3, EVT-9]
references: [PRODUCT.md]
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The original tracks workshop projects with a bill of materials that can reference
inventory items ("do I have everything for this build?").

## Goal

- Migration: `Project` (name, description?, status enum `planned|in_progress|completed|archived`,
  notes?, startedAt?, completedAt?, timestamps) and `BomLine` (projectId cascade,
  optional itemId SetNull, denormalized `name` — copied from item on link or free text,
  quantity default 1, unit?, notes?).
- API `ProjectsModule`: CRUD (`GET /api/projects` with status filter + line counts,
  `GET /:id` with BOM lines incl. linked item summary, `POST`, `PATCH /:id`,
  `DELETE /:id`) and BOM lines (`POST /:id/bom` — from `itemId` (copies name) or free
  text; `PATCH /:id/bom/:lineId`; `DELETE /:id/bom/:lineId`).
- Web: **ProjectsPage** (`/projects`, status-grouped list, create dialog) and
  **ProjectDetailPage** (`/projects/:id`, editable header + status, BOM table with
  add-line row — item autocomplete against `GET /api/items?search=` or free text;
  linked lines navigate to the item).
- AppBar/nav entry "Projects".

## Non-goals

- Stock deduction/reservations, cost tracking, per-line availability math
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] API tests: project CRUD, add line from item (name copied), free-text line, edit/delete line, delete project cascades lines
- [ ] Web: create project → add two BOM lines (one linked, one free) → linked line links to item detail
- [ ] Deleting an inventory item leaves the BOM line with its copied name (itemId null)
<!-- AC:END -->
