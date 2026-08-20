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

// ---------------------------------------------------------------------------
// active workspace (EVT-43) — persisted selection sent as X-Workspace-Id
//
// A plain module-level store (not React state) so the header can be built by
// `request()`/the two multipart bypasses below without threading a workspace
// id through every call site, and so a fresh page load restores the last
// selection before React even mounts. `useActiveWorkspaceId` (see
// `workspace/useActiveWorkspace.ts`) is the React-facing read side, wired up
// via `useSyncExternalStore` against `subscribeActiveWorkspaceId` below —
// mirrors this file's own `authFailureListener` pattern.
// ---------------------------------------------------------------------------

/** Header the API expects to select a non-default workspace (mirrors apps/api's `WORKSPACE_HEADER`). */
const WORKSPACE_HEADER = 'X-Workspace-Id';
const ACTIVE_WORKSPACE_STORAGE_KEY = 'eventory:activeWorkspaceId';

function readStoredActiveWorkspaceId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY);
  } catch {
    // localStorage unavailable (privacy mode, some test environments) — the
    // in-memory value below is still authoritative for this page load.
    return null;
  }
}

let activeWorkspaceId: string | null = readStoredActiveWorkspaceId();
const activeWorkspaceListeners = new Set<() => void>();

/** Current active workspace id, or `null` before one has resolved. */
export function getActiveWorkspaceId(): string | null {
  return activeWorkspaceId;
}

/** Sets (and persists) the active workspace id; notifies every subscriber so React re-renders. */
export function setActiveWorkspaceId(id: string | null): void {
  if (activeWorkspaceId === id) return;
  activeWorkspaceId = id;
  try {
    if (id) {
      localStorage.setItem(ACTIVE_WORKSPACE_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_WORKSPACE_STORAGE_KEY);
    }
  } catch {
    // ignore — in-memory value above is still authoritative for this tab
  }
  for (const listener of activeWorkspaceListeners) listener();
}

/** Subscribes to active-workspace-id changes; returns an unsubscribe function. `useSyncExternalStore`'s subscribe param. */
export function subscribeActiveWorkspaceId(listener: () => void): () => void {
  activeWorkspaceListeners.add(listener);
  return () => activeWorkspaceListeners.delete(listener);
}

/** `X-Workspace-Id` header object when a workspace is active, else `{}` — spread into every fetch's headers. */
function workspaceHeaders(): Record<string, string> {
  return activeWorkspaceId ? { [WORKSPACE_HEADER]: activeWorkspaceId } : {};
}

// ---------------------------------------------------------------------------
// stale-workspace-header self-heal (EVT-43 round-2 review, MAJOR 1)
//
// `WorkspaceContextGuard` (apps/api/src/workspace/workspace-context.guard.ts)
// 403s a request carrying an `X-Workspace-Id` the caller isn't a member of —
// BEFORE it ever consults `@AllowMissingWorkspace()`. A removed member (or a
// different account signing in on the same browser after a previous user's
// id was left in localStorage) keeps sending that now-invalid id on every
// request; nothing previously cleared it, so it was a silent, unrecoverable
// lockout. The two branches below close that gap:
//
//   1. `WORKSPACE_INDEPENDENT` request calls (`fetchWorkspaces`,
//      `createWorkspace`, `redeemInvite`) never attach the header at all —
//      those three routes don't need (or want) it; sending a stale id there
//      just breaks the very escape hatches meant to recover from one.
//   2. `selfHealStaleWorkspaceHeader` inspects any OTHER 403 for the guard's
//      two fixed rejection messages. A match means the STORED id itself is
//      the problem (not a legitimate in-workspace permission denial, e.g.
//      `WorkspaceWriteGuard`'s "Viewers cannot modify workspace data" 403,
//      which must NOT clear the caller's selection) — clears it and notifies
//      every registered `workspaceContextInvalidatedListeners` entry so each
//      mounted `useMyWorkspaces` (see workspace/useActiveWorkspace.ts) can
//      invalidate its cached list and fall back to a still-valid membership.
// ---------------------------------------------------------------------------

/**
 * Mirrors `NOT_A_MEMBER_MESSAGE`/`NO_WORKSPACE_MESSAGE` in
 * apps/api/src/workspace/workspace-context.guard.ts — the two fixed 403
 * bodies `WorkspaceContextGuard` throws when the ambient workspace itself
 * fails to resolve (bad header, or no header and no membership at all).
 * Deliberately narrow: matching this set means the caller's SELECTED
 * workspace is invalid, not that they lack permission to act within a
 * workspace they really belong to.
 */
const WORKSPACE_CONTEXT_403_MESSAGES = new Set([
  'Not a member of the requested workspace',
  'No workspace access',
]);

// A `Set`, not a single nullable slot (EVT-43 review, convergent MAJOR):
// `useMyWorkspaces` (see useActiveWorkspace.ts) mounts in multiple
// components at once — the app shell, the switcher, onboarding, members
// settings. A single slot meant ANY one of them unmounting (e.g.
// `InviteRedeemPage` after redeem, `OnboardingPage` after its first
// workspace, or `AppShell` navigating to the sibling-routed print pages
// `/items/:id/print` and `/projects/:id/pick-list`) nulled the listener out
// from under every other still-mounted consumer — silently disabling the
// self-heal below for the rest of the session, so a later workspace-context
// 403 cleared the stored id but never invalidated the cached workspaces
// list, and the fallback effect re-selected the very membership the server
// just rejected: an id-flapping 403 loop only a reload broke. Mirrors
// `activeWorkspaceListeners` above and `activeWorkspaceRoleListeners` in
// `useActiveWorkspace.ts` — every consumer adds its own listener on mount
// and removes ONLY that listener on unmount.
const workspaceContextInvalidatedListeners = new Set<() => void>();

/**
 * Registers a listener invoked (after the stored id has already been
 * cleared) when a response 403s specifically because the persisted
 * `X-Workspace-Id` is stale/foreign. `useMyWorkspaces` wires this to
 * invalidate the cached workspaces list so its own self-healing effect can
 * pick a still-valid membership — see the module doc comment above. Returns
 * an unsubscribe function that removes ONLY this listener, `useEffect`
 * cleanup style — safe to call from multiple mounted consumers at once.
 */
export function addWorkspaceContextInvalidatedListener(listener: () => void): () => void {
  workspaceContextInvalidatedListeners.add(listener);
  return () => workspaceContextInvalidatedListeners.delete(listener);
}

/**
 * Best-effort: reads a CLONED response body (never consumes the caller's own
 * read of it) so a non-JSON or already-drained body just no-ops rather than
 * throwing here.
 */
async function selfHealStaleWorkspaceHeader(response: Response): Promise<void> {
  if (response.status !== 403) return;
  try {
    const body = (await response.clone().json()) as { message?: unknown };
    if (typeof body.message === 'string' && WORKSPACE_CONTEXT_403_MESSAGES.has(body.message)) {
      setActiveWorkspaceId(null);
      for (const listener of workspaceContextInvalidatedListeners) listener();
    }
  } catch {
    // Non-JSON or unreadable body — nothing to self-heal from.
  }
}

interface RequestOptions extends RequestInit {
  /**
   * Omit `X-Workspace-Id` even when a workspace is active — for the three
   * workspace-independent endpoints (list/create workspaces, redeem invite)
   * that must never depend on, or be blocked by, the caller's currently
   * selected workspace (EVT-43 round-2 review, MAJOR 1).
   */
  skipWorkspaceHeader?: boolean;
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const { skipWorkspaceHeader, headers: callerHeaders, ...rest } = init ?? {};
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    // Explicit merge (not `{ headers: {...}, ...init }`, which let a
    // call-site's own `headers` silently replace — not extend — this
    // object, dropping `X-Workspace-Id` and falling back server-side to the
    // caller's oldest membership) — round-2 review, suggestion 7.
    headers: {
      'Content-Type': 'application/json',
      ...(skipWorkspaceHeader ? {} : workspaceHeaders()),
      ...callerHeaders,
    },
  });
  notifyIfAuthFailure(response.status);
  await selfHealStaleWorkspaceHeader(response);
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
  /**
   * Count cadence in days (EVT-27). `null`/`undefined` = not on a count
   * schedule. Optional client-side (rather than required), same rationale
   * as `LocationListItem.kind` above — existing fixtures/tests that predate
   * EVT-27 keep compiling; every real API response always includes it.
   */
  countIntervalDays?: number | null;
  /** When this item was last explicitly counted. `null`/`undefined` = never verified. Optional client-side, see `countIntervalDays` above. */
  lastVerifiedAt?: string | null;
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
    headers: workspaceHeaders(),
    body: formData,
  });
  notifyIfAuthFailure(response.status);
  await selfHealStaleWorkspaceHeader(response);
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
  /**
   * Count cadence in days (EVT-27). `undefined` (omitted) leaves it
   * unchanged; `null` clears it back to "not on a count schedule".
   */
  countIntervalDays?: number | null;
  /**
   * Manual override of the last-verified timestamp (EVT-27). `undefined`
   * (omitted) leaves it unchanged; `null` clears it to "never verified".
   */
  lastVerifiedAt?: string | null;
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
    headers: { 'Content-Type': 'application/json', ...workspaceHeaders() },
  });
  if (response.status === 404) {
    throw new QrLookupNotFoundError(token);
  }
  await selfHealStaleWorkspaceHeader(response);
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
    headers: workspaceHeaders(),
    body: form,
  });
  notifyIfAuthFailure(response.status);
  await selfHealStaleWorkspaceHeader(response);
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

// ---------------------------------------------------------------------------
// count cadence + opportunistic verification (EVT-27)
// ---------------------------------------------------------------------------

/**
 * `true` when `item` is past due for its next scheduled count — mirrors
 * `apps/api ItemsService.daysOverdue`'s "never verified = due
 * countIntervalDays after createdAt" rule. `null`/no schedule is never
 * overdue, matching the API's verification-queue filter (AC 3/5).
 */
export function isCountOverdue(
  item: {
    countIntervalDays?: number | null;
    lastVerifiedAt?: string | null;
    createdAt: string;
  },
  now: Date = new Date(),
): boolean {
  if (item.countIntervalDays == null) return false;
  const baseline = new Date(item.lastVerifiedAt ?? item.createdAt);
  const dueAt = baseline.getTime() + item.countIntervalDays * 24 * 60 * 60 * 1000;
  return now.getTime() >= dueAt;
}

/** Response shape of `POST /api/items/:id/count` (EVT-27 AC 2, blind entry). */
export interface CountItemResult {
  item: ItemDetail;
  /** On-hand quantity BEFORE this count — only ever revealed after submit. */
  bookQuantity: number;
  /** What the counter actually entered. */
  countedQuantity: number;
  /** `countedQuantity - bookQuantity`. */
  delta: number;
}

/** POST /api/items/:id/count — records a blind verification count. */
export async function countItem(id: string, quantity: number): Promise<CountItemResult> {
  return request<CountItemResult>(`/items/${encodeURIComponent(id)}/count`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

/** Response shape of `POST /api/items/:id/consume` (EVT-27 AC 4). */
export interface ConsumeItemResult {
  item: ItemDetail;
  /** `true` when the resulting on-hand qualifies for the opportunistic "how many are actually left?" prompt. */
  offerVerification: boolean;
}

/** POST /api/items/:id/consume — records a `consume` movement for up to `quantity` (clamped to on-hand). */
export async function consumeItem(id: string, quantity: number): Promise<ConsumeItemResult> {
  return request<ConsumeItemResult>(`/items/${encodeURIComponent(id)}/consume`, {
    method: 'POST',
    body: JSON.stringify({ quantity }),
  });
}

/** Row shape returned by `GET /api/items/verification-queue` (EVT-27 AC 3). */
export interface VerificationQueueRow {
  id: string;
  name: string;
  quantity: number;
  qrCode: string;
  lastVerifiedAt: string | null;
  countIntervalDays: number;
  createdAt: string;
  primaryPhoto: PhotoRef | null;
  location: LocationRef | null;
  /** Whole days past due, floored. `0` = due today. */
  daysOverdue: number;
}

/** GET /api/items/verification-queue — "today's count list", most-overdue first, capped at 20. */
export async function fetchVerificationQueue(): Promise<VerificationQueueRow[]> {
  return request<VerificationQueueRow[]>('/items/verification-queue');
}

// ---------------------------------------------------------------------------
// workspaces, membership, invitations (EVT-42 API surface / EVT-43 web UI)
// ---------------------------------------------------------------------------

/** `owner` is never grantable directly (see apps/api `INVITABLE_ROLES`) — only via `transferOwnership` server-side, which this client doesn't expose (EVT-43 non-goal). */
export type WorkspaceRole = 'owner' | 'member' | 'viewer';
/** Role an invite/role-change may GRANT — excludes `owner`, mirrors apps/api `INVITABLE_ROLES`. */
export type InvitableWorkspaceRole = Exclude<WorkspaceRole, 'owner'>;
export type WorkspaceInviteStatus = 'pending' | 'redeemed' | 'revoked' | 'expired';

/** Row shape returned by `GET /api/workspaces` (see apps/api `WorkspaceSummary`) — the caller's own role is embedded per-workspace. */
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
}

/** Row shape returned by `GET /api/workspaces/:id/members` (see apps/api `MemberSummary`). */
export interface WorkspaceMemberRow {
  userId: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: WorkspaceRole;
  memberSince: string;
}

/** Response shape of `POST /api/workspaces/:id/invites` — the raw, redeemable token, returned ONLY here (see apps/api `InviteWithToken`). */
export interface WorkspaceInviteWithToken {
  id: string;
  token: string;
  role: InvitableWorkspaceRole;
  status: WorkspaceInviteStatus;
  expiresAt: string;
  createdAt: string;
}

/** Row shape returned by `GET /api/workspaces/:id/invites` (see apps/api `InviteSummary`) — never carries the raw token. */
export interface WorkspaceInviteRow {
  id: string;
  role: InvitableWorkspaceRole;
  status: WorkspaceInviteStatus;
  expiresAt: string;
  createdAt: string;
  redeemedAt: string | null;
}

/** Response shape of `POST /api/invites/redeem` (see apps/api `RedeemResult`). */
export interface RedeemInviteResult {
  workspaceId: string;
  role: WorkspaceRole;
}

/**
 * GET /api/workspaces — every workspace the caller belongs to, oldest
 * membership first, with their role in each. `skipWorkspaceHeader`: this is
 * the call that DISCOVERS which workspaces exist — sending a stale/foreign
 * `X-Workspace-Id` would 403 it before it ever runs, which is exactly the
 * escape hatch a removed member (or a shared browser's next user) needs to
 * recover (EVT-43 round-2 review, MAJOR 1).
 */
export async function fetchWorkspaces(): Promise<WorkspaceSummary[]> {
  return request<WorkspaceSummary[]>('/workspaces', { skipWorkspaceHeader: true });
}

/**
 * POST /api/workspaces — create a workspace; the caller becomes its owner.
 * `skipWorkspaceHeader`: a zero-membership caller (or one recovering from a
 * stale selection) must be able to create their first workspace regardless
 * of whatever id is currently persisted — see `fetchWorkspaces` above.
 */
export async function createWorkspace(name: string): Promise<WorkspaceSummary> {
  return request<WorkspaceSummary>('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
    skipWorkspaceHeader: true,
  });
}

/** PATCH /api/workspaces/:id — rename. Owner-only server-side. */
export async function renameWorkspace(id: string, name: string): Promise<WorkspaceSummary> {
  return request<WorkspaceSummary>(`/workspaces/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}

/** GET /api/workspaces/:id/members — roster + roles. Reachable by any member. */
export async function fetchWorkspaceMembers(workspaceId: string): Promise<WorkspaceMemberRow[]> {
  return request<WorkspaceMemberRow[]>(`/workspaces/${encodeURIComponent(workspaceId)}/members`);
}

/** PATCH /api/workspaces/:id/members/:userId/role — toggles member<->viewer. Owner-only server-side. */
export async function changeWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: InvitableWorkspaceRole,
): Promise<WorkspaceMemberRow> {
  return request<WorkspaceMemberRow>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}/role`,
    { method: 'PATCH', body: JSON.stringify({ role }) },
  );
}

/** DELETE /api/workspaces/:id/members/:userId — an owner removing someone else, or a member removing themselves ("leave"). */
export async function removeWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
  return request<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  );
}

/** POST /api/workspaces/:id/invites — creates a single-use, 7-day invite. `role` defaults to `member` server-side when omitted. Owner-only. */
export async function createWorkspaceInvite(
  workspaceId: string,
  role?: InvitableWorkspaceRole,
): Promise<WorkspaceInviteWithToken> {
  return request<WorkspaceInviteWithToken>(
    `/workspaces/${encodeURIComponent(workspaceId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify({ role }),
    },
  );
}

/** GET /api/workspaces/:id/invites — every invite (any status), newest first. Owner-only. */
export async function fetchWorkspaceInvites(workspaceId: string): Promise<WorkspaceInviteRow[]> {
  return request<WorkspaceInviteRow[]>(`/workspaces/${encodeURIComponent(workspaceId)}/invites`);
}

/** DELETE /api/workspaces/:id/invites/:inviteId — revokes a still-pending invite. Owner-only. */
export async function revokeWorkspaceInvite(workspaceId: string, inviteId: string): Promise<void> {
  return request<void>(
    `/workspaces/${encodeURIComponent(workspaceId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  );
}

/**
 * POST /api/invites/redeem — the raw token travels in the JSON body, never
 * the URL (mirrors apps/api `RedeemInviteDto`'s doc comment: a path segment
 * leaks a redeemable credential into proxy/access logs and browser history).
 * `skipWorkspaceHeader`: the invitee is very likely NOT a member of whatever
 * workspace id happens to be persisted (zero-membership onboarding, or a
 * stale id from a previous account on a shared browser) — sending it would
 * 403 the redemption itself (EVT-43 round-2 review, MAJOR 1).
 */
export async function redeemInvite(token: string): Promise<RedeemInviteResult> {
  return request<RedeemInviteResult>('/invites/redeem', {
    method: 'POST',
    body: JSON.stringify({ token }),
    skipWorkspaceHeader: true,
  });
}
