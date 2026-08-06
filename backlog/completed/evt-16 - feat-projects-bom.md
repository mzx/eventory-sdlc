---
id: EVT-16
title: 'feat(projects): Projects + BOM — api module and web pages, link BOM lines to inventory items'
status: Done
labels: [api, web, projects]
dependencies: [EVT-3, EVT-9]
references: [PRODUCT.md]
priority: low
updated_date: '2026-08-06 18:31'
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
- [x] API tests: project CRUD, add line from item (name copied), free-text line, edit/delete line, delete project cascades lines
- [x] Web: create project → add two BOM lines (one linked, one free) → linked line links to item detail
- [x] Deleting an inventory item leaves the BOM line with its copied name (itemId null)
<!-- AC:END -->

## Final Summary

## Summary
Implemented Projects + BOM: Prisma `Project`/`BomLine` models (status enum, cascade-delete BOM lines, SetNull item link with denormalized name), NestJS `ProjectsModule` (project CRUD with status filter + line counts, BOM lines from itemId with server-side name copy or free text), and MUI/TanStack Query web pages `ProjectsPage` (status-grouped list + create dialog) and `ProjectDetailPage` (editable status, BOM table with item-autocomplete/free-text add-line row, per-line delete/unlink, delete-project action) plus an AppBar "Projects" nav entry.

## Changes
- `apps/api/prisma/schema.prisma` + migration `20260806131854_feat_projects_bom` — Project/BomLine models, FK `ON DELETE CASCADE`/`SET NULL`
- `apps/api/src/projects/*` — module, controller, service, DTOs (with @ValidateIf empty-string date clearing, nullable itemId unlink, @MaxLength bounds) + unit/DTO specs
- `apps/api/test/projects.e2e-spec.ts` — 7 e2e tests against real Postgres proving DB-level Cascade/SetNull + CRUD/name-copy
- `apps/web/src/api.ts` — typed projects/BOM client (encodeURIComponent on all path params)
- `apps/web/src/pages/ProjectsPage.tsx` + `ProjectDetailPage.tsx` (+ tests) — the two pages
- `apps/web/src/App.tsx` — routes + nav entry

## Design decisions
Migration generated with `prisma migrate dev` against a throwaway Postgres container so SQL matches Prisma output. AC3 (item deletion preserves copied BOM line name) enforced structurally via `onDelete: SetNull` + write-time denormalized name, proven at DB level by e2e test. Rebased onto EVT-12's Locations page with operator-authorized additive conflict resolution in App.tsx/api.ts.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (255 API + 32 web tests)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- e2e suite (jest.e2e.config.js vs Docker Postgres) — 33/33 passed
- 3 parallel reviews approved across 2 iteration rounds + post-rebase re-review round (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers fell back to claude-code)

## Follow-up
- Reviewer minors deferred: no confirmation dialog on cascade project-delete/per-line delete; CORS allow-list + 127.0.0.1 bind recommended for EVT-14; pagination on GET /api/projects a hardening suggestion.
