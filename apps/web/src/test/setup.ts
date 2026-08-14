import '@testing-library/jest-dom/vitest';

// jsdom does not implement `window.matchMedia` — MUI's `useMediaQuery`
// (used for responsive breakpoints, e.g. ProjectDetailPage's
// fullScreen-on-mobile BackflushDialog, EVT-36) calls it unconditionally,
// so any component that uses it throws "not implemented" under jsdom
// without *some* stub. Default to "no viewport media features match"
// (desktop behavior) so tests that don't care about viewport size are
// unaffected; tests exercising a specific breakpoint override this locally
// with `vi.spyOn(window, 'matchMedia').mockImplementation(...)`, which
// `vi.restoreAllMocks()` (see per-suite `afterEach`) restores back to this
// default afterwards.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}
