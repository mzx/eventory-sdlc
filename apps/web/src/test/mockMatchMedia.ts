import { vi } from 'vitest';

/**
 * Overrides `window.matchMedia` so MUI's `useMediaQuery` resolves as if the
 * viewport were below the `md` breakpoint (phone width) — used by App.test
 * to exercise the bottom-nav path (EVT-35 AC5). The default stub installed
 * in `src/test/setup.ts` answers "desktop" (query-aware: `min-width`
 * queries match, others don't); call this in a test
 * BEFORE rendering to flip it. Uses `vi.stubGlobal` (rather than a plain
 * assignment) specifically so `vi.unstubAllGlobals()` — called in
 * `setup.ts`'s global `afterEach` — restores the desktop-default stub
 * afterward; a plain assignment would leak into later tests in the same
 * file, since `window` isn't reset between tests the way modules are.
 *
 * MUI's `theme.breakpoints.up('md')` query is `(min-width:900px)` for the
 * default theme — this stub matches any `min-width` query as false (not
 * desktop-wide) and anything else (e.g. a `max-width` query) as true, which
 * is the phone-width posture for every query shape App.tsx or BottomNav
 * could plausibly issue.
 */
export function mockPhoneViewport(): void {
  vi.stubGlobal(
    'matchMedia',
    (query: string): MediaQueryList =>
      ({
        matches: !query.includes('min-width'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}
