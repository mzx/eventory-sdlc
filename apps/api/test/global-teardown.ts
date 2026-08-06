/**
 * Jest globalTeardown for e2e tests.
 *
 * Stops the test PostgreSQL Docker container — but only if globalSetup
 * was the one that started it (i.e. `__EVT3_E2E_STARTED_DB__ === '1'`).
 * This lets a developer pre-start the container and keep it between runs
 * for faster iteration.
 */

import { spawnSync } from 'child_process';

const CONTAINER_NAME = 'evt3-test-postgres';

export default async function globalTeardown(): Promise<void> {
  if (process.env.__EVT3_E2E_STARTED_DB__ === '1') {
    console.log(`\n[e2e] Stopping test PostgreSQL container "${CONTAINER_NAME}"…`);
    spawnSync('docker', ['stop', CONTAINER_NAME], { stdio: 'pipe' });
    console.log('[e2e] Container stopped.');
  }
}
