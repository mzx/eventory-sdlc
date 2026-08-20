---
id: EVT-41
title: 'feat(tenancy): enforcement — locations (+advisory lock), projects, tags, shopping, verification'
status: Done
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-20 14:22'
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
- [x] All listed modules pass the two-workspace 404/correct-data matrix (e2e, extending EVT-40's harness)
- [x] Advisory lock workspace-keyed: lock-shape specs updated; spec proves different-workspace keys differ and same-workspace mutations still serialize
- [x] BOM line linking a foreign-workspace item rejected with a test
- [x] Low-stock entries, verification queues, badge counts workspace-scoped (e2e)
- [x] Same tag name creatable in two workspaces via the API
- [x] Viewer-role matrix extended to these modules: reads 200, all mutations 403 (e2e)
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Extended EVT-40's tenant context/write-guard harness across Locations, Categories, Projects/BOM/backflush, and Shopping List: every query and mutation in these modules is now scoped to the caller's workspaceId (foreign rows 404 identically to unknown ids), viewer role gets 403 on all mutations, and a BOM line can no longer link a foreign-workspace item. The location-tree advisory lock is re-keyed per-workspace via `pg_advisory_xact_lock(LOCATION_TREE_LOCK_KEY::int, hashtext(workspaceId))` so two workspaces' structural moves/renames no longer serialize against each other.

## Changes
- `apps/api/src/locations/*` — tree queries/mutations workspace-scoped; per-workspace advisory lock (`::int` cast for the two-arg int4 overload); descendant-path SUBSTRING rewrites now carry a workspaceId predicate (latent cross-workspace path-corruption fix)
- `apps/api/src/projects/*` — projects/BOM/backflush/clear-to-build/pick-list scoped; BOM lines reject foreign-workspace items (404)
- `apps/api/src/categories/*` — scoped lists/creation; per-workspace name uniqueness user-visible
- `apps/api/src/shopping-list/*` — scoped queries + badge counts
- `apps/api/src/stock-movements/*` — `openLowStockEntry` raw INSERT now stamps the item's real workspaceId (was silently defaulting to Default Workspace)
- `apps/api/src/workspace/workspace-write.guard.ts` — coverage doc updated
- `apps/api/test/tenancy-isolation-evt41.e2e-spec.ts` — new 35-test two-workspace isolation + viewer-role matrix

## Design decisions
- Two-arg advisory lock requires int4: explicit `::int` cast on LOCATION_TREE_LOCK_KEY (verified against real Postgres; without it every rename/move 409'd).
- Path-rewrite UPDATEs gained workspaceId predicates — required since EVT-39 made `path` unique per-workspace rather than globally.
- Tags needed no source change (already scoped since EVT-40 round 2; created only transitively via ItemsService).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (691 unit tests, 98.29% coverage)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved, 0 critical / 0 major / 4 minor / 3 suggestions (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers claude-native)

## Follow-up
- One-time audit for pre-EVT-41 BOM lines referencing foreign-workspace items, plus optional defensive workspace filter in the backflush consume loop (security review, minor).
- Rolling-deploy note: old/new pods use disjoint advisory-lock spaces during the deploy window — prefer single-pod cutover for tree mutations (security review, suggestion).
- Admin `/api/users` surface has no workspace predicate — tenancy-ladder backlog candidate (security review, suggestion).
- Pre-existing dead test file `apps/api/test/projects.e2e-spec.ts` (unauthenticated since EVT-14) — follow-up task candidate.
