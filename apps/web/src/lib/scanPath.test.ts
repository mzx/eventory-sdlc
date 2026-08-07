import { describe, expect, it } from 'vitest';
import { extractScanPath } from './scanPath';

describe('extractScanPath', () => {
  it('extracts the /r/:token pathname from an absolute sticker URL', () => {
    expect(extractScanPath('https://eventory.example.com/r/abc-123')).toBe('/r/abc-123');
  });

  it('accepts an already-relative /r/:token path', () => {
    expect(extractScanPath('/r/abc-123')).toBe('/r/abc-123');
  });

  it('rejects a decoded payload that is not an Eventory scan URL', () => {
    expect(extractScanPath('https://example.com/not-a-scan-route')).toBeNull();
    expect(extractScanPath('just some text')).toBeNull();
  });
});
