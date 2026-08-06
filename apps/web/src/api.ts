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

/** Builds the browser-facing URL for a QR sticker PNG (see apps/api QrController). */
export function qrImageUrl(token: string, size?: number): string {
  const suffix = size ? `?size=${size}` : '';
  return `${API_BASE}/qr/${encodeURIComponent(token)}${suffix}`;
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
// search-by-photo (EVT-17)
// ---------------------------------------------------------------------------

/**
 * The vision analysis draft shape (see apps/api AiService.analyzePhoto).
 * `stub_reason` is present only when the model call was deliberately
 * skipped (unsupported format / oversized) rather than attempted.
 */
export interface PhotoSearchAnalysis {
  suggested_name: string;
  description: string;
  tags: string[];
  color: string | null;
  quantity: number | null;
  unit: string | null;
  properties: Record<string, unknown>;
  search_keywords: string[];
  stub_reason?: 'unsupported-image-format' | 'oversized';
}

/** Response shape of `POST /api/items/search-by-photo`. */
export interface PhotoSearchResult {
  analysis: PhotoSearchAnalysis;
  matches: ItemListRow[];
}

/**
 * POST /api/items/search-by-photo — multipart upload, NOT JSON, so this
 * bypasses the shared `request()` helper (which always sets
 * `Content-Type: application/json`). The browser sets the multipart
 * boundary itself when `FormData` is used with no explicit Content-Type
 * header, so none is set here.
 */
export async function searchItemsByPhoto(file: File): Promise<PhotoSearchResult> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE}/items/search-by-photo`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Request to /items/search-by-photo failed with status ${response.status}`);
  }
  return (await response.json()) as PhotoSearchResult;
}

// ---------------------------------------------------------------------------
// tags (EVT-5)
// ---------------------------------------------------------------------------

/** GET /api/tags */
export async function fetchTags(): Promise<Tag[]> {
  return request<Tag[]>('/tags');
}

// ---------------------------------------------------------------------------
// locations (EVT-4)
// ---------------------------------------------------------------------------

/** Row shape returned by `GET /api/locations` — a flat, path-ordered list. */
export interface LocationListItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  qrCode: string;
  itemCount: number;
}

export interface LocationChildRef {
  id: string;
  name: string;
  path: string;
}

export interface LocationBreadcrumbSegment {
  segment: string;
  path: string;
}

/** Detail shape returned by `GET /api/locations/:id`. */
export interface LocationDetail {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  notes: string | null;
  qrCode: string;
  children: LocationChildRef[];
  items: Array<{ id: string; name: string; primaryPhoto: { id: string; filename: string } | null }>;
  breadcrumb: LocationBreadcrumbSegment[];
}

export interface CreateLocationInput {
  name: string;
  parentId?: string;
  notes?: string;
}

/** GET /api/locations */
export async function fetchLocations(): Promise<LocationListItem[]> {
  return request<LocationListItem[]>('/locations');
}

/** GET /api/locations/:id */
export async function fetchLocation(id: string): Promise<LocationDetail> {
  return request<LocationDetail>(`/locations/${encodeURIComponent(id)}`);
}

/** POST /api/locations */
export async function createLocation(input: CreateLocationInput): Promise<LocationListItem> {
  return request<LocationListItem>('/locations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** PATCH /api/locations/:id */
export async function renameLocation(id: string, name: string): Promise<LocationListItem> {
  return request<LocationListItem>(`/locations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** DELETE /api/locations/:id */
export async function deleteLocation(id: string): Promise<void> {
  return request<void>(`/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
