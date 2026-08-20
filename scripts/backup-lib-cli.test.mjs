// Exit-code contract test for `node scripts/backup-lib.mjs freshness <dir>
// [maxAgeDays]`, run as a real child process against synthetic tmpdir
// fixtures (EVT-33 review round 2, finding 15 / 10).
//
// scripts/backup-lib.test.mjs already exercises checkFreshness() and
// validateRetentionDays() directly as pure functions; this file locks in
// the operator-alert contract at the actual CLI boundary
// (scripts/fetch-backups.sh's real integration point) — specifically the
// three-way exit code split (0 fresh / 1 stale-or-unreadable / 2
// usage-or-garbage-threshold) that a cron/launchd wrapper depends on to
// decide whether to page.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = join(repoRoot, 'scripts', 'backup-lib.mjs');

function runCli(args) {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], { encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

describe('backup-lib.mjs freshness CLI exit-code contract', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'evt33-backup-lib-cli-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 (fresh) when the newest filename-embedded timestamp is within the threshold', () => {
    const ts = new Date();
    const stamp = ts
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d+Z$/, 'Z');
    writeFileSync(join(dir, `eventory-db-${stamp}.dump`), 'x');
    const result = runCli(['freshness', dir, '2']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /^OK:/);
  });

  it('exits 1 (stale) when the newest backup exceeds the threshold', () => {
    const staleDir = mkdtempSync(join(tmpdir(), 'evt33-backup-lib-cli-stale-'));
    try {
      writeFileSync(join(staleDir, 'eventory-db-20200101T000000Z.dump'), 'x');
      const result = runCli(['freshness', staleDir, '2']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /WARNING:.*days old/);
    } finally {
      rmSync(staleDir, { recursive: true, force: true });
    }
  });

  it('exits 1 when the directory has no parseable backup filenames', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'evt33-backup-lib-cli-empty-'));
    try {
      const result = runCli(['freshness', emptyDir, '2']);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /WARNING:.*no backups/);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('exits 1 when the target directory does not exist (unreadable)', () => {
    const result = runCli(['freshness', join(dir, 'does-not-exist'), '2']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /WARNING: could not read backup dir/);
  });

  it('exits 2 (usage/garbage) on a non-numeric maxAgeDays threshold — must NOT fail open (finding 10)', () => {
    const result = runCli(['freshness', dir, 'not-a-number']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage:/);
  });

  it('exits 2 on a zero or negative maxAgeDays threshold', () => {
    assert.equal(runCli(['freshness', dir, '0']).status, 2);
    assert.equal(runCli(['freshness', dir, '-5']).status, 2);
  });

  it('exits 2 on missing arguments (bare usage error)', () => {
    assert.equal(runCli(['freshness']).status, 2);
    assert.equal(runCli([]).status, 2);
  });

  it('defaults to a 2-day threshold when maxAgeDays is omitted', () => {
    const result = runCli(['freshness', dir]);
    assert.equal(result.status, 0);
  });
});
