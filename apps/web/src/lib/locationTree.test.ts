import { describe, expect, it } from 'vitest';
import type { LocationListItem } from '../api';
import { buildLocationTree } from './locationTree';

function loc(overrides: Partial<LocationListItem> = {}): LocationListItem {
  return {
    id: 'garage',
    name: 'Garage',
    path: 'garage',
    parentId: null,
    qrCode: 'qr-garage',
    itemCount: 0,
    ...overrides,
  };
}

describe('buildLocationTree', () => {
  it('nests children under their parentId and leaves roots at the top level', () => {
    const list = [
      loc({ id: 'garage', parentId: null }),
      loc({ id: 'shelf-3', parentId: 'garage', path: 'garage.shelf-3' }),
      loc({ id: 'bin-1', parentId: 'shelf-3', path: 'garage.shelf-3.bin-1' }),
      loc({ id: 'shed', parentId: null, path: 'shed' }),
    ];

    const tree = buildLocationTree(list);

    expect(tree.map((n) => n.id)).toEqual(['garage', 'shed']);
    expect(tree[0].children.map((n) => n.id)).toEqual(['shelf-3']);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(['bin-1']);
  });

  it('treats a location with an unknown parentId as a root (orphan-safe)', () => {
    const tree = buildLocationTree([loc({ id: 'orphan', parentId: 'missing-parent' })]);
    expect(tree.map((n) => n.id)).toEqual(['orphan']);
  });
});
