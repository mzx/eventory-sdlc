/**
 * Jest globalSetup for e2e tests.
 *
 * Starts a dedicated PostgreSQL Docker container on port 5433 and applies
 * Prisma migrations so each test run begins with a clean, up-to-date schema.
 *
 * The container name is deterministic ("evt3-test-postgres") so repeated runs
 * reuse the existing container rather than spawning a new one every time.
 *
 * A sentinel is written to `process.env.__EVT3_E2E_STARTED_DB__` so the
 * matching globalTeardown knows whether to stop the container.
 */

import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import { Client } from 'pg';

const CONTAINER_NAME = 'evt3-test-postgres';
const DB_PORT = 5433;
const DB_USER = 'eventory';
const DB_PASS = 'eventory';
const DB_NAME = 'eventory_test';

export const TEST_DATABASE_URL = `postgresql://${DB_USER}:${DB_PASS}@localhost:${DB_PORT}/${DB_NAME}?schema=public`;

function isContainerRunning(): boolean {
  const result = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', CONTAINER_NAME],
    {
      encoding: 'utf-8',
    },
  );
  return result.status === 0 && result.stdout.trim() === 'true';
}

/**
 * EVT-46: `docker exec ... pg_isready` lies during postgres:16's startup.
 * `pg_isready` connects over the container-LOCAL unix socket — but initdb
 * runs a *temporary* postmaster on that same unix socket (no TCP listener
 * yet) to execute its bootstrap SQL before starting the real,
 * TCP-listening server. `pg_isready` happily reports "accepting
 * connections" against that temporary server, so this probe used to return
 * well before `-p ${DB_PORT}:5432` was actually mapped and listening —
 * every e2e suite's `beforeAll` (which connects over that mapped TCP port)
 * could then intermittently die with "Connection terminated unexpectedly",
 * load-dependently.
 *
 * Fixed by retrying a REAL `pg` `Client.connect()` (full wire-protocol
 * startup handshake), not a bare TCP socket `connect()`. A raw TCP-level
 * probe was tried first and is NOT sufficient on every Docker setup: some
 * port-forwarding implementations (observed here with OrbStack) accept the
 * TCP handshake at the host-side proxy as soon as the container/port
 * mapping exists, before the process inside is actually listening — a bare
 * socket connect can report "ready" the same way `pg_isready`'s unix-socket
 * check does, moments before `prisma migrate deploy` then fails with
 * "Can't reach database server". A full `pg` client handshake talks all the
 * way through to postgres itself, so initdb's socket-only phase (or an
 * unready host-side proxy) can't fake it.
 */
async function waitForPostgres(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const candidate = new Client({
      host: 'localhost',
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASS,
      database: DB_NAME,
    });
    try {
      await candidate.connect();
      await candidate.end();
      return;
    } catch (err) {
      lastError = err;
      await candidate.end().catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(
    `PostgreSQL container "${CONTAINER_NAME}" did not become ready within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

export default async function globalSetup(): Promise<void> {
  const weStarted = !isContainerRunning();

  if (weStarted) {
    console.log(
      `\n[e2e] Starting test PostgreSQL container "${CONTAINER_NAME}" on port ${DB_PORT}…`,
    );
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
  } else {
    console.log(`\n[e2e] Reusing existing container "${CONTAINER_NAME}".`);
  }

  await waitForPostgres();

  // Run Prisma migrations against the test database
  console.log('[e2e] Applying Prisma migrations…');
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
  console.log('[e2e] Migrations applied.');

  // Store metadata for globalTeardown
  process.env.__EVT3_E2E_STARTED_DB__ = weStarted ? '1' : '0';
  process.env.__EVT3_E2E_DB_URL__ = TEST_DATABASE_URL;
}
