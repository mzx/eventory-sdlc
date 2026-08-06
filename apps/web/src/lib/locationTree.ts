import type { LocationListItem } from '../api';

export interface LocationNode extends LocationListItem {
  children: LocationNode[];
}

/** Groups the flat, path-ordered `GET /api/locations` response into a tree by `parentId`. */
export function buildLocationTree(list: LocationListItem[]): LocationNode[] {
  const byId = new Map<string, LocationNode>();
  list.forEach((loc) => byId.set(loc.id, { ...loc, children: [] }));

  const roots: LocationNode[] = [];
  byId.forEach((node) => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}
