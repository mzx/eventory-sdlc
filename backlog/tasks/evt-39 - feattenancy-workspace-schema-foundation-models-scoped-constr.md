---
id: EVT-39
title: 'feat(tenancy): workspace schema foundation — models, scoped constraints, default-workspace backfill'
status: To Do
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-19 23:32'
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
  (workspaceId, userId, role `owner|member`, createdAt,
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
- [ ] Migration applies clean on a database WITH existing data (dockerized e2e seeds pre-migration rows, applies, verifies backfill) — every row lands in the default workspace; memberships created with correct roles
- [ ] Re-scoped uniqueness proven: same tag name / location path allowed in two workspaces, still rejected within one (e2e)
- [ ] `qrCode` columns remain globally unique
- [ ] All existing API behavior unchanged (full existing suite green using the default-workspace constant)
- [ ] Every new FK indexed; `prisma migrate status` clean
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
