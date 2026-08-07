import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveHttpsOptions } from './https-options';

describe('resolveHttpsOptions', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'eventory-https-options-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined when the certs directory has no cert/key files (fresh clone, CI)', () => {
    expect(resolveHttpsOptions(dir)).toBeUndefined();
  });

  it('returns undefined when only one of cert.pem / key.pem is present', () => {
    writeFileSync(join(dir, 'cert.pem'), 'cert-only');

    expect(resolveHttpsOptions(dir)).toBeUndefined();
  });

  it('returns cert + key buffers when both files are present (mkcert ran)', () => {
    writeFileSync(join(dir, 'cert.pem'), 'fake-cert-contents');
    writeFileSync(join(dir, 'key.pem'), 'fake-key-contents');

    const result = resolveHttpsOptions(dir);

    expect(result).toBeDefined();
    expect(result?.cert?.toString()).toBe('fake-cert-contents');
    expect(result?.key?.toString()).toBe('fake-key-contents');
  });

  it('defaults to <cwd>/certs when no directory is passed', () => {
    // No certs/ under the jest working directory (apps/api) in CI/fresh
    // clones — confirms the parameter default doesn't throw and falls back
    // to plain HTTP (undefined) rather than erroring.
    expect(() => resolveHttpsOptions()).not.toThrow();
  });
});
