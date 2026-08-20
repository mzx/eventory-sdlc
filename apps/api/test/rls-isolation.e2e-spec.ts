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
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
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
    }).compile();

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

    it('the read-only app.rls_bypass_read flag can NEVER be used to write into another workspace — WITH CHECK ignores it', async () => {
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
        await expect(
          client.query('UPDATE "Item" SET name = $1 WHERE id = $2', ['hijacked', item.id]),
        ).rejects.toThrow(/row-level security/i);
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }

      // Confirm the row was genuinely untouched.
      const stillOwned = await fixture.workspaceA.owner.get(`/api/items/${item.id}`).expect(200);
      expect(stillOwned.body.name).toBe('AC4 write-guard item');
    });
  });
});
