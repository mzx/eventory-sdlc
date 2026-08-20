# Tenancy: Postgres row-level security backstop (EVT-44)

## The layered model

Eventory's multi-tenancy (EVT-39/EVT-40/EVT-41/EVT-42) is built on **shared-DB
row scoping**: every workspace-scoped table carries a `workspaceId` column,
and every controller/service filters its queries by the caller's resolved
`Workspace`. Two layers now enforce that boundary:

| Layer | What it is | Failure mode |
|---|---|---|
| **Application scoping** (EVT-40/EVT-41) | `WorkspaceContextGuard` resolves `request.workspace`; every service filters its Prisma calls by that `workspaceId`. | **Fails OPEN.** A forgotten `where: { workspaceId }` on a new query silently returns or mutates another workspace's rows. |
| **Postgres row-level security** (EVT-44, this task) | A `USING`/`WITH CHECK` policy on every workspace-scoped table, keyed to the Postgres session setting `app.workspace_id`. | **Fails CLOSED.** With no (or the wrong) `app.workspace_id` set, the affected tables return/accept zero rows, regardless of what the application query itself asked for. |

RLS is a **backstop**, not a replacement: application code still must scope
its own queries correctly (that's still what makes list/search/pagination
etc. behave sensibly) — RLS is what keeps a *regression* in that scoping
from becoming a cross-tenant data leak.

## Why a second Postgres role was necessary

Row-level security has two well-known escape hatches that make it a no-op if
you're not careful:

1. A Postgres **superuser** always bypasses RLS, `FORCE ROW LEVEL SECURITY`
   notwithstanding.
2. The table **owner** bypasses RLS too, unless `FORCE ROW LEVEL SECURITY`
   is explicitly set.

This project's `eventory` role (`POSTGRES_USER` in `docker-compose.yml` /
`docker-compose.prod.yml`) is the cluster's bootstrap role — a **superuser**
by default in the official `postgres` Docker image. Before this task, the
API's single `DATABASE_URL` connected as `eventory` for both migrations
*and* runtime traffic, which would have made every RLS policy pure theater.

The EVT-44 migration (`prisma/migrations/20260821090000_row_level_security`)
therefore:

- Sets `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` **and**
  `... FORCE ROW LEVEL SECURITY` on every RLS-scoped table (closes escape
  hatch 2 for any future owner-role misuse).
- Creates a second, deliberately unprivileged role, **`eventory_rls`**
  (`LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`), granted ordinary
  `SELECT/INSERT/UPDATE/DELETE` on every table (nothing more) — closes
  escape hatch 1.

`PrismaService` (the app's runtime connection) now connects via
`APP_DATABASE_URL`, pointed at `eventory_rls`. `DATABASE_URL` is unchanged —
it stays the `eventory` owner role, since DDL (`ALTER TABLE`,
`CREATE POLICY`, and every future migration) needs privileges
`eventory_rls` deliberately does not have. See `apps/api/.env.example` for
the exact connection strings and the password-rotation note (the migration
bakes in a placeholder password, same convention as this project's other
dev-scale secrets — rotate it before any real deployment).

## Scope: which tables are RLS-protected

**In scope** — every table with its own `workspaceId` column, which is
exactly the set of tables the application ALREADY scopes ambiently via
`WorkspaceContextGuard`/`@CurrentWorkspace()`:

`Item`, `Location`, `Category`, `Tag`, `Photo`, `Project`, `StockMovement`,
`ShoppingListEntry`.

**Deliberately out of scope**, with rationale:

- **`WorkspaceMember` / `WorkspaceInvite`** — these are membership/identity
  *resolution* tables, not workspace-scoped domain data. Every access to
  them is an EXPLICIT, non-ambient lookup by design:
  - `WorkspaceContextGuard` itself queries `WorkspaceMember` to figure out
    what the ambient workspace even IS — by definition this can't be scoped
    to "the ambient workspace" without a chicken-and-egg problem.
  - `WorkspacesService.requireMembership`/`requireOwner` check membership
    for an ARBITRARY `:id` URL param, which is very often NOT the caller's
    currently-selected/default workspace (see that service's own doc
    comment: "a caller might be `owner` of their default workspace but only
    a plain `member` of the workspace named in the URL").
  - `ItemsService.isMemberOfWorkspace` (the QR scan-landing
    re-authorization check) checks membership in the SCANNED resource's
    workspace, which is — again, by design — not the ambient one.

  Gating these tables by `app.workspace_id` would fight this access pattern
  at every one of those call sites rather than reinforce it. They stay
  app-scoped only, the same as `Workspace`/`User` themselves (which were
  never workspace-scoped to begin with — `Workspace` IS the tenant
  boundary, `User` is a cross-tenant identity).
- **`ItemTag` / `BomLine`** — no `workspaceId` column of their own (see the
  Prisma schema header note); they inherit scope transitively via a
  required FK to an RLS-protected parent (`Item`/`Project`). No endpoint
  exposes direct, unscoped access to either.

**What this means for a direct-DB or SQLi-class attacker (round-2 review,
SHOULD FIX finding 7 — stated explicitly, not just implied):**

- `User`, `Workspace`, `WorkspaceMember`, and `WorkspaceInvite` have **NO**
  RLS containment layer at all. A direct-database attacker (a leaked
  connection string, a SQL-injection primitive that reaches raw SQL, etc.)
  can read or write ANY row in these four tables — including
  self-granting a `WorkspaceMember` row for any `Workspace`/`User` pair, or
  minting/redeeming an arbitrary `WorkspaceInvite`. RLS's containment
  guarantee for THIS task only covers the eight domain tables listed above;
  the membership/identity tables remain app-scoping's responsibility alone
  (see "Scope" above for why RLS can't cleanly cover them without a
  chicken-and-egg problem at every membership-resolution call site).
- RLS does **not** constrain foreign-key **referential** checks. A FK
  constraint (e.g. `Item.locationId -> Location.id`) is validated by
  Postgres against the referenced row's raw existence, not filtered through
  the referencING role's RLS policy — so RLS by itself cannot stop a
  cross-workspace FK reference from being written. That's still
  APPLICATION-scoping's job (`ItemsService.assertLocationInWorkspace` /
  `assertCategoryInWorkspace` / `assertPhotosInWorkspace` and their
  equivalents elsewhere), same as before this task — RLS is a backstop for
  workspace ISOLATION of a table's own rows, not a substitute for validating
  cross-table references belong to the same tenant.
- Child tables with no `workspaceId` of their own (`ItemTag`, `BomLine`)
  rely ENTIRELY on their required parent FK (`Item`/`Project`) being
  RLS-protected — they have no independent containment; a bug that let a
  caller write an `ItemTag`/`BomLine` row pointing at a foreign-workspace
  parent id would only be caught by that FK's referential integrity (does
  the parent row exist at all, from the writer's OWN RLS-filtered view) or
  by application-level scoping, not by a policy on the child table itself
  (it has none).

## The read-only cross-tenant bypass (`app.rls_bypass_read`)

One legitimate feature is deliberately cross-tenant by design:
`ItemsController.findByQr` (`GET /api/items/by-qr/:qr`) resolves a physical
QR code's `qrCode` column, which stays **globally** unique on purpose — a
printed label must scan regardless of which workspace it belongs to — and
only re-authorizes the caller AFTER resolution, against the RESOLVED
resource's own workspace (`isMemberOfWorkspace`).

Rather than routing this through a second, privileged Postgres role, the
EVT-44 migration adds a second, narrowly-scoped session flag,
`app.rls_bypass_read` — and (round-2 review, MAJOR finding 2) **four
separate per-command policies** per table, not one `FOR ALL` policy, so the
flag can only ever widen `SELECT`:

```sql
CREATE POLICY workspace_isolation_select ON "Item"
  FOR SELECT
  USING (
    "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
    OR current_setting('app.rls_bypass_read', true) = 'true'
  );

CREATE POLICY workspace_isolation_insert ON "Item"
  FOR INSERT
  WITH CHECK ("workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY workspace_isolation_update ON "Item"
  FOR UPDATE
  USING ("workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid)
  WITH CHECK ("workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

CREATE POLICY workspace_isolation_delete ON "Item"
  FOR DELETE
  USING ("workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
```

**Why not one `FOR ALL` policy with a single `USING`/`WITH CHECK` pair (the
original shape of this migration)?** Postgres applies a `FOR ALL` policy's
ONE `USING` clause to SELECT, the pre-image read of UPDATE, **and** DELETE —
DELETE has no `WITH CHECK` at all, `USING` is its only gate. That meant the
"read-only" bypass flag actually let a caller who controlled it (1) `DELETE`
any workspace's rows, and (2) `UPDATE ... SET "workspaceId" = <mine> WHERE
id = <victim>` — the bypass let `USING` pass for the victim row, and the
write's own new `workspaceId` value satisfied `WITH CHECK` without needing
the bypass there at all. Splitting into four per-command policies closes
both: `WITH CHECK` never honors the flag on ANY command, and UPDATE/DELETE's
`USING` clauses don't either — an INSERT/UPDATE/DELETE always requires an
exact `app.workspace_id` match, even if a caller somehow controlled both
session settings. See `ItemsService.findByQr`'s and `QrService`'s doc
comments for the exact transaction shape, and
`test/rls-isolation.e2e-spec.ts`'s AC4 tests for the "still resolves
correctly" proof plus THREE "can never become a write" proofs (a raw
`UPDATE` that changes an unrelated column, a `DELETE`, and the
`workspaceId`-rewrite theft attempt — all attempted with the bypass flag
set, all rejected by Postgres itself).

## Admin/migration paths that legitimately cross workspaces

- **`WorkspacesService.create`** — a brand-new `Workspace` row's very first
  `WorkspaceMember` insert. Not an RLS concern (`WorkspaceMember` is out of
  scope, see above) — no special handling needed.
- **One-off data backfills** — any future backfill migration runs as raw
  SQL under the `eventory` owner/superuser role (via `DATABASE_URL`, the
  same role every existing migration already uses), which bypasses RLS
  automatically by virtue of being a superuser. No new mechanism needed;
  this is the same escape hatch every Postgres migration tool relies on.
- **`AdminUsersPage` / `UsersController`** — operates entirely on `User`
  (global, not workspace-scoped) and never touches an RLS-protected table.

## Connection-pooling correctness (`SET LOCAL`, not `SET`)

Postgres's `SET LOCAL`/`set_config(..., true)` is transaction-scoped: it
only affects statements within the SAME transaction, and resets at
COMMIT/ROLLBACK. Since Prisma's connection pool reuses physical connections
across unrelated requests, a session-level `SET` (not `SET LOCAL`) would leak
one request's workspace into another's queries on the same pooled
connection. `PrismaService` (see that file's own extensive doc comment)
closes this two ways:

1. `$transaction` is overridden so every EXISTING interactive transaction
   call site (`this.prisma.$transaction(async (tx) => {...})` — the
   advisory-lock paths in `LocationsService`, the BOM backflush in
   `ProjectsService`, etc.) transparently gets `set_config(...)` injected as
   its first statement, with zero call-site changes.
2. A `Proxy` wraps each RLS-scoped model delegate so a STANDALONE
   (non-transaction) call is transparently rewritten into a two-statement
   sequential `$transaction([setConfig, query])`.

Both paths read the ambient workspace from `workspaceDbContext`
(`AsyncLocalStorage`), populated by `WorkspaceDbContextInterceptor` — a
global interceptor, not `WorkspaceContextGuard` itself. See that
interceptor's doc comment for why: an earlier version of this task set the
ALS context directly inside the guard via `enterWith()`, and an e2e test
firing two concurrent tenant-scoped requests reproducibly corrupted a THIRD,
unrelated request's `app.workspace_id` — `enterWith()` mutates whatever
async context happens to be active rather than creating a new, isolated
boundary the way `.run()` does. `test/rls-isolation.e2e-spec.ts`'s AC3 test
reproduces the exact concurrency shape that caught this.

## Isolation audit — adversarial review sweep

Findings from reviewing every RLS-relevant code path in the codebase:

1. **The `eventory` bootstrap role is a superuser** (see above) — without a
   second role, RLS would have been a no-op for 100% of application
   traffic. Fixed via the `eventory_rls` role split.
2. **`WorkspaceContextGuard`'s own membership lookups are inherently
   cross-tenant** — resolving "does this user belong to workspace X" cannot
   itself be scoped to workspace X's `app.workspace_id` without a
   chicken-and-egg problem. Resolved by scoping RLS to domain tables only
   (see "Scope" above), not `WorkspaceMember`.
3. **`ItemsService.findByQr`'s two lookups (`Item`/`Location` by `qrCode`)
   are deliberately cross-tenant** — would have been silently broken by a
   naive "always scope to ambient workspace" policy. Resolved via the
   read-only `app.rls_bypass_read` flag (see above), which cannot be used
   for a write.
4. **`enterWith()` vs `.run()`** — see "Connection-pooling correctness"
   above; caught by an interleaved-request e2e test, not by inspection.
5. **`Prisma`'s `$extends` query-extension hook does not reliably see
   `AsyncLocalStorage` context** — Prisma Client defers a model operation's
   actual dispatch through internal machinery that does not preserve the
   caller's ALS context, so an `$allModels.$allOperations` hook consistently
   observed `getStore() === undefined` even when the call site was
   synchronously inside `workspaceDbContext.run(...)`. Caught empirically
   (an early version of `PrismaService` silently ran EVERY "auto-wrapped"
   query completely unscoped — reads returned zero rows as if RLS were
   working, but writes failed outright, since `WITH CHECK` also saw no
   setting). Resolved with a hand-rolled `Proxy` instead, which captures the
   ALS store synchronously in the same call frame as the invoking
   application code — see `PrismaService`'s doc comment for the full
   writeup.
6. **`BomLine`/`ItemTag` have no `workspaceId` of their own** — documented
   as an accepted, transitively-scoped exclusion (see "Scope" above), not
   silently overlooked.

## Verifying this locally

`test/rls-isolation.e2e-spec.ts` proves, against the real e2e Postgres
container (not mocks):

- **AC1** — a query against the restricted role, with no `app.workspace_id`
  session setting, returns zero rows for data that genuinely exists.
- **AC2** — calling `PrismaService.item.findMany()` directly, bypassing
  `WorkspaceContextGuard`/the ambient context entirely (simulating a
  developer who forgot a `where: { workspaceId }` filter), is blocked by
  RLS — not just by application code.
- **AC3** — two interleaved, concurrently-running ambient-scoped requests on
  the SAME `PrismaService` connection pool never see each other's
  workspace; the advisory-lock rename transaction
  (`LocationsService.rename`) still succeeds correctly under RLS when two
  different workspaces rename concurrently.
- **AC4** — the QR cross-workspace bypass still resolves correctly under
  RLS, and the read-only bypass flag can never be turned into a
  cross-tenant write.

Run it directly with:

```bash
cd apps/api
pnpm exec jest --config jest.e2e.config.js test/rls-isolation.e2e-spec.ts
```
