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

/** Builds the browser-facing URL for the QR sticker PNG of an item/location token. */
export function qrImageUrl(token: string, size?: number): string {
  const suffix = size ? `?size=${size}` : '';
  return `${API_BASE}/qr/${encodeURIComponent(token)}${suffix}`;
}

// ---------------------------------------------------------------------------
// auth failure notification (EVT-15)
//
// A 401/403 from ANY endpoint means the session expired or was rejected
// server-side (e.g. an admin demoted/rejected the user mid-session). Rather
// than every page having to know about auth, `AuthContext` registers a
// listener here once at boot; every response path below (JSON and
// multipart) calls it so a stale session lands the user back on LoginPage
// the moment any request fails, not just on the next `/auth/me` poll.
// ---------------------------------------------------------------------------

type AuthFailureListener = () => void;

let authFailureListener: AuthFailureListener | null = null;

export function setAuthFailureListener(listener: AuthFailureListener | null): void {
  authFailureListener = listener;
}

function notifyIfAuthFailure(status: number): void {
  if (status === 401 || status === 403) {
    authFailureListener?.();
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  notifyIfAuthFailure(response.status);
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

/** Row shape returned by `GET /api/locations` (flat list, materialized path). */
export interface LocationListItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  qrCode: string;
  itemCount: number;
}

/** Row shape returned by `GET /api/categories` (flat list, materialized path). */
export interface CategoryListItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
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
  return request<ItemDetail>(`/items/${encodeURIComponent(id)}`);
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
  notifyIfAuthFailure(response.status);
  if (!response.ok) {
    throw new Error(`Request to /items/search-by-photo failed with status ${response.status}`);
  }
  return (await response.json()) as PhotoSearchResult;
}

/**
 * PATCH /api/items/:id — partial update.
 * `tags`, when present, fully replaces the tag list.
 * `photoIds`, when present, sets the primary photo to its first entry.
 */
export interface UpdateItemInput {
  name?: string;
  description?: string;
  quantity?: number;
  unit?: string;
  properties?: Record<string, unknown>;
  /** `undefined` (omitted) leaves the relation unchanged; `null` clears it. */
  locationId?: string | null;
  /** `undefined` (omitted) leaves the relation unchanged; `null` clears it. */
  categoryId?: string | null;
  tags?: string[];
  photoIds?: string[];
}

export async function updateItem(id: string, input: UpdateItemInput): Promise<ItemDetail> {
  return request<ItemDetail>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

/** DELETE /api/items/:id — 204 on success. */
export async function deleteItem(id: string): Promise<void> {
  return request<void>(`/items/${id}`, { method: 'DELETE' });
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

/** GET /api/locations — flat list ordered by path. */
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

// ---------------------------------------------------------------------------
// projects + BOM (EVT-16)
// ---------------------------------------------------------------------------

export type ProjectStatus = 'planned' | 'in_progress' | 'completed' | 'archived';

/** Row shape returned by `GET /api/projects` — annotated with a BOM line count. */
export interface ProjectListRow {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lineCount: number;
}

/** Summary of the inventory item a BOM line is linked to, if any. */
export interface BomLineItemRef {
  id: string;
  name: string;
  qrCode: string;
}

export interface BomLine {
  id: string;
  projectId: string;
  itemId: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  item: BomLineItemRef | null;
}

/** Full detail shape returned by `GET /api/projects/:id` — BOM lines instead of a count. */
export interface ProjectDetail {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  notes: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  bomLines: BomLine[];
}

export interface ListProjectsParams {
  status?: ProjectStatus;
}

/** GET /api/projects?status= */
export async function fetchProjects(params: ListProjectsParams = {}): Promise<ProjectListRow[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set('status', params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ProjectListRow[]>(`/projects${suffix}`);
}

/** GET /api/projects/:id */
export async function fetchProject(id: string): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`);
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  status?: ProjectStatus;
  notes?: string;
  startedAt?: string;
  completedAt?: string;
}

/** POST /api/projects */
export async function createProject(input: CreateProjectInput): Promise<ProjectDetail> {
  return request<ProjectDetail>('/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type UpdateProjectInput = Partial<CreateProjectInput>;

/** PATCH /api/projects/:id */
export async function updateProject(id: string, input: UpdateProjectInput): Promise<ProjectDetail> {
  return request<ProjectDetail>(`/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

/** DELETE /api/projects/:id */
export async function deleteProject(id: string): Promise<void> {
  return request<void>(`/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export interface CreateBomLineInput {
  /** Link to an inventory item; its name is copied server-side. */
  itemId?: string;
  /** Free-text line name. Required when `itemId` is omitted. */
  name?: string;
  quantity?: number;
  unit?: string;
  notes?: string;
}

/** POST /api/projects/:id/bom */
export async function addBomLine(projectId: string, input: CreateBomLineInput): Promise<BomLine> {
  return request<BomLine>(`/projects/${encodeURIComponent(projectId)}/bom`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export type UpdateBomLineInput = Partial<Omit<CreateBomLineInput, 'itemId'>> & {
  /** Pass `null` to unlink the line from its inventory item. */
  itemId?: string | null;
};

/** PATCH /api/projects/:id/bom/:lineId */
export async function updateBomLine(
  projectId: string,
  lineId: string,
  input: UpdateBomLineInput,
): Promise<BomLine> {
  return request<BomLine>(
    `/projects/${encodeURIComponent(projectId)}/bom/${encodeURIComponent(lineId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  );
}

/** DELETE /api/projects/:id/bom/:lineId */
export async function deleteBomLine(projectId: string, lineId: string): Promise<void> {
  return request<void>(
    `/projects/${encodeURIComponent(projectId)}/bom/${encodeURIComponent(lineId)}`,
    { method: 'DELETE' },
  );
}

// ---------------------------------------------------------------------------
// categories (EVT-4)
// ---------------------------------------------------------------------------

/** GET /api/categories — flat list ordered by path. */
export async function fetchCategories(): Promise<CategoryListItem[]> {
  return request<CategoryListItem[]>('/categories');
}

// ---------------------------------------------------------------------------
// photos (EVT-6)
// ---------------------------------------------------------------------------

export interface UploadedPhoto extends PhotoRef {
  url: string;
  itemId?: string | null;
}

/**
 * POST /api/photos/upload — multipart upload, optionally linked to an item.
 *
 * Deliberately bypasses the shared `request()` helper: that helper always
 * sends `Content-Type: application/json`, which would omit the multipart
 * boundary the browser needs to generate for a `FormData` body.
 */
export async function uploadPhoto(file: File, itemId?: string): Promise<UploadedPhoto> {
  const form = new FormData();
  form.append('file', file);
  if (itemId) form.append('itemId', itemId);
  const response = await fetch(`${API_BASE}/photos/upload`, { method: 'POST', body: form });
  notifyIfAuthFailure(response.status);
  if (!response.ok) {
    throw new Error(`Photo upload failed with status ${response.status}`);
  }
  return (await response.json()) as UploadedPhoto;
}

/** DELETE /api/photos/:id — removes the photo (row + on-disk file). */
export async function deletePhoto(id: string): Promise<void> {
  return request<void>(`/photos/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// auth (EVT-14 / EVT-15)
// ---------------------------------------------------------------------------

export type UserStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'user' | 'admin';

/** Shape returned by `GET /api/auth/me` (see apps/api PublicUser). */
export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  status: UserStatus;
  role: UserRole;
  createdAt: string;
}

/**
 * GET /api/auth/me — always resolves 200, with a literal JSON `null` body
 * when signed out. Deliberately does NOT go through `notifyIfAuthFailure`
 * (this route never returns 401/403, see the API's doc comment on `me()`).
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  return request<AuthUser | null>('/auth/me');
}

/** Full-page-navigation URL that kicks off the Google OAuth redirect. */
export function authGoogleUrl(): string {
  return `${API_BASE}/auth/google`;
}

/** Full-page-navigation URL that clears the session cookie and redirects home. */
export function authLogoutUrl(): string {
  return `${API_BASE}/auth/logout`;
}

// ---------------------------------------------------------------------------
// admin users (EVT-15)
// ---------------------------------------------------------------------------

/** Row shape returned by `GET /api/users` (admin-only; see apps/api UsersService.list). */
export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  status: UserStatus;
  role: UserRole;
  createdAt: string;
  lastLoginAt: string | null;
}

/** GET /api/users — admin-only, oldest-first. */
export async function fetchUsers(): Promise<AdminUserRow[]> {
  return request<AdminUserRow[]>('/users');
}

/** PATCH /api/users/:id/status — approve/reject/re-pend a user. */
export async function updateUserStatus(id: string, status: UserStatus): Promise<AdminUserRow> {
  return request<AdminUserRow>(`/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

/** PATCH /api/users/:id/role — promote/demote a user. */
export async function updateUserRole(id: string, role: UserRole): Promise<AdminUserRow> {
  return request<AdminUserRow>(`/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}
