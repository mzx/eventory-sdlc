---
id: EVT-41
title: 'feat(tenancy): enforcement — locations (+advisory lock), projects, tags, shopping, verification'
status: To Do
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-19 23:32'
assignee: []
labels:
  - tenancy
  - api
  - security
  - enhancement
dependencies:
  - EVT-40
references:
  - apps/api/src/locations/locations.service.ts
  - apps/api/src/projects/projects.service.ts
  - apps/api/src/stock-movements/stock-movements.service.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Completes tenant enforcement across the remaining modules using EVT-40's
context + isolation harness.

## Goal

- **Locations**: tree queries and create/rename/move/delete scoped; **the
  location-tree advisory lock becomes per-workspace** — replace
  `pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY)` with the two-argument form
  `pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY, hashtext(workspaceId))` so
  households don't serialize each other's moves/renames (the escalation path
  documented in the EVT-30 design decision)
- **Projects/BOM/backflush**: projects scoped; BOM lines may only link items of
  the same workspace (validated on create/update); backflush, clear-to-build,
  pick list operate within the workspace; build movements inherit it
- **Tags/categories**: scoped lists/creation (EVT-39's per-workspace uniqueness
  becomes user-visible)
- **Shopping list + verification queues**: scoped queries; low-stock trigger
  writes entries in the item's workspace; badge counts scoped
- Extend the isolation e2e matrix to every endpoint in these modules
- Apply EVT-40's shared write-guard across these modules: `viewer` reads
  everything, 403 on every mutation (moves, renames, backflush, BOM edits,
  restock, counts)

## Non-goals

- Membership APIs (EVT-42); UI (EVT-43); RLS (EVT-44)

## Risk

- The advisory-lock change alters EVT-30's reviewed concurrency story — keep
  lock-first-statement discipline per workspace, update lock-shape specs, and
  prove two workspaces' mutations don't block each other.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] All listed modules pass the two-workspace 404/correct-data matrix (e2e, extending EVT-40's harness)
- [ ] Advisory lock workspace-keyed: lock-shape specs updated; spec proves different-workspace keys differ and same-workspace mutations still serialize
- [ ] BOM line linking a foreign-workspace item rejected with a test
- [ ] Low-stock entries, verification queues, badge counts workspace-scoped (e2e)
- [ ] Same tag name creatable in two workspaces via the API
- [ ] Viewer-role matrix extended to these modules: reads 200, all mutations 403 (e2e)
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
