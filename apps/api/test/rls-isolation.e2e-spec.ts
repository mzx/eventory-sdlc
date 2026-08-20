/**
 * Postgres row-level security backstop — end-to-end (EVT-44).
 *
 * `tenancy-isolation.e2e-spec.ts`/`tenancy-isolation-evt41.e2e-spec.ts`
 * already prove APPLICATION-layer scoping (every controller/service filters
 * by `workspaceId`) across both prior tenancy tasks. This file proves the
 * NEW, independent DATABASE layer underneath it — the RLS policies +
 * `eventory_rls` role split the EVT-44 migration adds — by deliberately
 * bypassing or misusing the application layer and confirming Postgres
 * itself still blocks the request. Every describe block below is mapped to
 * one of this task's acceptance criteria:
 *
 *   AC1 — RLS fails closed: a query against the restricted role with no
 *          `app.workspace_id` session setting returns zero rows, even
 *          though matching data exists.
 *   AC2 — a deliberately-unscoped `PrismaService` call (simulating a
 *          developer who forgot a `where: { workspaceId }` filter) is
 *          blocked by RLS, not just by application code.
 *   AC3 — two interleaved ambient-scoped requests sharing the SAME
 *          `PrismaService` connection pool never see each other's
 *          workspace; the advisory-lock (`LocationsService.rename`)
 *          transaction still composes correctly with the `SET LOCAL`
 *          injection under concurrent load.
 *   AC4 — the cross-workspace QR bypass (`ItemsService.findByQr`) still
 *          resolves correctly under RLS, and the read-only bypass flag it
 *          uses can never be turned into a cross-tenant WRITE.
 *
 * Runs against the SAME shared `evt3-test-postgres` container as every
 * other e2e suite (`global-setup.ts` already applies every migration,
 * including EVT-44's, before any test file runs) — but where every other
 * suite bootstraps `AppModule` with `DATABASE_URL` pointed at the migration
 * OWNER role (`eventory`, a superuser — RLS is a structural no-op for it,
 * by design, see the migration's doc comment), THIS file ALSO sets
 * `APP_DATABASE_URL` to the restricted `eventory_rls` role, so
 * `PrismaService`'s connection is the one actually under test.
 */

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { Client } from 'pg';
import supertest from 'supertest';
import { AiService } from '../src/ai/ai.service';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService, RLS_SCOPED_MODELS } from '../src/prisma/prisma.service';
import { workspaceDbContext } from '../src/workspace/workspace-context';
import { AuthedHttp } from './e2e-auth-helper';
import { seedTwoWorkspaces, TwoWorkspaceFixture } from './two-workspace-harness';

// ---------------------------------------------------------------------------
// Test database URLs
// ---------------------------------------------------------------------------

const OWNER_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

/**
 * The `eventory_rls` role the EVT-44 migration creates, against the SAME
 * shared e2e database. `global-setup.ts` runs every migration (via
 * `prisma migrate deploy`, as the owner role) before any test file runs, so
 * this role already exists by the time this file's `beforeAll` connects.
 */
const RLS_DB_URL =
  process.env.TEST_APP_DATABASE_URL ??
  'postgresql://eventory_rls:eventory_rls_change_me@localhost:5433/eventory_test?schema=public';

async function createItem(http: AuthedHttp, name: string): Promise<{ id: string; qrCode: string }> {
  const res = await http.post('/api/items').send({ name, quantity: 1 }).expect(201);
  return { id: res.body.id as string, qrCode: res.body.qrCode as string };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Postgres RLS backstop (e2e, EVT-44)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixture: TwoWorkspaceFixture;
  // AC5 — `AiService` is overridden with a mock (same pattern as
  // `search-by-photo.e2e-spec.ts`) so the photo-search raw-SQL path can be
  // exercised deterministically, without a real (billed) vision call and
  // without depending on whether an API key happens to be configured in
  // this environment (a stub analysis yields zero search terms, which would
  // never reach the raw-SQL matching query at all).
  const analyzePhotoMock = jest.fn();

  // `jest.e2e.config.js` runs every `*.e2e-spec.ts` file SEQUENTIALLY in the
  // SAME worker process (`maxWorkers: 1`) — `process.env` is a plain global
  // Node object, not scoped per test file, so `APP_DATABASE_URL` MUST be
  // restored in `afterAll` below. Left set, every OTHER e2e suite's
  // `PrismaService` (bootstrapped from a LATER `*.e2e-spec.ts` file, which
  // has no reason to expect RLS is active) would silently start connecting
  // as the restricted `eventory_rls` role too — caught empirically as a
  // batch of unrelated 401s in sibling suites before this restore existed.
  const previousAppDatabaseUrl = process.env.APP_DATABASE_URL;

  beforeAll(async () => {
    process.env.DATABASE_URL = OWNER_DB_URL;
    process.env.APP_DATABASE_URL = RLS_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AiService)
      .useValue({ analyzePhoto: analyzePhotoMock })
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    // Mirrors src/main.ts's bootstrap() exactly.
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'storage/:filename', method: RequestMethod.GET }],
    });
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    const authService = moduleFixture.get<AuthService>(AuthService);
    fixture = await seedTwoWorkspaces(app, prisma, authService);
  });

  afterAll(async () => {
    await app.close();
    process.env.APP_DATABASE_URL = previousAppDatabaseUrl;
  });

  beforeEach(() => {
    analyzePhotoMock.mockReset();
  });

  // =========================================================================
  // AC1 — fail closed: no session setting -> zero rows, even with data
  // present.
  // =========================================================================

  describe('AC1: RLS fails closed with no app.workspace_id set', () => {
    it('a raw query against the restricted role, with NO session setting at all, sees zero rows for a row that genuinely exists', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC1 fail-closed item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        const { rows } = await client.query('SELECT id FROM "Item" WHERE id = $1', [item.id]);
        expect(rows).toHaveLength(0);
      } finally {
        await client.end();
      }
    });

    it('the SAME row becomes visible once app.workspace_id is set to its OWN workspace, inside a transaction', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC1 correctly-scoped item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceA.id,
        ]);
        const { rows } = await client.query('SELECT id FROM "Item" WHERE id = $1', [item.id]);
        expect(rows).toHaveLength(1);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    });

    it('stays zero rows even set to the WRONG workspace', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC1 wrong-workspace item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceB.id,
        ]);
        const { rows } = await client.query('SELECT id FROM "Item" WHERE id = $1', [item.id]);
        expect(rows).toHaveLength(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    });
  });

  // =========================================================================
  // AC2 — a deliberately-unscoped app-level query is blocked by RLS, not
  // just by application code.
  // =========================================================================

  describe('AC2: a deliberately-unscoped app-level query is blocked by RLS', () => {
    it('calling PrismaService.item.findMany() directly, bypassing WorkspaceContextGuard/the ambient context entirely, returns zero rows despite items existing in BOTH workspaces', async () => {
      await createItem(fixture.workspaceA.owner, 'AC2 unscoped A');
      await createItem(fixture.workspaceB.owner, 'AC2 unscoped B');

      // This is exactly the bug class RLS exists to backstop: a service
      // method that forgot its `where: { workspaceId }` filter. No
      // `workspaceDbContext.run(...)` wrapper here on purpose.
      const allItems = await prisma.item.findMany();
      expect(allItems).toHaveLength(0);
    });

    it('the SAME unscoped call succeeds once wrapped in the ambient workspace context (proves the block above is RLS, not a broken connection)', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC2 control item');

      const items = await workspaceDbContext.run({ workspaceId: fixture.workspaceA.id }, () =>
        prisma.item.findMany({ where: { id: item.id } }),
      );
      expect(items).toHaveLength(1);
    });
  });

  // =========================================================================
  // AC3 — interleaved requests on the shared connection pool never leak;
  // advisory-lock/backflush transactions still compose with the SET LOCAL
  // injection.
  // =========================================================================

  describe('AC3: interleaved requests never leak; advisory-lock transactions still work', () => {
    it('two concurrent ambient-scoped reads on the SAME PrismaService instance never see the other workspace, even when interleaved on a shared pool', async () => {
      const itemA = await createItem(fixture.workspaceA.owner, 'AC3 interleave A');
      const itemB = await createItem(fixture.workspaceB.owner, 'AC3 interleave B');

      const [resultsA, resultsB] = await Promise.all([
        workspaceDbContext.run({ workspaceId: fixture.workspaceA.id }, async () => {
          // Deliberately delay A's actual query so B's concurrent request
          // is issued (and would apply ITS OWN set_config) while A is still
          // "in flight" — this is the exact race the task's Risk note
          // describes: a pooled connection reused between requests before
          // this file existed would let B's SET LOCAL win for A's read.
          await new Promise((resolve) => setTimeout(resolve, 30));
          return prisma.item.findMany({ where: { id: { in: [itemA.id, itemB.id] } } });
        }),
        workspaceDbContext.run({ workspaceId: fixture.workspaceB.id }, () =>
          prisma.item.findMany({ where: { id: { in: [itemA.id, itemB.id] } } }),
        ),
      ]);

      expect(resultsA.map((i) => i.id)).toEqual([itemA.id]);
      expect(resultsB.map((i) => i.id)).toEqual([itemB.id]);
    });

    it('the advisory-lock rename transaction (LocationsService.rename) still succeeds under RLS when two DIFFERENT workspaces rename concurrently', async () => {
      const locA = await fixture.workspaceA.owner
        .post('/api/locations')
        .send({ name: 'AC3 Garage A' })
        .expect(201);
      const locB = await fixture.workspaceB.owner
        .post('/api/locations')
        .send({ name: 'AC3 Garage B' })
        .expect(201);

      const [resA, resB] = await Promise.all([
        fixture.workspaceA.owner
          .patch(`/api/locations/${locA.body.id}`)
          .send({ name: 'AC3 Garage A Renamed' }),
        fixture.workspaceB.owner
          .patch(`/api/locations/${locB.body.id}`)
          .send({ name: 'AC3 Garage B Renamed' }),
      ]);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      expect(resA.body.name).toBe('AC3 Garage A Renamed');
      expect(resB.body.name).toBe('AC3 Garage B Renamed');

      // Cross-check: A's rename is invisible from B's side and vice versa.
      await fixture.workspaceB.owner.get(`/api/locations/${locA.body.id}`).expect(404);
      await fixture.workspaceA.owner.get(`/api/locations/${locB.body.id}`).expect(404);
    });
  });

  // =========================================================================
  // AC4 — the cross-workspace QR bypass still resolves correctly under RLS,
  // and can never be used to smuggle a cross-tenant write.
  // =========================================================================

  describe('AC4: cross-workspace QR bypass reads work; the bypass flag can never enable a write', () => {
    it('findByQr resolves an item across the ambient workspace boundary, then re-authorizes — still works with RLS active', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC4 QR item');

      const ownRes = await fixture.workspaceA.owner
        .get(`/api/items/by-qr/${item.qrCode}`)
        .expect(200);
      expect(ownRes.body.item.id).toBe(item.id);

      // A non-member of the item's workspace still gets a neutral 404 —
      // `isMemberOfWorkspace` re-authorizes AFTER the RLS-bypassed lookup.
      await fixture.workspaceB.owner.get(`/api/items/by-qr/${item.qrCode}`).expect(404);
    });

    it('the read-only app.rls_bypass_read flag can NEVER be used to write into another workspace — matches zero rows under the per-command UPDATE policy', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC4 write-guard item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.rls_bypass_read', 'true', true)");
        // Ambient workspace deliberately set to the WRONG (B) workspace —
        // simulates the worst case: an attacker who somehow controls both
        // session settings still cannot smuggle a cross-tenant write.
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceB.id,
        ]);
        // Round-2 review, finding 2: under the OLD single `FOR ALL` policy,
        // the bypass flag let USING's pre-image check pass for this row
        // (workspace A), so the UPDATE actually reached WITH CHECK, which
        // then rejected the post-image (still workspace A, not matching the
        // ambient B setting) with a thrown "row-level security" error.
        // Under the per-command UPDATE policy (no bypass on USING at all),
        // the row is invisible to this UPDATE from the START — Postgres
        // treats that exactly like a WHERE clause that matched nothing: NO
        // error, just zero rows affected. Equally safe (the write is still
        // fully blocked), just a different Postgres-level mechanism.
        const result = await client.query('UPDATE "Item" SET name = $1 WHERE id = $2', [
          'hijacked',
          item.id,
        ]);
        expect(result.rowCount).toBe(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      // Confirm the row was genuinely untouched.
      const stillOwned = await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(200);
      expect(stillOwned.body.name).toBe('AC4 write-guard item');
    });

    it('WITH CHECK independently rejects a workspaceId-changing write even when the pre-image IS visible (bypass never widens WITH CHECK, on ANY command)', async () => {
      const item = await createItem(
        fixture.workspaceA.owner,
        'AC4 with-check independent-guard item',
      );

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        // Bypass flag set (irrelevant to WITH CHECK either way) AND the
        // ambient workspace correctly matches the item's OWN workspace, so
        // USING's pre-image check passes on its own merits — no bypass
        // needed to reach WITH CHECK at all here.
        await client.query("SELECT set_config('app.rls_bypass_read', 'true', true)");
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceA.id,
        ]);
        // The write itself tries to reassign the row to workspace B — the
        // post-image no longer matches the ambient (A) setting, so WITH
        // CHECK rejects it outright, regardless of the bypass flag.
        await expect(
          client.query('UPDATE "Item" SET "workspaceId" = $1 WHERE id = $2', [
            fixture.workspaceB.id,
            item.id,
          ]),
        ).rejects.toThrow(/row-level security/i);
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }

      const stillOwnedByA = await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(200);
      expect(stillOwnedByA.body.id).toBe(item.id);
    });

    // -----------------------------------------------------------------------
    // Round-2 review, MAJOR finding 2 — the original single `FOR ALL`
    // policy applied its ONE `USING` clause (which honors the bypass flag)
    // to the pre-image of UPDATE and to DELETE, neither of which has a
    // `WITH CHECK` gate at all. The two tests below reproduce BOTH concrete
    // exploits the review called out, adversarially (bypass flag set AND
    // ambient workspace set to the ATTACKER's own workspace), and prove
    // Postgres now rejects/no-ops both after the per-command policy split.
    // -----------------------------------------------------------------------

    it("finding 2: the bypass flag can NEVER be used to steal another workspace's row via a workspaceId rewrite — UPDATE matches zero rows", async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC4 theft-guard item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.rls_bypass_read', 'true', true)");
        // Ambient workspace set to B (the attacker's own workspace) — under
        // the OLD `FOR ALL` policy, the bypass flag let USING's pre-image
        // check pass for A's row, and the post-image (workspaceId := B,
        // matching the ambient setting) trivially satisfied WITH CHECK —
        // the row would be silently reassigned from A to B.
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceB.id,
        ]);
        const result = await client.query('UPDATE "Item" SET "workspaceId" = $1 WHERE id = $2', [
          fixture.workspaceB.id,
          item.id,
        ]);
        // No error thrown (UPDATE's USING clause behaves like a WHERE
        // filter, not a hard failure) — but crucially, zero rows matched:
        // the per-command UPDATE policy's USING clause no longer honors the
        // bypass flag, so workspace A's row is simply invisible to this
        // UPDATE at all.
        expect(result.rowCount).toBe(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      // The row still belongs to workspace A — never stolen into B.
      const stillOwnedByA = await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(200);
      expect(stillOwnedByA.body.name).toBe('AC4 theft-guard item');
      await fixture.workspaceB.owner.get(`/api/items/${item.id}`).expect(404);
    });

    it("finding 2: the bypass flag can NEVER be used to delete another workspace's row — DELETE matches zero rows", async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC4 delete-guard item');

      const client = new Client({ connectionString: RLS_DB_URL });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.rls_bypass_read', 'true', true)");
        // Ambient workspace set to the WRONG (B) workspace — under the OLD
        // `FOR ALL` policy, DELETE's only gate is USING, which honored the
        // bypass flag, so this DELETE would have succeeded against A's row.
        await client.query("SELECT set_config('app.workspace_id', $1, true)", [
          fixture.workspaceB.id,
        ]);
        const result = await client.query('DELETE FROM "Item" WHERE id = $1', [item.id]);
        expect(result.rowCount).toBe(0);
        await client.query('COMMIT');
      } finally {
        await client.end();
      }

      // The row was never deleted.
      const stillThere = await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(200);
      expect(stillThere.body.id).toBe(item.id);
    });

    it("sanity: an ORDINARY delete in the caller's OWN workspace (no bypass involved) still works through the app layer under the split policies", async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC4 legitimate delete item');

      await fixture.workspaceA.owner.delete(`/api/items/${item.id}`).expect(204);
      await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(404);
    });
  });

  // =========================================================================
  // AC5 — round-2 review, CRITICAL finding 1: `ItemsService`'s raw `$queryRaw`
  // calls (text search + photo-search matching) must be scoped through the
  // managed `$transaction`, not left unwrapped — otherwise the RLS Proxy
  // (which only wraps MODEL delegates) never applies `set_config`, and every
  // row is silently filtered out under the restricted role, regardless of
  // the query's own `WHERE "workspaceId" = ...` clause.
  // =========================================================================

  describe('AC5: raw-SQL search paths are RLS-scoped, not silently empty under the restricted role', () => {
    it("GET /api/items?search= returns the matching row in the caller's OWN workspace", async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC5 Cordless Drill Deluxe');
      await createItem(fixture.workspaceB.owner, 'AC5 unrelated widget');

      const res = await fixture.workspaceA.owner
        .get('/api/items?search=Cordless%20Drill')
        .expect(200);

      expect(res.body.map((i: { id: string }) => i.id)).toContain(item.id);
    });

    it('GET /api/items?search= never leaks a match from a DIFFERENT workspace', async () => {
      await createItem(fixture.workspaceA.owner, 'AC5 shared-name widget');
      const itemB = await createItem(fixture.workspaceB.owner, 'AC5 shared-name widget');

      const res = await fixture.workspaceB.owner.get('/api/items?search=shared-name').expect(200);

      expect(res.body.map((i: { id: string }) => i.id)).toEqual([itemB.id]);
    });

    it("POST /api/items/search-by-photo returns the matching row in the caller's OWN workspace", async () => {
      const item = await fixture.workspaceA.owner
        .post('/api/items')
        .send({ name: 'AC5 Photo-Matched Gizmo', tags: ['gizmo'] })
        .expect(201);
      await createItem(fixture.workspaceB.owner, 'AC5 unrelated in B');

      analyzePhotoMock.mockResolvedValue({
        suggested_name: 'Gizmo',
        description: '',
        tags: ['gizmo'],
        color: null,
        quantity: null,
        unit: null,
        properties: {},
        search_keywords: [],
      });

      const res = await fixture.workspaceA.owner
        .post('/api/items/search-by-photo')
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);

      expect(res.body.matches.map((m: { id: string }) => m.id)).toContain(item.body.id);
    });
  });

  // =========================================================================
  // AC6 — round-2 review, MAJOR finding 3: the `@Public()` QR route
  // (`GET /api/qr/:token`) has no ambient workspace at all —
  // `QrService.assertTokenExists` must apply the same read-only
  // `app.rls_bypass_read` pattern `ItemsService.findByQr` uses, or every
  // valid printed sticker 404s under the restricted role.
  // =========================================================================

  describe('AC6: the public QR PNG render route resolves correctly with NO ambient workspace at all', () => {
    it('GET /api/qr/:token (no auth cookie at all) renders a PNG for an existing item token', async () => {
      const item = await createItem(fixture.workspaceA.owner, 'AC6 QR public item');

      const res = await supertest(app.getHttpServer()).get(`/api/qr/${item.qrCode}`).expect(200);

      expect(res.headers['content-type']).toBe('image/png');
    });

    it('GET /api/qr/:token (no auth cookie at all) renders a PNG for an existing LOCATION token', async () => {
      const locRes = await fixture.workspaceA.owner
        .post('/api/locations')
        .send({ name: 'AC6 QR public location' })
        .expect(201);

      const res = await supertest(app.getHttpServer())
        .get(`/api/qr/${locRes.body.qrCode}`)
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
    });

    it('GET /api/qr/:token still 404s for an unknown token, with no ambient workspace at all', async () => {
      await supertest(app.getHttpServer()).get('/api/qr/no-such-token-anywhere').expect(404);
    });
  });

  // =========================================================================
  // AC7 (self-maintenance, round-2 review finding 8) — every table with its
  // own `workspaceId` column (minus the documented WorkspaceMember/
  // WorkspaceInvite exclusions) must have RLS policies AND be listed in
  // `PrismaService`'s `RLS_SCOPED_MODELS` — a future workspace-scoped table
  // can't silently ship without all three staying in sync. Also asserts each
  // scoped table carries the 4 per-command policies from the finding-2 fix,
  // not a single `FOR ALL` policy.
  // =========================================================================

  describe('AC7 (self-maintenance): workspaceId columns, pg_policies, and RLS_SCOPED_MODELS stay in sync', () => {
    /**
     * Deliberately excluded from RLS — membership/identity RESOLUTION
     * tables, not workspace-scoped domain data (see
     * docs/operations/tenancy-rls.md's "Scope" section for the full
     * rationale: every access to them is an explicit, non-ambient lookup by
     * design, often for a workspace OTHER than the caller's ambient one).
     */
    const DOCUMENTED_UNSCOPED_TABLES = new Set(['WorkspaceMember', 'WorkspaceInvite']);

    function toModelPropertyName(tableName: string): string {
      return tableName.charAt(0).toLowerCase() + tableName.slice(1);
    }

    it('every workspaceId-bearing table (minus documented exclusions) has RLS policies and is in RLS_SCOPED_MODELS — and nothing extra is', async () => {
      const client = new Client({ connectionString: OWNER_DB_URL });
      await client.connect();
      try {
        const { rows: columnRows } = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'workspaceId'
           ORDER BY table_name`,
        );
        const tablesWithWorkspaceId = columnRows.map((r) => r.table_name);

        const { rows: policyRows } = await client.query<{ tablename: string }>(
          `SELECT DISTINCT tablename FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename`,
        );
        const tablesWithPolicies = new Set(policyRows.map((r) => r.tablename));

        const expectedScopedTables = tablesWithWorkspaceId.filter(
          (t) => !DOCUMENTED_UNSCOPED_TABLES.has(t),
        );
        // Guards against a vacuously-true assertion loop below if the
        // information_schema query itself regressed to returning nothing.
        expect(expectedScopedTables.length).toBeGreaterThan(0);

        for (const table of expectedScopedTables) {
          expect(tablesWithPolicies.has(table)).toBe(true);
          expect(RLS_SCOPED_MODELS.has(toModelPropertyName(table))).toBe(true);
        }

        // Reverse direction: nothing in RLS_SCOPED_MODELS is stale (points
        // at a table with no workspaceId column, or no actual policy).
        for (const modelName of RLS_SCOPED_MODELS) {
          const tableName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
          expect(tablesWithWorkspaceId).toContain(tableName);
          expect(tablesWithPolicies.has(tableName)).toBe(true);
        }

        // The documented exclusions must genuinely have NO policy — an
        // accidental "helpful" policy there would fight
        // WorkspaceContextGuard's own cross-tenant membership resolution.
        for (const excluded of DOCUMENTED_UNSCOPED_TABLES) {
          expect(tablesWithPolicies.has(excluded)).toBe(false);
        }

        // Round-2 review finding 2 — each scoped table must carry FOUR
        // per-command policies (SELECT/INSERT/UPDATE/DELETE), not one
        // `FOR ALL` policy.
        for (const table of expectedScopedTables) {
          const { rows: cmdRows } = await client.query<{ cmd: string }>(
            `SELECT cmd FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY cmd`,
            [table],
          );
          expect(cmdRows.map((r) => r.cmd)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        }
      } finally {
        await client.end();
      }
    });
  });
});
