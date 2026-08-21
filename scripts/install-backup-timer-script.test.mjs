// Tests for scripts/install-backup-timer.sh (EVT-46: Alpine/crond support).
//
// The script's top-level dispatch requires root and (on the systemd path)
// actual systemd unit directories that only exist on a real VM, so —
// following the same testing philosophy as prod-backup-script.test.mjs —
// the init-system detection and the systemd branch are verified
// structurally. The NEW crond branch (the actual bug fix — the VM has no
// systemd at all) doesn't need root or systemd, so it's extracted from the
// committed script and executed for real against a fixture crontab file,
// proving both that it writes the expected line AND that re-running it is
// truly idempotent (no duplicate entries), matching how it will actually
// be re-invoked after every `./deploy.sh`.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = join(repoRoot, 'scripts', 'install-backup-timer.sh');
const script = readFileSync(scriptPath, 'utf8');

describe('scripts/install-backup-timer.sh', () => {
  it('runs under `set -euo pipefail` so any unguarded failure aborts the run', () => {
    assert.match(script, /^set -euo pipefail$/m);
  });

  it('requires root before touching anything', () => {
    assert.match(script, /\[\[ "\$\(id -u\)" -eq 0 \]\] \|\| \{/);
  });

  it('detects systemd (unit dir present) and dispatches to install_systemd', () => {
    assert.match(
      script,
      /if command -v systemctl >\/dev\/null 2>&1 && \[\[ -d \/etc\/systemd\/system \]\]; then\s*\n\s*install_systemd/,
    );
  });

  it('falls back to install_crontab when systemd is absent but /etc/crontabs or crond exists (Alpine)', () => {
    assert.match(script, /elif \[\[ -d \/etc\/crontabs \]\] \|\| command -v crond >\/dev\/null 2>&1; then/);
    assert.match(script, /install_crontab/);
  });

  it('errors loudly (non-zero exit) when neither init system is detected — never fails open/silent', () => {
    const elseIdx = script.lastIndexOf('else');
    const tail = script.slice(elseIdx);
    assert.match(tail, /ERROR: neither systemd.*nor Alpine crond/);
    assert.match(tail, /exit 1/);
  });

  it('the systemd timer still runs nightly at 03:15 with Persistent=true (unchanged behavior)', () => {
    assert.match(script, /OnCalendar=\*-\*-\* 03:15:00/);
    assert.match(script, /Persistent=true/);
  });

  it('the crontab branch schedules the same 03:15 time and matches the manually-installed log destination', () => {
    assert.match(script, /cron_line="15 3 \* \* \* cd \$\{APP_DIR\} && \.\/scripts\/prod-backup\.sh >> \$\{LOG_FILE\} 2>&1/);
    assert.match(script, /LOG_FILE="\$\{LOG_FILE:-\/var\/log\/eventory-backup\.log\}"/);
  });

  it('locks down the crontab file to owner-only after writing it', () => {
    assert.match(script, /chmod 600 "\$cron_file"/);
  });
});

describe('scripts/install-backup-timer.sh install_crontab (executed for real)', () => {
  let fixtureDir, cronFile, appDir;

  before(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'evt46-install-backup-timer-'));
    cronFile = join(fixtureDir, 'crontabs-root');
    appDir = join(fixtureDir, 'opt-eventory');
    mkdirSync(join(appDir, 'scripts'), { recursive: true });
    writeFileSync(join(appDir, 'scripts', 'prod-backup.sh'), '#!/usr/bin/env bash\ntrue\n');
    chmodSync(join(appDir, 'scripts', 'prod-backup.sh'), 0o755);
  });

  after(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  /** Extracts the `install_crontab() { ... }` function body verbatim from the committed script. */
  function extractInstallCrontab() {
    const startIdx = script.indexOf('install_crontab() {');
    assert.notEqual(startIdx, -1, 'expected an install_crontab() function');
    const closeIdx = script.indexOf('\n}\n', startIdx);
    assert.notEqual(closeIdx, -1, 'expected a closing brace for install_crontab()');
    return script.slice(startIdx, closeIdx + 2);
  }

  function runInstallCrontabOnce() {
    const fnBody = extractInstallCrontab();
    const harness = [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'CRON_MARKER="eventory-backup (installed by install-backup-timer.sh)"',
      fnBody,
      'install_crontab',
      '',
    ].join('\n');
    execFileSync('bash', ['-c', harness], {
      env: { ...process.env, APP_DIR: appDir, LOG_FILE: '/var/log/eventory-backup.log', CRON_FILE: cronFile },
      stdio: 'pipe',
    });
  }

  it('writes a single crontab line with the expected schedule/command/log destination', () => {
    runInstallCrontabOnce();
    const contents = readFileSync(cronFile, 'utf8');
    const lines = contents.trim().split('\n');
    assert.equal(lines.length, 1, 'expected exactly one line after the first install');
    assert.match(lines[0], /^15 3 \* \* \* cd .*\/opt-eventory && \.\/scripts\/prod-backup\.sh >> \/var\/log\/eventory-backup\.log 2>&1 # eventory-backup \(installed by install-backup-timer\.sh\)$/);
  });

  it('locks the crontab file to owner-only (0600)', () => {
    const mode = statSync(cronFile).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('re-running is idempotent — no duplicate line after a second install', () => {
    runInstallCrontabOnce();
    runInstallCrontabOnce();
    const contents = readFileSync(cronFile, 'utf8');
    const lines = contents.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'expected still exactly one line after re-running twice more');
  });

  it('preserves unrelated pre-existing crontab lines untouched', () => {
    writeFileSync(cronFile, '0 4 * * * /usr/bin/some-other-job\n');
    runInstallCrontabOnce();
    const contents = readFileSync(cronFile, 'utf8');
    assert.match(contents, /0 4 \* \* \* \/usr\/bin\/some-other-job/);
    const eventoryLines = contents
      .trim()
      .split('\n')
      .filter((l) => l.includes('eventory-backup (installed by install-backup-timer.sh)'));
    assert.equal(eventoryLines.length, 1);
  });
});
