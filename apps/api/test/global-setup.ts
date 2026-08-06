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

function waitForPostgres(timeoutMs = 30_000): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['exec', CONTAINER_NAME, 'pg_isready', '-U', DB_USER, '-d', DB_NAME],
      { encoding: 'utf-8' },
    );
    if (result.status === 0) return;
    // sleep 500 ms
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(
    `PostgreSQL container "${CONTAINER_NAME}" did not become ready within ${timeoutMs}ms`,
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

  waitForPostgres();

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
