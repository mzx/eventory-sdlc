---
id: EVT-39
title: 'feat(tenancy): workspace schema foundation — models, scoped constraints, default-workspace backfill'
status: Done
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-20 12:00'
assignee: []
labels:
  - tenancy
  - api
  - db
  - enhancement
dependencies: []
references:
  - apps/api/prisma/schema.prisma
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Every domain table is global — the app is one shared inventory. Multi-tenancy
(operator decision 2026-08-20: shared-DB row scoping with memberships; Postgres
RLS as a later hardening task, EVT-44) needs the schema foundation first,
shippable without behavior change.

## Goal

Schema + migration only; the app keeps working exactly as today against a
default workspace:

- `Workspace` (id uuid, name, createdAt) and `WorkspaceMember`
  (workspaceId, userId, role `owner|member|viewer`, createdAt,
  `@@unique([workspaceId, userId])`)
- `workspaceId` (non-null FK, `onDelete: Restrict`) added to: Item, Location,
  Category, Tag, Project, StockMovement, ShoppingListEntry, Photo (photos need
  their own scoping for storage authorization in EVT-40; BomLine inherits via
  Project)
- **Uniqueness re-scoped** — the subtle part: `Tag.name` unique →
  `@@unique([workspaceId, name])`; `Location.path` unique → per-workspace;
  `Category.path` same; ShoppingListEntry's one-open-per-item partial unique is
  already item-scoped and stays. Item/Location `qrCode` stays GLOBALLY unique
  (QR tokens live on printed physical labels; scan resolution stays global,
  authorization comes in EVT-40)
- Migration: create a `Default Workspace`, backfill `workspaceId` on ALL
  existing rows, create memberships for all approved users (admins → `owner`,
  others → `member`)
- Services compile and behave unchanged by resolving a module-level
  DEFAULT_WORKSPACE constant (single cached lookup) — per-request tenant
  context is EVT-40's job, NOT this task's

## Non-goals

- Authorization/scoping enforcement (EVT-40/41); workspace APIs (EVT-42);
  UI (EVT-43); RLS (EVT-44)

## Risk

- The migration rewrites every table with a non-null FK — prove it against a
  data-bearing database (DB-level e2e per repo precedent), not just an empty
  one. Index the FK on every table.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Migration applies clean on a database WITH existing data (dockerized e2e seeds pre-migration rows, applies, verifies backfill) — every row lands in the default workspace; memberships created with correct roles
- [x] Re-scoped uniqueness proven: same tag name / location path allowed in two workspaces, still rejected within one (e2e)
- [x] `qrCode` columns remain globally unique
- [x] All existing API behavior unchanged (full existing suite green using the default-workspace constant)
- [x] Every new FK indexed; `prisma migrate status` clean
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

### Summary
Added the workspace tenancy foundation: new Workspace/WorkspaceMember models (with WorkspaceRole owner|member|viewer) and a non-null, indexed, ON DELETE RESTRICT workspaceId FK on Item, Location, Category, Tag, Project, StockMovement, ShoppingListEntry and Photo (BomLine inherits scope via Project). Tag.name and Location/Category.path uniqueness are re-scoped to `@@unique([workspaceId, col])`; qrCode stays globally unique. The hand-written migration (verified byte-for-byte against `prisma migrate diff` output) creates a fixed-id 'Default Workspace', backfills every existing domain row into it via a DEFAULT clause on each ADD COLUMN, and creates WorkspaceMember rows for every approved user (admin→owner, user→member). Every workspaceId field carries the same literal as a Prisma-level `@default(dbgenerated(...))`, which lets every pre-existing service and test keep compiling and behaving unchanged; the one exception (TagsService.upsertByName, composite unique key) is fixed via a new module-level cached-lookup helper (src/workspace/default-workspace.ts).

### Changes
- `apps/api/prisma/schema.prisma` — Workspace/WorkspaceMember models, workspaceId FKs + indexes, re-scoped uniques
- `apps/api/prisma/migrations/20260820020000_workspace_schema_foundation/migration.sql` — default workspace + backfill + memberships migration
- `apps/api/src/workspace/default-workspace.ts` (+spec) — module-level cached DEFAULT_WORKSPACE lookup
- `apps/api/src/tags/tags.service.ts` (+spec) — upsertByName adapted to composite unique key
- `apps/api/test/workspace-migration.e2e-spec.ts` — data-bearing-DB migration e2e (own throwaway Postgres on 5434)

### Design decisions
Fixed well-known UUID `00000000-0000-0000-0000-000000000001` for the Default Workspace so migration INSERT, schema-level defaults, and the TS constant reference the same value without runtime coordination. `@default(dbgenerated("'...'::uuid"))` chosen because it produces ZERO drift under `prisma migrate diff --exit-code`. Migration proven against a data-bearing DB: e2e replays all pre-EVT-39 migrations, seeds legacy-shaped rows bypassing Prisma, applies the migration, asserts backfill/roles/uniqueness at raw SQL level. Two pre-existing e2e failures (projects, search-by-photo 401s) reproduce identically on unmodified main — unrelated.

### Verification
- `pnpm build` — passed
- `pnpm test` — passed (614 unit tests; 98.5%/92.7% coverage, new module 100%)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

### Follow-up
- EVT-40 must drop the workspaceId column DEFAULTs once per-request tenant context is mandatory (fail-open risk: rows silently landing in Default Workspace) — security review finding
- EVT-40/41 must workspace-scope LocationsService path-rewrite queries + conflict pre-checks before a second workspace can exist — security review finding
- Test-coverage nits: add Category.path cross-workspace uniqueness + Location.qrCode global-uniqueness assertions to the migration e2e (identical constraint mechanics to tested siblings)
