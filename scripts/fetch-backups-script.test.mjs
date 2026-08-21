// Tests for scripts/fetch-backups.sh (EVT-46).
//
// fetch-backups.sh's actual rsync step talks to a real VM over SSH, so —
// following the same testing philosophy as prod-backup-script.test.mjs
// (assert on the real committed script's text for the parts that can't be
// exercised without production infrastructure) — the rsync invocation
// itself is verified structurally. The portable-permissions fix (the
// actual bug this task closes) doesn't depend on SSH or a remote host at
// all, so it's ALSO exercised for real: the exact `find`/`chmod` lines are
// extracted from the committed script and run against a throwaway fixture
// tree, proving they truly normalize permissions rather than just matching
// a regex.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'fetch-backups.sh');
const script = readFileSync(scriptPath, 'utf8');

describe('scripts/fetch-backups.sh', () => {
  it('runs under `set -euo pipefail` so any unguarded failure aborts the run', () => {
    assert.match(script, /^set -euo pipefail$/m);
  });

  it('does NOT pass --chmod to rsync (EVT-46: GNU-only syntax macOS rsync rejects, and even the accepted forms are a silent no-op)', () => {
    const rsyncCallIdx = script.indexOf('rsync -az');
    assert.notEqual(rsyncCallIdx, -1, 'expected an rsync invocation');
    const rsyncCallEnd = script.indexOf('\n\n', rsyncCallIdx);
    const rsyncCall = script.slice(rsyncCallIdx, rsyncCallEnd === -1 ? undefined : rsyncCallEnd);
    assert.doesNotMatch(rsyncCall, /--chmod/);
  });

  it('still uses --safe-links and --partial (unaffected by the --chmod removal)', () => {
    const rsyncCallIdx = script.indexOf('rsync -az');
    const rsyncCallEnd = script.indexOf('\n\n', rsyncCallIdx);
    const rsyncCall = script.slice(rsyncCallIdx, rsyncCallEnd === -1 ? undefined : rsyncCallEnd);
    assert.match(rsyncCall, /--partial/);
    assert.match(rsyncCall, /--safe-links/);
  });

  it('enforces owner-only permissions on the local mirror AFTER the rsync call, not via rsync itself', () => {
    const rsyncCallIdx = script.indexOf('rsync -az');
    const dirChmodIdx = script.indexOf('find "$LOCAL_BACKUP_DIR" -type d -exec chmod 700 {} +');
    const fileChmodIdx = script.indexOf('find "$LOCAL_BACKUP_DIR" -type f -exec chmod 600 {} +');

    assert.notEqual(dirChmodIdx, -1, 'expected a find -type d -exec chmod 700 pass');
    assert.notEqual(fileChmodIdx, -1, 'expected a find -type f -exec chmod 600 pass');
    assert.ok(rsyncCallIdx < dirChmodIdx, 'permission enforcement must run AFTER the rsync transfer');
    assert.ok(rsyncCallIdx < fileChmodIdx, 'permission enforcement must run AFTER the rsync transfer');
  });
});

describe('scripts/fetch-backups.sh permission-enforcement lines (executed for real)', () => {
  let fixtureDir;

  before(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'evt46-fetch-backups-perms-'));
    // Simulate what an rsync transfer with NO --chmod would leave behind:
    // loose, remote-preserved mode bits on both a file and a subdirectory.
    mkdirSync(join(fixtureDir, 'subdir'), { mode: 0o755 });
    writeFileSync(join(fixtureDir, 'eventory-db-20260820T030512Z.dump'), 'fake-dump', {
      mode: 0o644,
    });
    writeFileSync(join(fixtureDir, 'subdir', 'nested.tar.gz'), 'fake-archive', { mode: 0o644 });
  });

  after(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('the exact committed find+chmod lines normalize files to 600 and dirs to 700', () => {
    const dirLineMatch = script.match(/^find "\$LOCAL_BACKUP_DIR" -type d -exec chmod 700 \{\} \+$/m);
    const fileLineMatch = script.match(/^find "\$LOCAL_BACKUP_DIR" -type f -exec chmod 600 \{\} \+$/m);
    assert.ok(dirLineMatch, 'expected the directory chmod line to match exactly');
    assert.ok(fileLineMatch, 'expected the file chmod line to match exactly');

    execFileSync(
      'bash',
      ['-c', `LOCAL_BACKUP_DIR="$1"\n${dirLineMatch[0]}\n${fileLineMatch[0]}\n`, '--', fixtureDir],
      { stdio: 'pipe' },
    );

    const dirMode = statSync(join(fixtureDir, 'subdir')).mode & 0o777;
    const topFileMode = statSync(join(fixtureDir, 'eventory-db-20260820T030512Z.dump')).mode & 0o777;
    const nestedFileMode = statSync(join(fixtureDir, 'subdir', 'nested.tar.gz')).mode & 0o777;

    assert.equal(dirMode, 0o700, 'directories must end up owner-only rwx');
    assert.equal(topFileMode, 0o600, 'top-level files must end up owner-only rw');
    assert.equal(nestedFileMode, 0o600, 'nested files must end up owner-only rw too (recursive find)');
  });
});
