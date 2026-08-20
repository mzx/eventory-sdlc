// Pure, dependency-free helpers for the off-VM backup fetch (EVT-33).
//
// The on-VM nightly backup (scripts/prod-backup.sh) has no Node.js available
// on the bare host (only inside the app's Docker images) — its rotation is
// implemented directly in bash via `find -mtime` (see
// scripts/prod-backup-script.test.mjs, which asserts on that script's exact
// content instead of executing it).
//
// scripts/fetch-backups.sh runs on the OPERATOR'S MAC, where Node is always
// available (this is the dev monorepo). Doing the "is the newest backup
// stale?" date math here — rather than in bash — sidesteps the classic
// macOS/BSD vs Linux/GNU `date`/`stat` flag incompatibility (`date -d` is
// GNU-only; `stat -c` vs `stat -f` differ) and gets real `node --test`
// coverage. fetch-backups.sh invokes this file's CLI (see bottom) for real;
// scripts/backup-lib.test.mjs exercises the exported pure functions
// directly with synthetic inputs.
//
// Backup filenames encode their own UTC timestamp (set by
// scripts/prod-backup.sh), e.g.:
//   eventory-db-20260820T030512Z.dump
//   eventory-photos-20260820T030512Z.tar.gz
// Parsing the timestamp from the filename (rather than relying on
// filesystem mtime, which rsync/scp can perturb or preserve inconsistently
// depending on flags) keeps the freshness check deterministic and testable
// with plain strings.

const TIMESTAMP_RE = /(\d{8}T\d{6}Z)/;

/**
 * Parse the UTC timestamp embedded in a backup filename, e.g.
 * "eventory-db-20260820T030512Z.dump" -> Date for 2026-08-20T03:05:12Z.
 * @param {string} filename
 * @returns {Date|null} null if the filename has no recognizable timestamp
 */
export function parseBackupTimestamp(filename) {
  const match = TIMESTAMP_RE.exec(filename);
  if (!match) return null;
  const [, stamp] = match;
  const iso = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * @param {string[]} filenames
 * @returns {{filename: string, timestamp: Date}|null} the newest backup by
 *   embedded timestamp, or null if none of the filenames parse
 */
export function findNewestBackup(filenames) {
  let newest = null;
  for (const filename of filenames) {
    const timestamp = parseBackupTimestamp(filename);
    if (!timestamp) continue;
    if (!newest || timestamp > newest.timestamp) {
      newest = { filename, timestamp };
    }
  }
  return newest;
}

/**
 * @param {Date} timestamp
 * @param {Date} now
 * @returns {number} age in whole days (fractional days truncated toward zero)
 */
export function ageInDays(timestamp, now) {
  const ms = now.getTime() - timestamp.getTime();
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * AC5: "the fetch job should warn when the newest backup is older than 2
 * days". Evaluates the staleness check the way scripts/fetch-backups.sh
 * actually calls it: given the filenames currently in the local mirror
 * directory, is the newest one older than maxAgeDays?
 * @param {string[]} filenames
 * @param {Date} now
 * @param {number} [maxAgeDays]
 * @returns {{ok: boolean, stale: boolean, reason?: string, newest?: string, ageDays?: number}}
 */
export function checkFreshness(filenames, now, maxAgeDays = 2) {
  const newest = findNewestBackup(filenames);
  if (!newest) {
    return { ok: false, stale: true, reason: 'no backups with a parseable timestamp were found' };
  }
  const ageDays = ageInDays(newest.timestamp, now);
  return {
    ok: true,
    stale: ageDays > maxAgeDays,
    newest: newest.filename,
    ageDays,
  };
}

/**
 * Mirrors the selection semantics of `find <dir> -mtime +N -delete`: an item
 * is a prune candidate once its age exceeds N whole days. Not called from
 * any script directly — bash's `find -mtime` does the real pruning in both
 * scripts/prod-backup.sh (VM side) and scripts/fetch-backups.sh (local
 * mirror side). This is a tested, executable behavioral reference for that
 * bash semantics, so a future change to the pruning rule has a Node-side
 * assertion to update in lockstep rather than only living in shell (see
 * scripts/prod-backup-script.test.mjs, which asserts on the shell script's
 * text).
 * @param {{name: string, ageDays: number}[]} entries
 * @param {number} retentionDays
 * @returns {string[]} names of entries older than retentionDays
 */
export function selectPruneCandidates(entries, retentionDays) {
  return entries.filter((entry) => entry.ageDays > retentionDays).map((entry) => entry.name);
}

/**
 * Argument validation shared by any caller that accepts a "number of days"
 * knob — both the retention-days env vars (BACKUP_RETENTION_DAYS /
 * LOCAL_RETENTION_DAYS) and the freshness CLI's maxAgeDays argument below
 * (MAX_AGE_DAYS_WARN) share the same "positive integer number of days"
 * shape, so both validate through this one function.
 * @param {string|number|undefined} input
 * @param {number} fallback
 * @returns {number}
 */
export function validateRetentionDays(input, fallback = 14) {
  if (input === undefined || input === null || input === '') return fallback;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`retention days must be a positive integer, got: ${JSON.stringify(input)}`);
  }
  return n;
}

// --- CLI: `node scripts/backup-lib.mjs freshness <dir> [maxAgeDays]` -------
// Real usage from scripts/fetch-backups.sh (not a test-only shim): lists the
// given directory, runs checkFreshness() against the real filenames + real
// wall clock, and exits non-zero with a WARNING line when stale so the
// calling bash script (and cron/launchd around it) observes the failure.
async function runCli(argv) {
  const [cmd, dir, maxAgeDaysArg] = argv;
  if (cmd !== 'freshness' || !dir) {
    console.error('usage: node scripts/backup-lib.mjs freshness <dir> [maxAgeDays]');
    process.exit(2);
    return;
  }
  // Validate the threshold BEFORE trusting it: `ageDays > NaN` is always
  // false, so a garbage MAX_AGE_DAYS_WARN (e.g. a typo'd env var) would
  // otherwise make checkFreshness() report "not stale" forever and this
  // alerting path would fail open silently.
  let maxAgeDays;
  try {
    maxAgeDays = validateRetentionDays(maxAgeDaysArg, 2);
  } catch (err) {
    console.error(
      `usage: node scripts/backup-lib.mjs freshness <dir> [maxAgeDays] — ${err.message}`,
    );
    process.exit(2);
    return;
  }
  const { readdirSync } = await import('node:fs');
  let filenames;
  try {
    filenames = readdirSync(dir);
  } catch (err) {
    console.error(`WARNING: could not read backup dir "${dir}": ${err.message}`);
    process.exit(1);
    return;
  }
  const result = checkFreshness(filenames, new Date(), maxAgeDays);
  if (!result.ok) {
    console.error(`WARNING: ${result.reason} in "${dir}"`);
    process.exit(1);
  }
  if (result.stale) {
    console.error(
      `WARNING: newest backup "${result.newest}" is ${result.ageDays.toFixed(1)} days old ` +
        `(> ${maxAgeDays}-day threshold) — check the VM's nightly backup job.`,
    );
    process.exit(1);
  }
  console.log(
    `OK: newest backup "${result.newest}" is ${result.ageDays.toFixed(1)} days old (<= ${maxAgeDays}-day threshold)`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv.slice(2));
}
