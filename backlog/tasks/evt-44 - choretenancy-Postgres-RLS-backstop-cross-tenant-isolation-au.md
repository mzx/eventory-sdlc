---
id: EVT-44
title: 'chore(tenancy): Postgres RLS backstop + cross-tenant isolation audit'
status: To Do
priority: medium
created_date: '2026-08-19 23:33'
updated_date: '2026-08-19 23:33'
assignee: []
labels:
  - tenancy
  - security
  - db
dependencies:
  - EVT-41
references:
  - apps/api/prisma/schema.prisma
  - apps/api/src/prisma
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Row scoping is only as safe as query discipline — one forgotten `where` leaks
a household's inventory. Per the 2026-08-20 tenancy decision, RLS is the
deferred hardening layer: application scoping fails open; RLS fails closed.

## Goal

- Enable **Postgres row-level security** on all workspace-scoped tables with
  policies keyed to `current_setting('app.workspace_id')`; the Prisma layer
  sets it per request/transaction (`SET LOCAL` inside the tenant context —
  must compose with existing `$transaction` usage including advisory-lock and
  backflush paths)
- Admin/migration paths that legitimately cross workspaces (backfills,
  AdminUsersPage) use an explicit documented bypass pattern — no silent
  superuser defaults
- **Isolation audit**: adversarial review sweep + an automated test running a
  deliberately-unscoped query through the app connection proving RLS blocks it
- Document the layered model (app scoping = correctness, RLS = containment)

## Non-goals

- Per-user row-owner policies; multi-region; encryption

## Risk

- RLS + connection pooling: `SET LOCAL` must be transaction-scoped or requests
  inherit another request's workspace — dedicated interleaved-request test
  required.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] RLS enabled with policies on every workspace-scoped table; query without the setting returns zero rows (fail-closed, e2e)
- [ ] Deliberately-unscoped app-level query blocked by RLS in a dedicated test
- [ ] Interleaved-request test proves no setting leakage; advisory-lock + backflush transactions work under RLS
- [ ] Cross-workspace admin/migration paths documented and functional
- [ ] Layered-security model documented
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
