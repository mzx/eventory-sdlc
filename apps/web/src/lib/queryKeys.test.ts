import { describe, expect, it } from 'vitest';
import { wsKey } from './queryKeys';

describe('wsKey (EVT-43 AC1)', () => {
  it('prefixes every key with a fixed tag plus the workspace id', () => {
    expect(wsKey('ws-1', 'items')).toEqual(['ws', 'ws-1', 'items']);
    expect(wsKey('ws-1', 'items', { search: 'drill' })).toEqual([
      'ws',
      'ws-1',
      'items',
      { search: 'drill' },
    ]);
  });

  it('keeps a null workspace id as its own distinct bucket (pre-resolution window)', () => {
    expect(wsKey(null, 'items')).toEqual(['ws', null, 'items']);
  });

  it('two different workspace ids never produce the same key for the same logical query', () => {
    const a = wsKey('ws-1', 'items');
    const b = wsKey('ws-2', 'items');
    expect(a).not.toEqual(b);
  });

  it('supports a bare workspace-only key (invalidate everything for one workspace)', () => {
    expect(wsKey('ws-1')).toEqual(['ws', 'ws-1']);
  });
});
