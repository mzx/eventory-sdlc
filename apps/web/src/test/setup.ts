import { afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { setActiveWorkspaceId } from '../api';
import { setActiveWorkspaceRole } from '../workspace/useActiveWorkspace';

// jsdom does not implement `window.matchMedia` (a known gap — see
// https://github.com/jsdom/jsdom/issues/3522). MUI's `useMediaQuery` calls
// it on every render — both `theme.breakpoints.up(...)` (App.tsx's xs/sm
// bottom-nav vs. md+ toolbar split, EVT-35) and `theme.breakpoints.down(...)`
// (e.g. ProjectDetailPage's fullScreen-on-mobile BackflushDialog, EVT-36) —
// so every test needs SOME implementation or it throws.
//
// The default stub below is query-aware and answers "desktop" for every
// breakpoint query shape MUI emits:
//   - `up(...)`   → `(min-width: ...)` → matches TRUE  (viewport is wide)
//   - `down(...)` → `(max-width: ...)` → matches FALSE (viewport not narrow)
// so tests that don't care about viewport size see desktop behavior either
// way. Tests exercising a specific breakpoint override this locally — via
// `mockPhoneViewport` (`src/test/mockMatchMedia.ts`, `vi.stubGlobal`) or
// `vi.spyOn(window, 'matchMedia').mockImplementation(...)` — and the
// corresponding `afterEach` restore (global `vi.unstubAllGlobals()` below,
// or per-suite `vi.restoreAllMocks()`) brings this default back afterwards.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: /min-width/.test(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// Undoes any `vi.stubGlobal('matchMedia', ...)` a test made (see
// `mockPhoneViewport` in `src/test/mockMatchMedia.ts`) so the phone-width
// override never leaks into a later test in the same file.
afterEach(() => {
  vi.unstubAllGlobals();
});

// Resets the active-workspace id/role stores (EVT-43) after every test —
// vitest reuses one module graph per test FILE (not per `it`), so without
// this a `setActiveWorkspaceId(...)` in one test would otherwise leak into
// every later test in the same file/suite via `localStorage` + the
// in-memory store alike.
afterEach(() => {
  setActiveWorkspaceId(null);
  setActiveWorkspaceRole(null);
});
