// Hermetic compose-level smoke check (EVT-32 AC7): asserts the `api`
// service's dev startup script in docker-compose.yml runs
// `prisma generate` -> `prisma migrate deploy` -> the dev server, in that
// order, under `set -e`, with a loud (non-zero exit, logged) failure path
// for every step — so a schema-touching merge can't silently leave the
// container running a stale client or an unmigrated database (see the
// EVT-32 backlog task for the incident this guards against).
//
// Run via `node --test scripts/` (wired into the root `pnpm test` script).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { extractServiceCommandScript } from './compose-service-command.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const composeText = readFileSync(join(repoRoot, 'docker-compose.yml'), 'utf8');

describe('docker-compose.yml api service dev startup script (EVT-32)', () => {
  const script = extractServiceCommandScript(composeText, 'api');

  it('runs under `set -e` so any unguarded failure aborts the startup sequence', () => {
    assert.match(script, /^set -e$/m);
  });

  it('runs prisma generate before prisma migrate deploy before the dev server', () => {
    const generateIdx = script.indexOf('prisma:generate');
    const migrateIdx = script.indexOf('prisma:migrate:deploy');
    const startDevIdx = script.indexOf('exec pnpm --filter=@eventory/api run start:dev');

    assert.notEqual(generateIdx, -1, 'expected a `prisma:generate` step');
    assert.notEqual(migrateIdx, -1, 'expected a `prisma:migrate:deploy` step');
    assert.notEqual(startDevIdx, -1, 'expected the script to exec the dev server');
    assert.ok(
      generateIdx < migrateIdx,
      'prisma generate must run before prisma migrate deploy (a migration may depend on ' +
        'the newly generated client/schema)',
    );
    assert.ok(
      migrateIdx < startDevIdx,
      'prisma migrate deploy must run before the dev server starts (AC1/AC2: the app must ' +
        'never boot against an unmigrated database)',
    );
  });

  it('runs the pnpm-lock reinstall check (EVT-21) before either prisma step', () => {
    const installIdx = script.indexOf('pnpm install --frozen-lockfile --filter=@eventory/api...');
    const generateIdx = script.indexOf('prisma:generate');

    assert.notEqual(installIdx, -1);
    assert.ok(
      installIdx < generateIdx,
      'dependencies (including the prisma CLI) must be installed before prisma runs',
    );
  });

  it('never runs `prisma migrate dev` (dev containers must never create migrations)', () => {
    assert.doesNotMatch(script, /prisma[:\s]migrate[:\s]dev\b/);
  });

  it('fails loudly (logged, non-zero exit) if prisma generate fails, without reaching the dev server', () => {
    const guardMatch = script.match(
      /if ! pnpm --filter=@eventory\/api run prisma:generate; then\n([\s\S]*?)\nfi/,
    );
    assert.ok(guardMatch, 'expected an `if ! ...prisma:generate; then ... fi` guard');
    assert.match(guardMatch[1], /echo "\[dev\] ERROR:.*prisma generate.*"/);
    assert.match(guardMatch[1], /exit 1/);
  });

  it('fails loudly (logged, non-zero exit) if prisma migrate deploy fails, without reaching the dev server', () => {
    const guardMatch = script.match(
      /if ! pnpm --filter=@eventory\/api run prisma:migrate:deploy; then\n([\s\S]*?)\nfi/,
    );
    assert.ok(guardMatch, 'expected an `if ! ...prisma:migrate:deploy; then ... fi` guard');
    assert.match(guardMatch[1], /echo "\[dev\] ERROR:.*prisma migrate deploy.*"/);
    assert.match(guardMatch[1], /exit 1/);
  });

  it('logs a distinct success line for each prisma step (AC3: visible in `docker compose logs api`)', () => {
    assert.match(script, /echo "\[dev\] prisma generate complete\."/);
    assert.match(script, /echo "\[dev\] prisma migrate deploy complete/);
  });
});

describe('docker-compose.yml web service is unaffected by the api startup change', () => {
  const script = extractServiceCommandScript(composeText, 'web');

  it('has no prisma steps', () => {
    assert.doesNotMatch(script, /prisma/);
  });
});
