import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveApiProxyTarget, resolveHttpsOptions } from './https-options';

describe('resolveHttpsOptions', () => {
  let dir: string;

  function withTmpDir<T>(fn: (dir: string) => T): T {
    const d = mkdtempSync(join(tmpdir(), 'eventory-web-https-options-'));
    try {
      return fn(d);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }

  it('returns undefined when the certs directory has no cert/key files (fresh clone, CI)', () => {
    withTmpDir((d) => {
      dir = d;
      expect(resolveHttpsOptions(dir)).toBeUndefined();
    });
  });

  it('returns undefined when only one of cert.pem / key.pem is present', () => {
    withTmpDir((d) => {
      writeFileSync(join(d, 'cert.pem'), 'cert-only');
      expect(resolveHttpsOptions(d)).toBeUndefined();
    });
  });

  it('returns cert + key buffers when both files are present (mkcert ran)', () => {
    withTmpDir((d) => {
      writeFileSync(join(d, 'cert.pem'), 'fake-cert-contents');
      writeFileSync(join(d, 'key.pem'), 'fake-key-contents');

      const result = resolveHttpsOptions(d);

      expect(result).toBeDefined();
      expect(result?.cert?.toString()).toBe('fake-cert-contents');
      expect(result?.key?.toString()).toBe('fake-key-contents');
    });
  });
});

describe('resolveApiProxyTarget', () => {
  function withTmpDir<T>(fn: (dir: string) => T): T {
    const d = mkdtempSync(join(tmpdir(), 'eventory-web-api-proxy-target-'));
    try {
      return fn(d);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  }

  it('defaults to plain http when the api has no certs (fresh clone, CI)', () => {
    withTmpDir((d) => {
      expect(resolveApiProxyTarget(d, 'api:3001', {})).toBe('http://api:3001');
    });
  });

  it('picks https when the api certs are both present, regardless of the web side', () => {
    withTmpDir((d) => {
      writeFileSync(join(d, 'cert.pem'), 'fake-cert-contents');
      writeFileSync(join(d, 'key.pem'), 'fake-key-contents');

      expect(resolveApiProxyTarget(d, 'api:3001', {})).toBe('https://api:3001');
    });
  });

  it('stays http when only one of the api cert/key files is present', () => {
    withTmpDir((d) => {
      writeFileSync(join(d, 'cert.pem'), 'cert-only');

      expect(resolveApiProxyTarget(d, 'api:3001', {})).toBe('http://api:3001');
    });
  });

  it('lets VITE_API_PROXY_TARGET override cert detection entirely', () => {
    withTmpDir((d) => {
      writeFileSync(join(d, 'cert.pem'), 'fake-cert-contents');
      writeFileSync(join(d, 'key.pem'), 'fake-key-contents');

      expect(
        resolveApiProxyTarget(d, 'api:3001', {
          VITE_API_PROXY_TARGET: 'http://localhost:3001',
        }),
      ).toBe('http://localhost:3001');
    });
  });
});
