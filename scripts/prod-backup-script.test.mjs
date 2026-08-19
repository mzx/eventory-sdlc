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

  it('verifies the db dump is non-empty before treating the run as successful', () => {
    const idx = script.indexOf('[[ -s "$DB_DUMP" ]]');
    assert.notEqual(idx, -1, 'expected a non-empty check on $DB_DUMP');
    assert.match(script.slice(idx, idx + 120), /exit 1/);
  });

  it('verifies the photos archive is non-empty before treating the run as successful', () => {
    const idx = script.indexOf('[[ -s "$PHOTOS_TAR" ]]');
    assert.notEqual(idx, -1, 'expected a non-empty check on $PHOTOS_TAR');
    assert.match(script.slice(idx, idx + 120), /exit 1/);
  });

  it('writes the success marker AFTER both non-empty checks (AC5)', () => {
    const dbCheckIdx = script.indexOf('[[ -s "$DB_DUMP" ]]');
    const photosCheckIdx = script.indexOf('[[ -s "$PHOTOS_TAR" ]]');
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

  it('never reads or echoes POSTGRES_PASSWORD (no credentials embedded — AC2)', () => {
    assert.doesNotMatch(script, /POSTGRES_PASSWORD/);
  });

  it('writes each artifact to a .tmp path first and renames on completion (atomic — no partial dump left as the "latest" file on failure)', () => {
    assert.match(script, /> "\$DB_DUMP\.tmp"/);
    assert.match(script, /mv "\$DB_DUMP\.tmp" "\$DB_DUMP"/);
    assert.match(script, /mv "\$\{PHOTOS_TAR\}\.tmp" "\$PHOTOS_TAR"/);
  });
});
