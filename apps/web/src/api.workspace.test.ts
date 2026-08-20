import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchItems,
  getActiveWorkspaceId,
  setActiveWorkspaceId,
  subscribeActiveWorkspaceId,
} from './api';

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
});
