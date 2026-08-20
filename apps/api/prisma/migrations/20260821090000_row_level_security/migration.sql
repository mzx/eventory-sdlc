-- EVT-44: Postgres row-level security (RLS) backstop + cross-tenant
-- isolation audit — the "later hardening task" flagged by the EVT-39
-- migration's own header comment (operator decision 2026-08-20: shared-DB
-- row scoping with memberships now, RLS as a deferred containment layer).
--
-- Layered model (see docs/operations/tenancy-rls.md for the full writeup):
--   - Application scoping (EVT-40/EVT-41) is CORRECTNESS — every controller
--     resolves `@CurrentWorkspace()` and every service filters its Prisma
--     calls by that `workspaceId`. It fails OPEN: a forgotten `where`
--     clause silently returns/mutates another workspace's rows.
--   - This migration's RLS policies are CONTAINMENT — a Postgres-level
--     backstop that fails CLOSED: with no `app.workspace_id` set (or set to
--     the wrong workspace), the affected tables return/accept zero rows,
--     regardless of what the application query itself asked for.
--
-- RLS is a NO-OP against a role that is a Postgres superuser (superusers
-- ALWAYS bypass RLS, `FORCE ROW LEVEL SECURITY` notwithstanding) OR against
-- the table owner UNLESS `FORCE ROW LEVEL SECURITY` is set. The `eventory`
-- role this project's docker-compose/`POSTGRES_USER` bootstraps IS a
-- superuser (it's the cluster's initdb bootstrap role) — so this migration
-- also creates a second, deliberately UNprivileged role, `eventory_rls`,
-- and the application's runtime connection (`PrismaService`, wired via the
-- new `APP_DATABASE_URL` env var — see apps/api/.env.example,
-- docker-compose.yml, docker-compose.prod.yml) is repointed to it. Schema
-- migrations keep running as the original owner role via `DATABASE_URL`
-- (unchanged) — DDL (this file included) needs owner/superuser privileges
-- `eventory_rls` deliberately does NOT have.
--
-- Scope: every table with its own `workspaceId` column EXCEPT
-- `WorkspaceMember`/`WorkspaceInvite` — those two are membership/identity
-- RESOLUTION tables, not workspace-scoped DOMAIN data. Every access to them
-- (`WorkspaceContextGuard`'s own tenant resolution, `WorkspacesService`'s
-- explicit per-:id-param `requireMembership`/`requireOwner`,
-- `ItemsService.isMemberOfWorkspace` for QR scan-landing) is an EXPLICIT,
-- already-tested, non-ambient `where: { workspaceId, userId }` lookup — by
-- design, sometimes for a DIFFERENT workspace than the caller's ambient
-- one (that's the whole point of a membership check). Gating them by the
-- ambient `app.workspace_id` session setting would fight that access
-- pattern at every call site rather than reinforce it, so the isolation
-- audit's conclusion (docs/operations/tenancy-rls.md) is to leave them
-- app-scoped only, same as `Workspace`/`User` themselves. `BomLine`/
-- `ItemTag` are similarly out of scope — see the schema header note: they
-- carry no `workspaceId` of their own, inheriting it transitively via a
-- required FK to an RLS-protected parent (`Project`/`Item`), and no
-- endpoint exposes direct unscoped access to either.
--
-- `app.rls_bypass_read`: a second, narrowly-scoped session flag, read-only
-- by design — lets `ItemsService.findByQr` / `QrService.assertTokenExists`
-- resolve a physical QR code across ALL workspaces (by design: `qrCode`
-- stays globally unique so a printed label always scans, see the schema's
-- `qrCode` doc comment) while the caller is then re-authorized against the
-- RESOLVED resource's own workspace (`isMemberOfWorkspace`) before anything
-- is returned.
--
-- Round-2 review (MAJOR, finding 2): a single `CREATE POLICY ... FOR ALL`
-- (this migration's original shape) applies its ONE `USING` clause to
-- SELECT, the pre-image read of UPDATE, AND DELETE — DELETE has no
-- `WITH CHECK` at all, Postgres only ever checks `USING` for it. That meant
-- the bypass flag, despite being documented as "read-only", actually let a
-- caller who controlled it (1) DELETE any workspace's rows (`USING` alone
-- gates DELETE) and (2) rewrite a victim row's OWN `workspaceId` to the
-- caller's session value via `UPDATE ... SET "workspaceId" = <mine> WHERE
-- id = <victim>` — the bypass flag let `USING` (pre-image) pass for the
-- victim row, and the write's new `workspaceId` value satisfied `WITH
-- CHECK` on its own, with no bypass needed there at all. Both are
-- cross-tenant WRITES smuggled through a flag that was supposed to only
-- ever widen a read.
--
-- Fixed by splitting into FOUR per-command policies below, instead of one
-- `FOR ALL` policy — `USING`/`WITH CHECK` apply per Postgres's own command
-- table (https://www.postgresql.org/docs/current/sql-createpolicy.html):
--   - `FOR SELECT USING (... OR bypass)` — the bypass flag ONLY ever
--     widens this one.
--   - `FOR INSERT WITH CHECK (...)` — no bypass; exact `app.workspace_id`
--     match required, same as before.
--   - `FOR UPDATE USING (...) WITH CHECK (...)` — no bypass on EITHER
--     clause: a caller can only see (pre-image) and write (post-image) rows
--     in their OWN ambient workspace. Closes the workspaceId-rewrite theft
--     above.
--   - `FOR DELETE USING (...)` — no bypass: a caller can only delete rows
--     in their OWN ambient workspace. Closes the bypass-DELETE hole above.
-- See `test/rls-isolation.e2e-spec.ts`'s AC4 tests (the DELETE case and the
-- workspaceId-rewrite UPDATE case, both attempted adversarially WITH the
-- bypass flag set) for the proof these are now blocked, and AC1/AC2/AC3 for
-- proof ordinary SELECT/INSERT/UPDATE/DELETE still work correctly without
-- the flag.

-- ---------------------------------------------------------------------------
-- 1. The unprivileged runtime role.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'eventory_rls') THEN
    -- Placeholder password, intentionally readable in version control —
    -- consistent with this project's existing dev-scale convention
    -- (docker-compose.yml already hardcodes `eventory`/`eventory`). Any real
    -- (internet-facing) deployment MUST rotate it before go-live:
    --   ALTER ROLE eventory_rls PASSWORD '<strong-random-value>';
    -- then update the deployment's `APP_DATABASE_URL` secret to match — see
    -- docs/operations/tenancy-rls.md, same rotation contract this project
    -- already documents for JWT_SECRET/GOOGLE_CLIENT_SECRET.
    CREATE ROLE eventory_rls
      LOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS
      PASSWORD 'eventory_rls_change_me';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO eventory_rls', current_database());
END
$$;

GRANT USAGE ON SCHEMA public TO eventory_rls;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eventory_rls;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eventory_rls;

-- Round-2 review (SHOULD FIX, finding 7): the blanket `ALL TABLES` grant
-- above also reaches Prisma's own internal `_prisma_migrations` ledger —
-- `eventory_rls` (the runtime role) has no legitimate reason to read or
-- write migration history, only the owner/superuser role running
-- migrations does. Revoking here (idempotent — safe to run even if a
-- future migration re-runs this file's logic) narrows the runtime role's
-- blast radius without affecting any application behavior.
REVOKE ALL ON "_prisma_migrations" FROM eventory_rls;

-- Future tables/sequences created by whichever role runs migrations (the
-- owner — `current_user` at migration time, whatever it's named) also get
-- granted to `eventory_rls` automatically, so a forgotten grant on a future
-- migration can't silently 403 the entire app.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eventory_rls',
    current_user
  );
  EXECUTE format(
    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eventory_rls',
    current_user
  );
END
$$;

-- ---------------------------------------------------------------------------
-- 2. RLS policies — one identical shape per workspace-scoped domain table.
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  workspace_scoped_tables CONSTANT text[] := ARRAY[
    'Item', 'Location', 'Category', 'Tag', 'Photo', 'Project',
    'StockMovement', 'ShoppingListEntry'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY workspace_scoped_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE, not just ENABLE: without it, the table OWNER (the role that
    -- ran this migration) would silently bypass every policy below, which
    -- is exactly the "silent superuser default" AC4 says not to rely on.
    -- `eventory_rls` isn't the owner anyway (see step 1), so this only
    -- matters if the owner role is ever (mis)used for runtime traffic.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);

    -- SELECT — the ONLY command the read-only bypass flag ever widens.
    EXECUTE format(
      $policy$
        CREATE POLICY workspace_isolation_select ON %I
          FOR SELECT
          USING (
            "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
            OR current_setting('app.rls_bypass_read', true) = 'true'
          )
      $policy$,
      t
    );

    -- INSERT — exact ambient-workspace match only, never the bypass flag.
    EXECUTE format(
      $policy$
        CREATE POLICY workspace_isolation_insert ON %I
          FOR INSERT
          WITH CHECK (
            "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
          )
      $policy$,
      t
    );

    -- UPDATE — exact ambient-workspace match on BOTH the pre-image (USING)
    -- and post-image (WITH CHECK); no bypass on either clause, closing the
    -- workspaceId-rewrite cross-tenant-theft finding (see doc comment above).
    EXECUTE format(
      $policy$
        CREATE POLICY workspace_isolation_update ON %I
          FOR UPDATE
          USING (
            "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
          )
          WITH CHECK (
            "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
          )
      $policy$,
      t
    );

    -- DELETE — exact ambient-workspace match only; no bypass (DELETE has no
    -- WITH CHECK at all in Postgres, so USING is the ONLY gate for it).
    EXECUTE format(
      $policy$
        CREATE POLICY workspace_isolation_delete ON %I
          FOR DELETE
          USING (
            "workspaceId" = NULLIF(current_setting('app.workspace_id', true), '')::uuid
          )
      $policy$,
      t
    );
  END LOOP;
END
$$;
