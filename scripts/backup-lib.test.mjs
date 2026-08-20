// Unit tests for scripts/backup-lib.mjs (EVT-33 AC5): the off-VM fetch
// staleness check ("warn when the newest backup is older than 2 days") and
// the retention-selection/argument-validation logic shared with the on-VM
// rotation semantics (see scripts/prod-backup-script.test.mjs for the
// matching assertions against the actual bash script).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageInDays,
  checkFreshness,
  findNewestBackup,
  parseBackupTimestamp,
  selectPruneCandidates,
  validateRetentionDays,
} from './backup-lib.mjs';

describe('parseBackupTimestamp', () => {
  it('parses the UTC timestamp embedded in a db dump filename', () => {
    const d = parseBackupTimestamp('eventory-db-20260820T030512Z.dump');
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-08-20T03:05:12.000Z');
  });

  it('parses the UTC timestamp embedded in a photos archive filename', () => {
    const d = parseBackupTimestamp('eventory-photos-20260101T000000Z.tar.gz');
    assert.ok(d);
    assert.equal(d.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  it('returns null for filenames with no timestamp', () => {
    assert.equal(parseBackupTimestamp('last-success.txt'), null);
    assert.equal(parseBackupTimestamp('README.md'), null);
  });
});

describe('findNewestBackup', () => {
  it('picks the filename whose embedded timestamp is latest, ignoring order', () => {
    const files = [
      'eventory-db-20260818T030000Z.dump',
      'eventory-db-20260820T030000Z.dump',
      'eventory-db-20260819T030000Z.dump',
      'last-success.txt',
    ];
    const newest = findNewestBackup(files);
    assert.equal(newest.filename, 'eventory-db-20260820T030000Z.dump');
  });

  it('returns null when no filename has a parseable timestamp', () => {
    assert.equal(findNewestBackup(['last-success.txt', 'README.md']), null);
  });

  it('returns null for an empty directory listing', () => {
    assert.equal(findNewestBackup([]), null);
  });
});

describe('ageInDays', () => {
  it('computes fractional days between two dates', () => {
    const then = new Date('2026-08-18T00:00:00Z');
    const now = new Date('2026-08-20T12:00:00Z');
    assert.equal(ageInDays(then, now), 2.5);
  });
});

describe('checkFreshness (AC5: warn when newest backup > 2 days old)', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('is not stale when the newest backup is under the threshold', () => {
    const files = ['eventory-db-20260819T120000Z.dump']; // 1 day old
    const result = checkFreshness(files, now, 2);
    assert.equal(result.ok, true);
    assert.equal(result.stale, false);
    assert.equal(result.ageDays, 1);
  });

  it('is stale once the newest backup exceeds the threshold', () => {
    const files = ['eventory-db-20260817T120000Z.dump']; // 3 days old
    const result = checkFreshness(files, now, 2);
    assert.equal(result.ok, true);
    assert.equal(result.stale, true);
  });

  it('is exactly at the boundary (not stale) when age equals the threshold', () => {
    const files = ['eventory-db-20260818T120000Z.dump']; // exactly 2 days old
    const result = checkFreshness(files, now, 2);
    assert.equal(result.stale, false, 'age === maxAgeDays must not itself count as stale');
  });

  it('flags a directory with no parseable backups as stale/not-ok', () => {
    const result = checkFreshness(['last-success.txt'], now, 2);
    assert.equal(result.ok, false);
    assert.equal(result.stale, true);
    assert.match(result.reason, /no backups/);
  });

  it('defaults maxAgeDays to 2 when not passed (AC5 default)', () => {
    const staleFiles = ['eventory-db-20260817T110000Z.dump']; // ~3 days old
    assert.equal(checkFreshness(staleFiles, now).stale, true);
    const freshFiles = ['eventory-db-20260820T110000Z.dump']; // ~1 hour old
    assert.equal(checkFreshness(freshFiles, now).stale, false);
  });
});

describe('selectPruneCandidates (mirrors `find -mtime +N -delete`)', () => {
  it('selects only entries strictly older than retentionDays', () => {
    const entries = [
      { name: 'a', ageDays: 13 },
      { name: 'b', ageDays: 14 },
      { name: 'c', ageDays: 14.5 },
      { name: 'd', ageDays: 20 },
    ];
    assert.deepEqual(selectPruneCandidates(entries, 14), ['c', 'd']);
  });

  it('selects nothing when everything is within the retention window', () => {
    const entries = [{ name: 'a', ageDays: 1 }];
    assert.deepEqual(selectPruneCandidates(entries, 14), []);
  });
});

describe('validateRetentionDays', () => {
  it('falls back to the default when unset/empty', () => {
    assert.equal(validateRetentionDays(undefined, 14), 14);
    assert.equal(validateRetentionDays(null, 14), 14);
    assert.equal(validateRetentionDays('', 14), 14);
  });

  it('accepts a positive integer string (env var shape)', () => {
    assert.equal(validateRetentionDays('30', 14), 30);
  });

  it('rejects zero, negative, and non-integer input', () => {
    assert.throws(() => validateRetentionDays('0', 14));
    assert.throws(() => validateRetentionDays('-5', 14));
    assert.throws(() => validateRetentionDays('abc', 14));
    assert.throws(() => validateRetentionDays('3.5', 14));
  });
});
