/**
 * EVT-39 workspace schema migration — end-to-end proof against a
 * DATA-BEARING database (per the task's explicit risk note: "prove it
 * against a data-bearing database ... not just an empty one").
 *
 * Unlike every other `*.e2e-spec.ts` in this suite, this file does NOT
 * reuse the shared `evt3-test-postgres` container from `global-setup.ts` —
 * that container already has ALL migrations (including this task's)
 * applied before any test runs, so it can't demonstrate a backfill running
 * against pre-existing rows. Instead this file manages its own throwaway
 * Postgres container (a distinct name/port so it can never collide with the
 * dev DB on 5432 or the shared e2e DB on 5433) and drives the migration
 * history directly via `pg`, executing each `migration.sql` file's raw SQL
 * in order — everything up to (but excluding) the EVT-39 migration first,
 * then legacy-shaped rows are seeded directly (bypassing Prisma entirely,
 * since the generated client already reflects the POST-migration schema),
 * then the EVT-39 migration itself is executed and the backfill is
 * verified.
 *
 * Coverage:
 *   AC1 — every pre-existing row across every domain table lands in the
 *          Default Workspace; WorkspaceMember rows are created with the
 *          correct role mapping (admin -> owner, user -> member) and a
 *          pending user does NOT get a membership row
 *   AC2 — re-scoped uniqueness: the same tag name / location path is
 *          allowed in two different workspaces, but still rejected within
 *          one
 *   AC3 — `qrCode` stays globally unique across workspaces
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const CONTAINER_NAME = 'evt39-migration-e2e-postgres';
const DB_PORT = 5434;
const DB_USER = 'eventory';
const DB_PASS = 'eventory';
const DB_NAME = 'eventory_migration_test';
const DB_URL = `postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}`;

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'prisma', 'migrations');
const NEW_MIGRATION_NAME = '20260820020000_workspace_schema_foundation';
const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

// Fixed ids for the legacy rows seeded below (pre-EVT-39 shape) — spelled
// out so assertions can pinpoint exact rows without depending on Prisma.
const ADMIN_USER_ID = '11111111-1111-1111-1111-111111111111';
const MEMBER_USER_ID = '22222222-2222-2222-2222-222222222222';
const PENDING_USER_ID = '33333333-3333-3333-3333-333333333333';
const LOCATION_ID = '44444444-4444-4444-4444-444444444444';
const CATEGORY_ID = '55555555-5555-5555-5555-555555555555';
const TAG_ID = '66666666-6666-6666-6666-666666666666';
const ITEM_ID = '77777777-7777-7777-7777-777777777777';
const PROJECT_ID = '88888888-8888-8888-8888-888888888888';
const MOVEMENT_ID = '99999999-9999-9999-9999-999999999999';
const SHOPPING_ENTRY_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PHOTO_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const LEGACY_ITEM_QR = 'qr-legacy-item-evt39';

/** Ordered list of `{ name, sql }` for every migration folder on disk. */
function readMigrations(): { name: string; sql: string }[] {
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf-8'),
    }));
}

/**
 * EVT-46: `docker exec ... pg_isready` lies during postgres:16's startup.
 * `pg_isready` (and the healthcheck driving it) connects over the
 * container-LOCAL unix socket — but initdb runs a *temporary* postmaster on
 * that same unix socket (no TCP listener yet) to execute its bootstrap SQL
 * before starting the real, TCP-listening server. `pg_isready` happily
 * reports "accepting connections" against that temporary server, so this
 * probe used to return well before `-p ${DB_PORT}:5432` was actually
 * mapped and listening — `new Client({ connectionString: DB_URL }).connect()`
 * then died with "Connection terminated unexpectedly" in beforeAll,
 * intermittently and load-dependently (slower CI runners hit the window
 * more often).
 *
 * Fixed by retrying the REAL thing the caller needs — a successful
 * `client.connect()` against the externally mapped TCP port — instead of a
 * proxy signal from inside the container. initdb's socket-only phase can't
 * fake a TCP-level client handshake the way it fakes a unix-socket
 * `pg_isready`.
 */
async function waitForPostgres(timeoutMs = 30_000): Promise<Client> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const candidate = new Client({ connectionString: DB_URL });
    try {
      await candidate.connect();
      return candidate;
    } catch (err) {
      lastError = err;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(
    `Postgres container "${CONTAINER_NAME}" did not become ready (TCP) within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

describe('EVT-39 — migration backfill on pre-existing data (AC1-AC3, dedicated container)', () => {
  jest.setTimeout(90_000);

  let client: Client;

  beforeAll(async () => {
    // Defense in depth: drop any stale container from a previous crashed run.
    execSync(`docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`);
    execSync(
      [
        'docker run --rm -d',
        `--name ${CONTAINER_NAME}`,
        `-e POSTGRES_USER=${DB_USER}`,
        `-e POSTGRES_PASSWORD=${DB_PASS}`,
        `-e POSTGRES_DB=${DB_NAME}`,
        `-p ${DB_PORT}:5432`,
        'postgres:16',
      ].join(' '),
      { stdio: 'pipe' },
    );

    const migrations = readMigrations();
    const newMigrationIndex = migrations.findIndex((m) => m.name === NEW_MIGRATION_NAME);
    if (newMigrationIndex === -1) {
      throw new Error(`Could not find migration "${NEW_MIGRATION_NAME}" on disk`);
    }
    const legacyMigrations = migrations.slice(0, newMigrationIndex);
    const workspaceMigration = migrations[newMigrationIndex];

    client = await waitForPostgres();

    // 1. Apply every migration OLDER than EVT-39 — the DB now has the exact
    //    pre-workspaceId shape every existing deployment has today.
    for (const migration of legacyMigrations) {
      await client.query(migration.sql);
    }

    // 2. Seed legacy-shaped rows directly (bypassing Prisma, whose
    //    generated client already reflects the POST-migration schema) —
    //    one representative row per domain table, plus three users
    //    covering admin/member/pending to prove the membership backfill's
    //    role mapping and its "approved only" filter.
    await client.query(`
      INSERT INTO "User" (id, email, name, "googleId", status, role, "createdAt", "updatedAt")
      VALUES
        ('${ADMIN_USER_ID}', 'admin@example.com', 'Admin', 'google-admin-evt39', 'approved', 'admin', now(), now()),
        ('${MEMBER_USER_ID}', 'member@example.com', 'Member', 'google-member-evt39', 'approved', 'user', now(), now()),
        ('${PENDING_USER_ID}', 'pending@example.com', 'Pending', 'google-pending-evt39', 'pending', 'user', now(), now());

      INSERT INTO "Location" (id, name, path, "qrCode", kind)
      VALUES ('${LOCATION_ID}', 'Garage', 'garage', 'qr-legacy-location-evt39', 'area');

      INSERT INTO "Category" (id, name, path)
      VALUES ('${CATEGORY_ID}', 'Tools', 'tools');

      INSERT INTO "Tag" (id, name, color)
      VALUES ('${TAG_ID}', 'drill-bit', '#ff0000');

      INSERT INTO "Item" (id, name, quantity, properties, "qrCode", "locationId", "categoryId", "createdAt", "updatedAt")
      VALUES ('${ITEM_ID}', 'Cordless Drill', 1, '{}', '${LEGACY_ITEM_QR}', '${LOCATION_ID}', '${CATEGORY_ID}', now(), now());

      INSERT INTO "ItemTag" ("itemId", "tagId") VALUES ('${ITEM_ID}', '${TAG_ID}');

      INSERT INTO "Project" (id, name, status, "createdAt", "updatedAt")
      VALUES ('${PROJECT_ID}', 'Deck build', 'planned', now(), now());

      INSERT INTO "StockMovement" (id, "itemId", kind, delta, note, "createdAt")
      VALUES ('${MOVEMENT_ID}', '${ITEM_ID}', 'add', 1, 'Initial intake', now());

      INSERT INTO "ShoppingListEntry" (id, "itemId", status, source, "createdAt")
      VALUES ('${SHOPPING_ENTRY_ID}', '${ITEM_ID}', 'open', 'manual', now());

      INSERT INTO "Photo" (id, "itemId", filename, "mimeType", "sizeBytes", "createdAt", "updatedAt")
      VALUES ('${PHOTO_ID}', '${ITEM_ID}', 'drill.jpg', 'image/jpeg', 12345, now(), now());
    `);

    // 3. Apply the EVT-39 migration itself on top of this data-bearing DB —
    //    this is the actual assertion under test: does it apply CLEAN
    //    against non-empty tables?
    await client.query(workspaceMigration.sql);
  });

  afterAll(async () => {
    await client?.end();
    execSync(`docker stop ${CONTAINER_NAME} >/dev/null 2>&1 || true`);
  });

  // ---------------------------------------------------------------------
  // AC1 — backfill: every pre-existing row lands in the Default Workspace;
  // memberships created with correct roles.
  // ---------------------------------------------------------------------

  it('creates exactly one "Default Workspace" at the fixed well-known id', async () => {
    const { rows } = await client.query('SELECT id, name FROM "Workspace"');
    expect(rows).toEqual([{ id: DEFAULT_WORKSPACE_ID, name: 'Default Workspace' }]);
  });

  it.each([
    ['Item', ITEM_ID],
    ['Location', LOCATION_ID],
    ['Category', CATEGORY_ID],
    ['Tag', TAG_ID],
    ['Project', PROJECT_ID],
    ['StockMovement', MOVEMENT_ID],
    ['ShoppingListEntry', SHOPPING_ENTRY_ID],
    ['Photo', PHOTO_ID],
  ])('backfills the pre-existing %s row into the Default Workspace', async (table, id) => {
    const { rows } = await client.query(`SELECT "workspaceId" FROM "${table}" WHERE id = $1`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('creates a WorkspaceMember for every approved user, admin -> owner and user -> member', async () => {
    const { rows } = await client.query(
      'SELECT "userId", role FROM "WorkspaceMember" WHERE "workspaceId" = $1 ORDER BY "userId"',
      [DEFAULT_WORKSPACE_ID],
    );
    expect(rows).toEqual(
      [
        { userId: ADMIN_USER_ID, role: 'owner' },
        { userId: MEMBER_USER_ID, role: 'member' },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
  });

  it('does NOT create a membership for a pending (not-yet-approved) user', async () => {
    const { rows } = await client.query('SELECT 1 FROM "WorkspaceMember" WHERE "userId" = $1', [
      PENDING_USER_ID,
    ]);
    expect(rows).toHaveLength(0);
  });

  it('every workspaceId FK column is indexed', async () => {
    const tables = [
      'Item',
      'Location',
      'Category',
      'Tag',
      'Project',
      'StockMovement',
      'ShoppingListEntry',
      'Photo',
      'WorkspaceMember',
    ];
    for (const table of tables) {
      const { rows } = await client.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = $1 AND indexdef ILIKE '%"workspaceId"%'`,
        [table],
      );
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------
  // AC2 — re-scoped uniqueness: same tag name / location path allowed
  // across two workspaces, still rejected within one.
  // ---------------------------------------------------------------------

  describe('re-scoped uniqueness (AC2)', () => {
    const SECOND_WORKSPACE_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

    beforeAll(async () => {
      await client.query('INSERT INTO "Workspace" (id, name, "createdAt") VALUES ($1, $2, now())', [
        SECOND_WORKSPACE_ID,
        'Second Workspace',
      ]);
    });

    it('allows the same Tag.name in a different workspace', async () => {
      await expect(
        client.query(
          'INSERT INTO "Tag" (id, name, "workspaceId") VALUES (gen_random_uuid(), $1, $2)',
          ['drill-bit', SECOND_WORKSPACE_ID],
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a duplicate Tag.name within the SAME workspace', async () => {
      await expect(
        client.query(
          'INSERT INTO "Tag" (id, name, "workspaceId") VALUES (gen_random_uuid(), $1, $2)',
          ['drill-bit', DEFAULT_WORKSPACE_ID],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('allows the same Location.path in a different workspace', async () => {
      await expect(
        client.query(
          'INSERT INTO "Location" (id, name, path, "qrCode", "workspaceId") VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, $3)',
          ['Garage', 'garage', SECOND_WORKSPACE_ID],
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a duplicate Location.path within the SAME workspace', async () => {
      await expect(
        client.query(
          'INSERT INTO "Location" (id, name, path, "qrCode", "workspaceId") VALUES (gen_random_uuid(), $1, $2, gen_random_uuid()::text, $3)',
          ['Garage', 'garage', DEFAULT_WORKSPACE_ID],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    // -----------------------------------------------------------------
    // AC3 — qrCode stays globally unique regardless of workspace.
    // -----------------------------------------------------------------

    it('rejects a duplicate Item.qrCode even across two DIFFERENT workspaces', async () => {
      await expect(
        client.query(
          'INSERT INTO "Item" (id, name, "qrCode", "workspaceId", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now(), now())',
          ['Second workspace drill', LEGACY_ITEM_QR, SECOND_WORKSPACE_ID],
        ),
      ).rejects.toMatchObject({ code: '23505' });
    });

    it('allows a fresh, distinct Item.qrCode in the second workspace', async () => {
      await expect(
        client.query(
          'INSERT INTO "Item" (id, name, "qrCode", "workspaceId", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now(), now())',
          ['Second workspace drill', 'qr-second-workspace-item', SECOND_WORKSPACE_ID],
        ),
      ).resolves.toBeDefined();
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — `prisma migrate status` is clean (no pending migrations, no drift)
// against the standard, shared e2e database that `global-setup.ts` already
// migrated with `prisma migrate deploy` before any test in this run started.
// ---------------------------------------------------------------------------

describe('EVT-39 — prisma migrate status is clean (AC5, shared e2e container)', () => {
  jest.setTimeout(30_000);

  it('reports the schema as up to date', () => {
    const TEST_DB_URL =
      process.env.TEST_DATABASE_URL ??
      'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

    const output = execSync('npx prisma migrate status', {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: TEST_DB_URL },
      encoding: 'utf-8',
    });

    expect(output).toContain('Database schema is up to date!');
  });
});
