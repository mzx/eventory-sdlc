// Structural assertions against scripts/prod-backup.sh (EVT-33).
//
// scripts/prod-backup.sh runs only on the production VM's bare host (no
// Node.js there — only inside the app's Docker images), so it can't be
// exercised end-to-end by `node --test` the way scripts/backup-lib.mjs can.
// Following the same testing philosophy as
// scripts/compose-dev-startup.test.mjs / compose-service-command.mjs (EVT-32
// — assert on the real script's text rather than re-implementing it), this
// file asserts the actual committed script contains the safety properties
// the acceptance criteria require. The real end-to-end exercise (AC4) was
// run manually against throwaway containers; see the EVT-33 PR for the
// transcript.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(repoRoot, 'scripts', 'prod-backup.sh'), 'utf8');

describe('scripts/prod-backup.sh', () => {
  it('runs under `set -euo pipefail` so any unguarded failure aborts the run', () => {
    assert.match(script, /^set -euo pipefail$/m);
  });

  it('dumps Postgres in custom format (AC1)', () => {
    assert.match(
      script,
      /pg_dump\s+-U\s+"\$POSTGRES_USER"\s+-d\s+"\$POSTGRES_DB"\s+--format=custom/,
    );
  });

  it('runs pg_dump inside the db container via docker compose exec (version-matched binary)', () => {
    assert.match(script, /docker compose -f "\$COMPOSE_FILE" --env-file "\$ENV_FILE" exec -T db/);
  });

  it('defaults retention to 14 days and reads BACKUP_RETENTION_DAYS (AC1)', () => {
    assert.match(script, /RETENTION_DAYS="\$\{BACKUP_RETENTION_DAYS:-14\}"/);
  });

  it('prunes both the db dump and photos archive with the same retention window (AC1)', () => {
    assert.match(
      script,
      /find "\$BACKUP_DIR".*eventory-db-\*\.dump.*-mtime "\+\$\{RETENTION_DAYS\}".*-delete/,
    );
    assert.match(
      script,
      /find "\$BACKUP_DIR".*eventory-photos-\*\.tar\.gz.*-mtime "\+\$\{RETENTION_DAYS\}".*-delete/,
    );
  });

  it('verifies the db dump .tmp file is non-empty BEFORE the atomic rename (review round 2, finding 6: an empty-but-exit-0 dump must never land under its final name)', () => {
    const checkIdx = script.indexOf('[[ -s "$DB_DUMP.tmp" ]]');
    const mvIdx = script.indexOf('mv "$DB_DUMP.tmp" "$DB_DUMP"');
    assert.notEqual(checkIdx, -1, 'expected a non-empty check on $DB_DUMP.tmp');
    assert.notEqual(mvIdx, -1, 'expected the mv to the final $DB_DUMP name');
    assert.match(script.slice(checkIdx, checkIdx + 120), /exit 1/);
    assert.ok(checkIdx < mvIdx, 'the non-empty check must run BEFORE the mv to the final name');
  });

  it('verifies the photos archive .tmp file is non-empty BEFORE the atomic rename (finding 6)', () => {
    const checkIdx = script.indexOf('[[ -s "${PHOTOS_TAR}.tmp" ]]');
    const mvIdx = script.indexOf('mv "${PHOTOS_TAR}.tmp" "$PHOTOS_TAR"');
    assert.notEqual(checkIdx, -1, 'expected a non-empty check on ${PHOTOS_TAR}.tmp');
    assert.notEqual(mvIdx, -1, 'expected the mv to the final $PHOTOS_TAR name');
    assert.match(script.slice(checkIdx, checkIdx + 120), /exit 1/);
    assert.ok(checkIdx < mvIdx, 'the non-empty check must run BEFORE the mv to the final name');
  });

  it('writes the success marker AFTER both non-empty checks (AC5)', () => {
    const dbCheckIdx = script.indexOf('[[ -s "$DB_DUMP.tmp" ]]');
    const photosCheckIdx = script.indexOf('[[ -s "${PHOTOS_TAR}.tmp" ]]');
    const markerIdx = script.indexOf('last-success.txt');

    assert.notEqual(dbCheckIdx, -1);
    assert.notEqual(photosCheckIdx, -1);
    assert.notEqual(markerIdx, -1);
    assert.ok(dbCheckIdx < markerIdx, 'db non-empty check must precede the success marker write');
    assert.ok(
      photosCheckIdx < markerIdx,
      'photos non-empty check must precede the success marker write',
    );
  });

  it('marker is a timestamp (not a bare touch) so staleness can be computed', () => {
    assert.match(script, /date -u -Iseconds > "\$\{BACKUP_DIR\}\/last-success\.txt"/);
  });

  it('never reads or expands POSTGRES_PASSWORD as a shell variable (no credentials embedded — AC2). Review round 2, finding 7: the OLD version of this test only checked the literal string never appeared anywhere, which the header comment already satisfied even while `set -a; . .env.prod; set +a` silently exported the real secret into the process env — assert the real behavioral property (no $POSTGRES_PASSWORD / ${POSTGRES_PASSWORD} expansion) instead.', () => {
    assert.doesNotMatch(script, /\$\{?POSTGRES_PASSWORD\b/);
  });

  it('does not source .env.prod wholesale — only grep-extracts POSTGRES_USER/POSTGRES_DB, so no secret ever enters the process env (review round 2, finding 7)', () => {
    assert.doesNotMatch(script, /^\s*\.\s+"\$ENV_FILE"/m);
    assert.doesNotMatch(script, /set -a/);
    assert.match(script, /grep\s+-m1\s+-E\s+'\^POSTGRES_USER='\s+"\$ENV_FILE"/);
    assert.match(script, /grep\s+-m1\s+-E\s+'\^POSTGRES_DB='\s+"\$ENV_FILE"/);
  });

  it('writes each artifact to a .tmp path first and renames on completion (atomic — no partial dump left as the "latest" file on failure)', () => {
    assert.match(script, /> "\$DB_DUMP\.tmp"/);
    assert.match(script, /mv "\$DB_DUMP\.tmp" "\$DB_DUMP"/);
    assert.match(script, /mv "\$\{PHOTOS_TAR\}\.tmp" "\$PHOTOS_TAR"/);
  });

  it('defaults BACKUP_DIR outside the deploy.sh APP_DIR tree, which deploy.sh wipes on every deploy (finding 4)', () => {
    assert.match(script, /BACKUP_DIR="\$\{BACKUP_DIR:-\/var\/backups\/eventory\}"/);
    assert.doesNotMatch(
      script,
      /BACKUP_DIR="\$\{BACKUP_DIR:-\$\{APP_DIR\}/,
      'BACKUP_DIR must not default to a path under APP_DIR — deploy.sh deletes everything there',
    );
  });

  it('sets a restrictive umask and locks down BACKUP_DIR + every artifact to owner-only (finding 5)', () => {
    assert.match(script, /^umask 077$/m);
    assert.match(script, /chmod 700 "\$BACKUP_DIR"/);
    assert.match(script, /chmod 600 "\$DB_DUMP\.tmp"/);
    assert.match(script, /chmod 600 "\$\{PHOTOS_TAR\}\.tmp"/);
    assert.match(script, /chmod 600 "\$\{BACKUP_DIR\}\/last-success\.txt"/);
    // The photos tar is produced by a *container* process, whose own umask
    // the host's `umask 077` above cannot reach — must be set inside the
    // container's own command too.
    assert.match(script, /umask 077 && tar czf/);
  });

  it('archives the photo volume via the already-pinned postgres:16 image, not an unpinned alpine:latest running as root nightly (finding 8)', () => {
    const cmdStart = script.indexOf(
      'docker run --rm \\',
      script.indexOf('archiving photo storage volume'),
    );
    const cmdEnd = script.indexOf('[[ -s "${PHOTOS_TAR}.tmp" ]]');
    assert.notEqual(cmdStart, -1, 'expected the photos-archive docker run command');
    const cmd = script.slice(cmdStart, cmdEnd);
    assert.match(cmd, /postgres:16 sh -c/, 'photos step must run in the pinned postgres:16 image');
    assert.doesNotMatch(
      cmd,
      /\balpine\b/,
      'the actual docker run command (as opposed to explanatory comments elsewhere) must not reference alpine',
    );
  });

  it('passes the archive name to the container command via a positional arg, not string interpolation (optional finding 16)', () => {
    assert.match(script, /tar czf "\/backup\/\$1\.tmp" -C \/data \./);
    assert.match(script, /_ "\$\(basename "\$PHOTOS_TAR"\)"/);
  });
});
