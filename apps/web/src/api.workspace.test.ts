import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addWorkspaceContextInvalidatedListener,
  createWorkspace,
  fetchByQr,
  fetchItems,
  fetchWorkspaces,
  getActiveWorkspaceId,
  photoUrl,
  redeemInvite,
  searchItemsByPhoto,
  setActiveWorkspaceId,
  subscribeActiveWorkspaceId,
  uploadPhoto,
} from './api';

/** Nest's default `HttpException` JSON body shape for a thrown `ForbiddenException(message)`. */
function forbiddenResponse(message: string): Response {
  return new Response(JSON.stringify({ statusCode: 403, message, error: 'Forbidden' }), {
    status: 403,
  });
}

/**
 * Covers the active-workspace store + `X-Workspace-Id` header injection
 * (EVT-43 AC1's "header on all requests") directly against `api.ts`, rather
 * than only implicitly through page-level tests. `test/setup.ts`'s global
 * `afterEach` resets the store back to `null` after every test in the suite,
 * so no local cleanup is needed here beyond what each `it` sets up itself.
 */
describe('active workspace store + X-Workspace-Id header (EVT-43)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to null (no persisted selection)', () => {
    expect(getActiveWorkspaceId()).toBeNull();
  });

  it('setActiveWorkspaceId persists the selection and updates getActiveWorkspaceId', () => {
    setActiveWorkspaceId('ws-1');
    expect(getActiveWorkspaceId()).toBe('ws-1');
    expect(localStorage.getItem('eventory:activeWorkspaceId')).toBe('ws-1');
  });

  it('setActiveWorkspaceId(null) clears the persisted selection', () => {
    setActiveWorkspaceId('ws-1');
    setActiveWorkspaceId(null);
    expect(getActiveWorkspaceId()).toBeNull();
    expect(localStorage.getItem('eventory:activeWorkspaceId')).toBeNull();
  });

  it('notifies subscribers on change, and stops after unsubscribing', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveWorkspaceId(listener);

    setActiveWorkspaceId('ws-1');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    setActiveWorkspaceId('ws-2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify when set to the same value it already holds', () => {
    setActiveWorkspaceId('ws-1');
    const listener = vi.fn();
    subscribeActiveWorkspaceId(listener);

    setActiveWorkspaceId('ws-1');
    expect(listener).not.toHaveBeenCalled();
  });

  it('sends X-Workspace-Id on every request once a workspace is active', async () => {
    setActiveWorkspaceId('ws-1');
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await fetchItems();

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Workspace-Id')).toBe('ws-1');
  });

  it('omits X-Workspace-Id when no workspace is active', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

    await fetchItems();

    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.has('X-Workspace-Id')).toBe(false);
  });

  // Round-2 review, MAJOR 3: `searchItemsByPhoto`, `fetchByQr`, and
  // `uploadPhoto` bypass the shared `request()` helper (multipart bodies,
  // and a custom 404 translation, respectively) and re-implement header
  // spreading by hand — page-level tests mock these functions outright, so
  // the real `fetch` call inside each was never actually exercised. A future
  // edit dropping `workspaceHeaders()` from one of them would pass the full
  // suite silently without a direct test like these.
  describe('X-Workspace-Id on the request() bypasses (round-2 review, MAJOR 3)', () => {
    it('searchItemsByPhoto attaches X-Workspace-Id', async () => {
      setActiveWorkspaceId('ws-1');
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ analysis: {}, matches: [] }), { status: 200 }),
        );
      const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

      await searchItemsByPhoto(file);

      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Workspace-Id')).toBe('ws-1');
    });

    it('fetchByQr attaches X-Workspace-Id', async () => {
      setActiveWorkspaceId('ws-1');
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ kind: 'item', item: {} }), { status: 200 }),
        );

      await fetchByQr('qr-token');

      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Workspace-Id')).toBe('ws-1');
    });

    it('uploadPhoto attaches X-Workspace-Id', async () => {
      setActiveWorkspaceId('ws-1');
      const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'photo-1',
            filename: 'f.jpg',
            mimeType: 'image/jpeg',
            url: '/storage/f.jpg',
          }),
          {
            status: 200,
          },
        ),
      );
      const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });

      await uploadPhoto(file);

      const [, init] = fetchMock.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Workspace-Id')).toBe('ws-1');
    });
  });

  // Round-2 review, MAJOR 1: the three workspace-INDEPENDENT calls must
  // never attach the header — sending a stale/foreign id on any of these
  // would break the very escape hatches a locked-out caller needs.
  describe('workspace-independent endpoints never send X-Workspace-Id (round-2 review, MAJOR 1)', () => {
    it('fetchWorkspaces omits the header even with a stale id persisted', async () => {
      setActiveWorkspaceId('stale-foreign-ws');
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));

      await fetchWorkspaces();

      const [, init] = fetchMock.mock.calls[0];
      expect(new Headers(init?.headers).has('X-Workspace-Id')).toBe(false);
    });

    it('createWorkspace omits the header even with a stale id persisted', async () => {
      setActiveWorkspaceId('stale-foreign-ws');
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(
            JSON.stringify({ id: 'ws-new', name: 'New', role: 'owner', createdAt: '2026-01-01' }),
            { status: 200 },
          ),
        );

      await createWorkspace('New');

      const [, init] = fetchMock.mock.calls[0];
      expect(new Headers(init?.headers).has('X-Workspace-Id')).toBe(false);
    });

    it('redeemInvite omits the header even with a stale id persisted', async () => {
      setActiveWorkspaceId('stale-foreign-ws');
      const fetchMock = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ workspaceId: 'ws-new', role: 'member' }), { status: 200 }),
        );

      await redeemInvite('raw-token');

      const [, init] = fetchMock.mock.calls[0];
      expect(new Headers(init?.headers).has('X-Workspace-Id')).toBe(false);
    });
  });

  // Round-2 review, MAJOR 1: a removed member (or a foreign id left behind
  // by a previous account on a shared browser) keeps sending an
  // `X-Workspace-Id` the server now rejects — nothing previously cleared it,
  // so it was a silent, unrecoverable lockout.
  describe('self-heals a stale/foreign X-Workspace-Id on a workspace-context 403 (round-2 review, MAJOR 1)', () => {
    const unsubscribers: Array<() => void> = [];

    afterEach(() => {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    });

    it('clears the stored id and notifies the invalidation listener on "Not a member of the requested workspace"', async () => {
      setActiveWorkspaceId('removed-ws');
      vi.spyOn(global, 'fetch').mockResolvedValue(
        forbiddenResponse('Not a member of the requested workspace'),
      );
      const listener = vi.fn();
      unsubscribers.push(addWorkspaceContextInvalidatedListener(listener));

      await expect(fetchItems()).rejects.toThrow();

      expect(getActiveWorkspaceId()).toBeNull();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('clears the stored id on "No workspace access"', async () => {
      setActiveWorkspaceId('removed-ws');
      vi.spyOn(global, 'fetch').mockResolvedValue(forbiddenResponse('No workspace access'));

      await expect(fetchItems()).rejects.toThrow();

      expect(getActiveWorkspaceId()).toBeNull();
    });

    it('does NOT clear the stored id on an in-workspace permission 403 (e.g. viewer write)', async () => {
      setActiveWorkspaceId('ws-1');
      vi.spyOn(global, 'fetch').mockResolvedValue(
        forbiddenResponse('Viewers cannot modify workspace data'),
      );
      const listener = vi.fn();
      unsubscribers.push(addWorkspaceContextInvalidatedListener(listener));

      await expect(fetchItems()).rejects.toThrow();

      expect(getActiveWorkspaceId()).toBe('ws-1');
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not throw when the 403 body is not JSON', async () => {
      setActiveWorkspaceId('ws-1');
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response('not json', { status: 403 }));

      await expect(fetchItems()).rejects.toThrow();
      // Non-JSON body — nothing to self-heal from, but the original request
      // failure still surfaces (no unhandled rejection from the self-heal
      // path itself), and the stored id is left untouched.
      expect(getActiveWorkspaceId()).toBe('ws-1');
    });

    // EVT-43 review, convergent MAJOR: the listener store is a `Set`, not a
    // single nullable slot — every registered listener must fire, and
    // unsubscribing one must not affect any other still-registered listener.
    // This is the module-level counterpart to the React-level regression
    // test in useActiveWorkspace.test.tsx (which reproduces the actual bug:
    // one `useMyWorkspaces()` consumer's unmount nulling the self-heal for
    // every other still-mounted consumer).
    it('notifies every registered listener, and unsubscribing one leaves the others intact', async () => {
      setActiveWorkspaceId('removed-ws');
      vi.spyOn(global, 'fetch').mockResolvedValue(
        forbiddenResponse('Not a member of the requested workspace'),
      );
      const survivor = vi.fn();
      const unmounted = vi.fn();
      unsubscribers.push(addWorkspaceContextInvalidatedListener(survivor));
      const unsubscribeUnmounted = addWorkspaceContextInvalidatedListener(unmounted);

      // Simulates a sibling consumer unmounting (e.g. InviteRedeemPage after
      // redeem) BEFORE the 403 below — it must remove only its own listener.
      unsubscribeUnmounted();

      await expect(fetchItems()).rejects.toThrow();

      expect(survivor).toHaveBeenCalledTimes(1);
      expect(unmounted).not.toHaveBeenCalled();
    });
  });
});

// Photo-serving hotfix: `<img>` tags can't send `X-Workspace-Id`, so the
// active workspace must ride along in the photo URL itself — without it the
// server resolves the caller's OLDEST workspace and 404s every photo
// belonging to any other one (broken images everywhere photos render while
// a non-default workspace is active).
describe('photoUrl carries the active workspace (?workspace=)', () => {
  it('appends the active workspace id as a query parameter', () => {
    setActiveWorkspaceId('11111111-1111-1111-1111-111111111111');
    expect(photoUrl('drill.jpg')).toBe(
      '/storage/drill.jpg?workspace=11111111-1111-1111-1111-111111111111',
    );
  });

  it('returns the bare storage URL when no workspace is active', () => {
    setActiveWorkspaceId(null);
    expect(photoUrl('drill.jpg')).toBe('/storage/drill.jpg');
  });

  it('reflects a workspace switch immediately — no stale URL from the previous workspace', () => {
    setActiveWorkspaceId('11111111-1111-1111-1111-111111111111');
    const before = photoUrl('drill.jpg');
    setActiveWorkspaceId('22222222-2222-2222-2222-222222222222');
    expect(photoUrl('drill.jpg')).toBe(
      '/storage/drill.jpg?workspace=22222222-2222-2222-2222-222222222222',
    );
    expect(photoUrl('drill.jpg')).not.toBe(before);
  });
});
