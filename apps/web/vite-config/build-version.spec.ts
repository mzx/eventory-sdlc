import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatBuildVersion,
  parseVersionFileContents,
  readVersionFile,
  resolveBuildVersion,
} from './build-version';

function withTmpDir<T>(fn: (dir: string) => T): T {
  const d = mkdtempSync(join(tmpdir(), 'eventory-web-build-version-'));
  try {
    return fn(d);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

describe('parseVersionFileContents', () => {
  it('parses a git-archive-substituted VERSION file (short sha + committer date)', () => {
    expect(parseVersionFileContents('994831b 2026-08-14\n')).toEqual({
      sha: '994831b',
      date: '2026-08-14',
    });
  });

  it('parses a full-length (40-char) sha, tolerating surrounding whitespace', () => {
    expect(
      parseVersionFileContents('  fae28fa1234567890abcdef1234567890abcdef 2026-01-01  \n'),
    ).toEqual({
      sha: 'fae28fa1234567890abcdef1234567890abcdef',
      date: '2026-01-01',
    });
  });

  it('returns null for the literal, unsubstituted export-subst placeholder (local checkout, dev bind mount)', () => {
    expect(parseVersionFileContents('$Format:%h %cs$\n')).toBeNull();
  });

  it('returns null for an empty/missing file', () => {
    expect(parseVersionFileContents('')).toBeNull();
    expect(parseVersionFileContents(undefined)).toBeNull();
  });

  it('returns null for malformed content', () => {
    expect(parseVersionFileContents('not-a-version-line')).toBeNull();
  });
});

describe('formatBuildVersion', () => {
  it('formats a parsed version as "<sha> · <date>"', () => {
    expect(formatBuildVersion({ sha: '994831b', date: '2026-08-14' })).toBe('994831b · 2026-08-14');
  });

  it('falls back to the dev marker when null (AC4)', () => {
    expect(formatBuildVersion(null)).toBe('dev');
  });
});

describe('readVersionFile', () => {
  it('returns the file contents when present', () => {
    withTmpDir((d) => {
      const path = join(d, 'VERSION');
      writeFileSync(path, '994831b 2026-08-14\n');
      expect(readVersionFile(path)).toBe('994831b 2026-08-14\n');
    });
  });

  it('returns undefined instead of throwing when the file is missing', () => {
    withTmpDir((d) => {
      expect(readVersionFile(join(d, 'does-not-exist'))).toBeUndefined();
    });
  });
});

describe('resolveBuildVersion', () => {
  it('end-to-end: a git-archive-substituted VERSION file resolves to "<sha> · <date>" (AC3)', () => {
    withTmpDir((d) => {
      const path = join(d, 'VERSION');
      writeFileSync(path, '994831b 2026-08-14\n');
      expect(resolveBuildVersion(path)).toBe('994831b · 2026-08-14');
    });
  });

  it('end-to-end: an unsubstituted placeholder resolves to "dev" (local vite dev / dev compose, AC4)', () => {
    withTmpDir((d) => {
      const path = join(d, 'VERSION');
      writeFileSync(path, '$Format:%h %cs$\n');
      expect(resolveBuildVersion(path)).toBe('dev');
    });
  });

  it('end-to-end: a missing VERSION file resolves to "dev" rather than throwing', () => {
    withTmpDir((d) => {
      expect(resolveBuildVersion(join(d, 'does-not-exist'))).toBe('dev');
    });
  });
});
