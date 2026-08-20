---
id: EVT-44
title: 'chore(tenancy): Postgres RLS backstop + cross-tenant isolation audit'
status: Done
priority: medium
created_date: '2026-08-19 23:33'
updated_date: '2026-08-21 14:30'
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
- [x] RLS enabled with policies on every workspace-scoped table; query without the setting returns zero rows (fail-closed, e2e)
- [x] Deliberately-unscoped app-level query blocked by RLS in a dedicated test
- [x] Interleaved-request test proves no setting leakage; advisory-lock + backflush transactions work under RLS
- [x] Cross-workspace admin/migration paths documented and functional
- [x] Layered-security model documented
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Enabled Postgres row-level security (ENABLE + FORCE, per-command policies keyed to `current_setting('app.workspace_id')`) on every workspace-scoped table, running the app under a new unprivileged `eventory_rls` role (the bootstrap role is superuser, which would make RLS a no-op). PrismaService applies `SET LOCAL` transparently for interactive transactions (overridden `$transaction`) and standalone queries (Proxy over RLS-scoped model delegates), reading ambient workspace from AsyncLocalStorage populated by a global `WorkspaceDbContextInterceptor` (`.run()`, not `enterWith()`). A SELECT-only `app.rls_bypass_read` flag serves the two legitimate cross-workspace read paths (QR scan-landing `findByQr`, public `GET /api/qr/:token`); per-command policy split guarantees the flag can never satisfy a write. `User`/`Workspace`/`WorkspaceMember`/`WorkspaceInvite` are deliberately outside RLS scope (documented). Raw-SQL search paths (`searchItemIds`, `matchingItemHitsForTerms`) route through the managed transaction so they stay scoped.

## Changes
- `apps/api/prisma/migrations/20260821090000_row_level_security/migration.sql` — RLS enable/force + 4 per-command policies per table; `eventory_rls` role; grants + `_prisma_migrations` revoke
- `apps/api/src/prisma/prisma.service.ts` — RLS-scoped `$transaction` override + model-delegate Proxy; `APP_DATABASE_URL` wiring with startup warning / production fail-hard
- `apps/api/src/workspace/workspace-db-context.interceptor.ts` — global ALS population (`.run()`), non-HTTP guard, teardown
- `apps/api/src/items/items.service.ts` — raw search SQL moved inside managed transactions; `findByQr` bypass-read pattern
- `apps/api/src/qr/qr.service.ts` — public QR token reads under the bypass-read pattern
- `apps/api/test/rls-isolation.e2e-spec.ts` — AC1–AC7 isolation audit vs real restricted-role Postgres (fail-closed, unscoped-query block, interleaving, advisory-lock, raw-SQL scoping, public QR, policy self-maintenance cross-check; adversarial bypass DELETE/UPDATE-rewrite proofs)
- `apps/api/jest.config.js` + unit specs — coverage exclusion removed; `prisma.service.ts` at 100% branch/line
- `docker-compose.yml` / `docker-compose.prod.yml` / `.env.prod.example` / `apps/api/.env.example` — `APP_DATABASE_URL`, mandatory `EVENTORY_RLS_PASSWORD:?`
- `docs/operations/tenancy-rls.md` — layered model, bypass patterns, containment gaps, isolation-audit findings

## Design decisions
- `AsyncLocalStorage.enterWith()` from the guard corrupted concurrent-request context under load → dedicated global interceptor using `.run()`.
- Prisma `$extends` query hooks lose ALS context → hand-rolled Proxy for standalone-query wrapping (empirically verified).
- Round-2 review: split `FOR ALL` policy into per-command policies (bypass flag would otherwise gate DELETE/UPDATE pre-image → cross-tenant delete/row-theft).
- Membership/identity tables excluded from RLS: all access is explicit, non-ambient membership checks; auth-time reads run without workspace context.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (783/783 unit)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- RLS e2e suite vs isolated Postgres (5433): 20/20, re-verified post-rebase; auth+workspaces e2e 53/53 under the new interceptor
- 3 parallel reviews approved after 2 iterations + post-rebase re-review (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, all reviewers claude-native)

## Follow-up
- deploy.sh: add `ALTER USER eventory_rls PASSWORD` to the existing password-sync block (security minor — first-deploy placeholder window)
- Nested-`$transaction` guard + connection-pool-sizing note (deferred suggestions)
- Add `AuthService.hasValidPendingInvite` to the migration header + docs scope enumerations (EVT-45 interaction, doc drift)
- Pre-existing e2e 401 debt tracked as EVT-46
