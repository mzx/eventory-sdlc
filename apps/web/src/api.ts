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
  /** Replenishment threshold (EVT-26). `null` = no replenishment tracking. */
  minQuantity: number | null;
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

/**
 * `area` — a fixed room/shelf/cabinet. `container` — a movable box/case with
 * a "Move to…" re-parent flow (EVT-30). Optional client-side (rather than
 * required) so existing fixtures/tests that predate EVT-30 keep compiling —
 * every real API response always includes it; UI code that cares should
 * treat a missing value as `'area'`.
 */
export type LocationKind = 'area' | 'container';

/** Row shape returned by `GET /api/locations` (flat list, materialized path). */
export interface LocationListItem {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  qrCode: string;
  kind?: LocationKind;
  /** Recursive: this location's own items PLUS every descendant's (EVT-30 AC 5). */
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

/**
 * POST /api/items input (see apps/api CreateItemDto). `photoIds`, when
 * present, are attached to the new item and its first entry becomes the
 * primary photo — this is how the intake flow (EVT-11) links the freshly
 * uploaded photo.
 */
export interface CreateItemInput {
  name: string;
  description?: string;
  quantity?: number;
  unit?: string;
  properties?: Record<string, unknown>;
  locationId?: string;
  categoryId?: string;
  tags?: string[];
  photoIds?: string[];
}

/** POST /api/items */
export async function createItem(input: CreateItemInput): Promise<ItemDetail> {
  return request<ItemDetail>('/items', { method: 'POST', body: JSON.stringify(input) });
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
  /**
   * Replenishment threshold (EVT-26). `undefined` (omitted) leaves it
   * unchanged; `null` clears it back to "no replenishment tracking".
   */
  minQuantity?: number | null;
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

/**
 * POST /api/items/:id/receive — distributor barcode receiving's "add to
 * existing" branch (EVT-31 AC 4): re-scanning a known MPN adds `quantity`
 * to this item's on-hand count (recorded as an `add` movement server-side)
 * instead of creating a duplicate item.
 */
export async function receiveItem(id: string, quantity: number): Promise<ItemDetail> {
  return request<ItemDetail>(`/items/${encodeURIComponent(id)}/receive`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

// ---------------------------------------------------------------------------
// stock movements (EVT-25)
// ---------------------------------------------------------------------------

export type StockMovementKind = 'add' | 'consume' | 'move' | 'adjust' | 'build';

/** Denormalized location summary embedded on a movement row's from/to side. */
export interface MovementLocationRef {
  id: string;
  name: string;
  path: string;
}

/** Denormalized project summary embedded on a movement row, when linked. */
export interface MovementProjectRef {
  id: string;
  name: string;
}

/** Row shape returned by `GET /api/items/:id/movements` (see apps/api StockMovementsService). */
export interface StockMovementRow {
  id: string;
  itemId: string;
  kind: StockMovementKind;
  delta: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  projectId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  fromLocation: MovementLocationRef | null;
  toLocation: MovementLocationRef | null;
  project: MovementProjectRef | null;
}

/** Paginated envelope returned by `GET /api/items/:id/movements`. */
export interface StockMovementsPage {
  data: StockMovementRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FetchItemMovementsParams {
  page?: number;
  pageSize?: number;
}

/** GET /api/items/:id/movements?page=&pageSize= — newest first. 404 for an unknown item. */
export async function fetchItemMovements(
  id: string,
  params: FetchItemMovementsParams = {},
): Promise<StockMovementsPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<StockMovementsPage>(`/items/${encodeURIComponent(id)}/movements${suffix}`);
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
  kind?: LocationKind;
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
  kind?: LocationKind;
  children: LocationChildRef[];
  items: Array<{ id: string; name: string; primaryPhoto: { id: string; filename: string } | null }>;
  breadcrumb: LocationBreadcrumbSegment[];
}

export interface CreateLocationInput {
  name: string;
  parentId?: string;
  notes?: string;
  /** Defaults to `area` server-side when omitted (EVT-30). */
  kind?: LocationKind;
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

/**
 * POST /api/locations/:id/move — "Move to…" (EVT-30 AC 2). Re-parents a
 * container location; `toParentId: null` moves it to root. 400 if `id` is
 * not a container; 422 if the destination is the container itself or one of
 * its own descendants (AC 4); 409 on a sibling-slug path conflict at the
 * destination.
 */
export async function moveLocation(id: string, toParentId: string | null): Promise<LocationDetail> {
  return request<LocationDetail>(`/locations/${encodeURIComponent(id)}/move`, {
    method: 'POST',
    body: JSON.stringify({ toParentId }),
  });
}

/** Row shape returned by `GET /api/locations/:id/movements` (EVT-30 AC 3) — a container's own re-parent history. */
export interface ContainerMovementRow {
  id: string;
  containerId: string;
  kind: StockMovementKind;
  delta: number;
  fromLocationId: string | null;
  toLocationId: string | null;
  note: string | null;
  createdById: string | null;
  createdAt: string;
  fromLocation: MovementLocationRef | null;
  toLocation: MovementLocationRef | null;
}

/** Paginated envelope returned by `GET /api/locations/:id/movements`. */
export interface ContainerMovementsPage {
  data: ContainerMovementRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface FetchContainerMovementsParams {
  page?: number;
  pageSize?: number;
}

/** GET /api/locations/:id/movements?page=&pageSize= — newest first. 404 when `id` is not a container. */
export async function fetchContainerMovements(
  id: string,
  params: FetchContainerMovementsParams = {},
): Promise<ContainerMovementsPage> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return request<ContainerMovementsPage>(`/locations/${encodeURIComponent(id)}/movements${suffix}`);
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
  /** Kitting pick-list check-off state (EVT-29 AC 3) — informational only. */
  picked: boolean;
  createdAt: string;
  updatedAt: string;
  item: BomLineItemRef | null;
}

/** One backflush `build` movement, as embedded in `ProjectDetail.consumed` (EVT-28 AC 5). */
export interface ConsumedMovement {
  id: string;
  itemId: string;
  kind: StockMovementKind;
  delta: number;
  projectId: string | null;
  note: string | null;
  createdAt: string;
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
  /** Backflush consumption history (EVT-28), newest first — empty until first backflushed. */
  consumed: ConsumedMovement[];
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
  /** Pick-list check-off state (EVT-29 AC 3). */
  picked?: boolean;
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
// availability — clear-to-build check + kitting pick list (EVT-29)
// ---------------------------------------------------------------------------

export type AvailabilityStatus = 'ok' | 'short' | 'untracked';

/** Denormalized location summary embedded on an availability line, for the pick list (AC 3). */
export interface AvailabilityLocationRef {
  id: string;
  name: string;
  path: string;
}

/** One BOM line as shown on the "Can I build this?" panel / pick list. */
export interface AvailabilityLine {
  lineId: string;
  itemId: string | null;
  name: string;
  quantity: number;
  unit: string | null;
  /** Current on-hand for the linked item; `null` for a free-text (untracked) line. */
  onHand: number | null;
  /** Where the linked item is stored; `null` for untracked lines or an unlocated item. */
  location: AvailabilityLocationRef | null;
  status: AvailabilityStatus;
  picked: boolean;
}

export interface AvailabilityCounts {
  ok: number;
  short: number;
  untracked: number;
}

/** Response shape of `GET /api/projects/:id/availability`. */
export interface ProjectAvailability {
  projectId: string;
  /** Point-in-time read timestamp (EVT-29 risk) — this can go stale. */
  asOf: string;
  /** `true` when every tracked (item-linked) line is `ok`. */
  clearToBuild: boolean;
  counts: AvailabilityCounts;
  lines: AvailabilityLine[];
}

/** GET /api/projects/:id/availability */
export async function fetchProjectAvailability(projectId: string): Promise<ProjectAvailability> {
  return request<ProjectAvailability>(`/projects/${encodeURIComponent(projectId)}/availability`);
}

// ---------------------------------------------------------------------------
// backflush — build completion consumes BOM stock (EVT-28)
// ---------------------------------------------------------------------------

/** One BOM line as shown on the pre-confirmation backflush screen. */
export interface BackflushPreviewLine {
  lineId: string;
  itemId: string | null;
  name: string;
  /** BOM line quantity (the plan). */
  quantity: number;
  unit: string | null;
  /** Current on-hand for the linked item; `null` for a free-text (skipped) line. */
  onHand: number | null;
  /** `min(quantity, onHand)` — the default consume quantity to preselect. */
  suggestedConsumeQuantity: number;
  /** `true` when `onHand < quantity` — highlight this line. */
  shortage: boolean;
  /** `true` for a free-text (no `itemId`) line — "not tracked, skipped". */
  skipped: boolean;
}

/** Response shape of `GET /api/projects/:id/backflush-preview`. */
export interface BackflushPreview {
  projectId: string;
  /** `true` when this project already has recorded `build` movements (idempotency guard). */
  alreadyBackflushed: boolean;
  lines: BackflushPreviewLine[];
}

/** GET /api/projects/:id/backflush-preview */
export async function fetchBackflushPreview(projectId: string): Promise<BackflushPreview> {
  return request<BackflushPreview>(`/projects/${encodeURIComponent(projectId)}/backflush-preview`);
}

export interface BackflushLineInput {
  lineId: string;
  consumeQuantity: number;
}

export interface BackflushInput {
  lines: BackflushLineInput[];
  /** Required to re-confirm when the project was already backflushed. */
  confirmAgain?: boolean;
}

/** One line actually written by a `confirmBackflush` call. */
export interface BackflushConsumedLine {
  lineId: string;
  itemId: string;
  name: string;
  requestedQuantity: number;
  consumedQuantity: number;
  shortage: boolean;
  movementId: string;
}

export interface BackflushResult {
  project: ProjectDetail;
  consumed: BackflushConsumedLine[];
}

/** POST /api/projects/:id/backflush — confirms the backflush; 409 if already backflushed and `confirmAgain` isn't set. */
export async function confirmBackflush(
  projectId: string,
  input: BackflushInput,
): Promise<BackflushResult> {
  return request<BackflushResult>(`/projects/${encodeURIComponent(projectId)}/backflush`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------------
// categories (EVT-4)
// ---------------------------------------------------------------------------

/** GET /api/categories — flat list ordered by path. */
export async function fetchCategories(): Promise<CategoryListItem[]> {
  return request<CategoryListItem[]>('/categories');
}

// ---------------------------------------------------------------------------
// QR scan resolution (EVT-13)
// ---------------------------------------------------------------------------

/** `GET /api/items/by-qr/:qr` resolves a scanned token to whichever entity
 * it belongs to (see apps/api ItemsService.findByQr — item lookup carries
 * the item table's own `by-qr` route; there is no separate location-scoped
 * client call since the single endpoint checks both tables). */
export interface ByQrItemResult {
  kind: 'item';
  item: ItemDetail;
}

export interface ByQrLocationResult {
  kind: 'location';
  location: {
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    notes: string | null;
  };
}

export type ByQrResult = ByQrItemResult | ByQrLocationResult;

/** Thrown by `fetchByQr` when the token matches neither an item nor a
 * location (404) — distinct from other request failures so `ScanPage` can
 * show a friendly "Unknown code" screen instead of a generic error. */
export class QrLookupNotFoundError extends Error {
  constructor(token: string) {
    super(`No item or location found for QR token: ${token}`);
    this.name = 'QrLookupNotFoundError';
  }
}

/**
 * GET /api/items/by-qr/:token
 *
 * Deliberately bypasses the shared `request()` helper so a 404 can be
 * translated into `QrLookupNotFoundError` rather than a generic status-code
 * message.
 */
export async function fetchByQr(token: string): Promise<ByQrResult> {
  const response = await fetch(`${API_BASE}/items/by-qr/${encodeURIComponent(token)}`, {
    headers: { 'Content-Type': 'application/json' },
  });
  if (response.status === 404) {
    throw new QrLookupNotFoundError(token);
  }
  if (!response.ok) {
    throw new Error(`Request to /items/by-qr/${token} failed with status ${response.status}`);
  }
  return (await response.json()) as ByQrResult;
}

// ---------------------------------------------------------------------------
// photos (EVT-6)
// ---------------------------------------------------------------------------

export interface UploadedPhoto extends PhotoRef {
  url: string;
  itemId?: string | null;
  /**
   * Present only when the upload was made with `analyze=true` (see
   * `uploadPhoto`'s `analyze` param). Never `null` when present — the
   * server always returns a result (real or stub), never a bare failure —
   * but stays optional here since a plain (non-analyzed) upload omits the
   * field entirely.
   */
  aiAnalysis?: PhotoSearchAnalysis;
}

/**
 * POST /api/photos/upload — multipart upload, optionally linked to an item
 * and optionally analyzed (`analyze=true` runs Claude vision analysis
 * server-side and returns the draft in `aiAnalysis`; see EVT-7/EVT-11).
 *
 * Deliberately bypasses the shared `request()` helper: that helper always
 * sends `Content-Type: application/json`, which would omit the multipart
 * boundary the browser needs to generate for a `FormData` body.
 */
export async function uploadPhoto(
  file: File,
  itemId?: string,
  analyze?: boolean,
): Promise<UploadedPhoto> {
  const form = new FormData();
  form.append('file', file);
  if (itemId) form.append('itemId', itemId);
  const suffix = analyze ? '?analyze=true' : '';
  const response = await fetch(`${API_BASE}/photos/upload${suffix}`, {
    method: 'POST',
    body: form,
  });
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

// ---------------------------------------------------------------------------
// shopping list / min-level replenishment (EVT-26)
// ---------------------------------------------------------------------------

export type ShoppingListEntryStatus = 'open' | 'done';

/**
 * `manual` — the "Running low" one-tap action.
 * `low_stock` — auto-created when a movement leaves `quantity <= minQuantity`.
 * (The API's Prisma enum maps this client-facing name to the `'low-stock'`
 * value stored in Postgres — see apps/api schema.prisma — but every JSON
 * response uses this underscored form.)
 */
export type ShoppingListEntrySource = 'manual' | 'low_stock';

/** Item summary embedded on a shopping-list entry (EVT-26 AC 4). */
export interface ShoppingListItemRef {
  id: string;
  name: string;
  quantity: number;
  minQuantity: number | null;
  qrCode: string;
  primaryPhoto: PhotoRef | null;
  location: LocationRef | null;
}

/** Row shape returned by `GET /api/shopping-list`. */
export interface ShoppingListEntry {
  id: string;
  itemId: string;
  status: ShoppingListEntryStatus;
  source: ShoppingListEntrySource;
  createdAt: string;
  resolvedAt: string | null;
  item: ShoppingListItemRef;
}

/** GET /api/shopping-list — open entries, oldest first. */
export async function fetchShoppingList(): Promise<ShoppingListEntry[]> {
  return request<ShoppingListEntry[]>('/shopping-list');
}

/**
 * POST /api/shopping-list — the "Running low" one-tap action (EVT-26 AC 3).
 * Idempotent: returns the item's existing open entry if it already has one.
 */
export async function markRunningLow(itemId: string): Promise<ShoppingListEntry> {
  return request<ShoppingListEntry>('/shopping-list', {
    method: 'POST',
    body: JSON.stringify({ itemId }),
  });
}

/**
 * POST /api/shopping-list/:id/restock — records an `add` movement for the
 * counted quantity and closes the entry (EVT-26 AC 5).
 */
export async function restockShoppingListEntry(
  entryId: string,
  quantity: number,
): Promise<ShoppingListEntry> {
  return request<ShoppingListEntry>(`/shopping-list/${encodeURIComponent(entryId)}/restock`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}
