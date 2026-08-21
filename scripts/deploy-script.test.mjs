// Tests for deploy.sh's remote provisioning heredoc (EVT-46).
//
// deploy.sh's remote block only runs against the real prod VM over SSH, so
// — following the same testing philosophy as prod-backup-script.test.mjs —
// this asserts on the real committed script's text rather than exercising
// it end-to-end. Covers the removal of the silently-dead ufw section (the
// VM is Alpine; `command -v ufw` was a permanent no-op) and that the
// replacement comment correctly documents why no host firewall step is
// needed (docker-compose.prod.yml's port model is the boundary).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const script = readFileSync(join(repoRoot, 'deploy.sh'), 'utf8');

describe('deploy.sh remote provisioning block', () => {
  it('no longer invokes ufw as a command (EVT-46: the command -v ufw guard was a silent permanent no-op on the Alpine VM; the word survives only in explanatory comments)', () => {
    const executableLines = script
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    assert.doesNotMatch(executableLines, /\bufw\b/);
  });

  it('documents why no host firewall step is needed (compose port model is the boundary)', () => {
    const firewallIdx = script.indexOf('--- Firewall');
    assert.notEqual(firewallIdx, -1, 'expected a Firewall section comment');
    const dockerIdx = script.indexOf('--- Swap', firewallIdx);
    const section = script.slice(firewallIdx, dockerIdx === -1 ? undefined : dockerIdx);
    assert.match(section, /Alpine/);
    assert.match(section, /docker-compose\.prod\.yml/);
    assert.match(section, /DOCKER-USER/);
  });

  it('still installs Docker and configures swap (unrelated sections untouched)', () => {
    assert.match(script, /curl -fsSL https:\/\/get\.docker\.com \| sh/);
    assert.match(script, /fallocate -l 2G \/swapfile/);
  });
});
