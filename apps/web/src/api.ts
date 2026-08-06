// Typed fetch client for the Eventory API.
//
// Base URL: `VITE_API_BASE`, defaulting to `/api` — the Vite dev proxy
// forwards `/api` (and `/storage`, for photo files) to the API on :3001, so
// no CORS configuration is needed in dev or prod-behind-Caddy.

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api';

/** Public URL prefix uploaded photos are served under (see apps/api main.ts). */
const STORAGE_URL_PREFIX = '/storage';

/** Builds the browser-facing URL for a stored photo filename. */
export function photoUrl(filename: string): string {
  return `${STORAGE_URL_PREFIX}/${filename}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request to ${path} failed with status ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// health (EVT-1)
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: 'ok';
  db: boolean;
}

export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

// ---------------------------------------------------------------------------
// shared shapes
// ---------------------------------------------------------------------------

export interface LocationRef {
  id: string;
  name: string;
  path: string;
}

export interface CategoryRef {
  id: string;
  name: string;
  path: string;
}

export interface PhotoRef {
  id: string;
  filename: string;
  mimeType: string;
}

export interface ItemTagRef {
  itemId: string;
  tagId: string;
  tag: { id: string; name: string; color: string | null };
}

/** Row shape returned by `GET /api/items` (see apps/api ITEM_LIST_INCLUDE). */
export interface ItemListRow {
  id: string;
  name: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  properties: Record<string, unknown>;
  qrCode: string;
  locationId: string | null;
  categoryId: string | null;
  primaryPhotoId: string | null;
  createdAt: string;
  updatedAt: string;
  tags: ItemTagRef[];
  location: LocationRef | null;
  primaryPhoto: PhotoRef | null;
}

/** Full detail shape returned by `GET /api/items/:id` (adds category + photos). */
export interface ItemDetail extends ItemListRow {
  category: CategoryRef | null;
  photos: PhotoRef[];
}

export interface Tag {
  id: string;
  name: string;
  color: string | null;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// items (EVT-3)
// ---------------------------------------------------------------------------

export interface ListItemsParams {
  search?: string;
  tag?: string;
  locationId?: string;
}

/** GET /api/items?search=&tag=&locationId= */
export async function fetchItems(params: ListItemsParams = {}): Promise<ItemListRow[]> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.tag) qs.set('tag', params.tag);
  if (params.locationId) qs.set('locationId', params.locationId);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ItemListRow[]>(`/items${suffix}`);
}

/** GET /api/items/:id */
export async function fetchItem(id: string): Promise<ItemDetail> {
  return request<ItemDetail>(`/items/${id}`);
}

// ---------------------------------------------------------------------------
// tags (EVT-5)
// ---------------------------------------------------------------------------

/** GET /api/tags */
export async function fetchTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags');
}
