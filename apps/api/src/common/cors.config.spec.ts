import { allowedCorsOrigins, corsOriginValidator } from './cors.config';

// ---------------------------------------------------------------------------
// EVT-14 review round 3 — unit coverage for the CORS origin allowlist.
//
// `main.ts` calls `bootstrap()` at module load, and every e2e spec builds
// the app via `Test.createTestingModule` (bypassing `bootstrap()`), so
// `enableCors` was never exercised by any test. Without coverage, a future
// refactor could silently reintroduce the wide-open `origin: true` CORS
// reflection this allowlist was added to close (EVT-14 review round 2,
// finding 4).
// ---------------------------------------------------------------------------

describe('cors.config', () => {
  const originalWebBase = process.env.WEB_BASE;

  afterEach(() => {
    if (originalWebBase === undefined) {
      delete process.env.WEB_BASE;
    } else {
      process.env.WEB_BASE = originalWebBase;
    }
  });

  describe('allowedCorsOrigins', () => {
    it('includes the dev-default WEB_BASE and Vite origins when WEB_BASE is unset', () => {
      delete process.env.WEB_BASE;

      const origins = allowedCorsOrigins();

      expect(origins.has('http://localhost:5173')).toBe(true);
      expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    });

    it('includes a custom WEB_BASE when set', () => {
      process.env.WEB_BASE = 'https://app.example.com';

      const origins = allowedCorsOrigins();

      expect(origins.has('https://app.example.com')).toBe(true);
      // dev origins remain allowed alongside the configured production one
      expect(origins.has('http://localhost:5173')).toBe(true);
      expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    });
  });

  describe('corsOriginValidator', () => {
    it('allows an origin present in the allowlist', () => {
      const allowed = new Set(['http://localhost:5173']);
      const callback = jest.fn();

      corsOriginValidator(allowed, 'http://localhost:5173', callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });

    it('rejects an arbitrary origin not in the allowlist', () => {
      const allowed = new Set(['http://localhost:5173']);
      const callback = jest.fn();

      corsOriginValidator(allowed, 'https://evil.example', callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const [err, allow] = callback.mock.calls[0];
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('https://evil.example');
      expect(allow).toBe(false);
    });

    it('allows requests with no Origin header (curl, server-to-server, same-origin)', () => {
      const allowed = new Set(['http://localhost:5173']);
      const callback = jest.fn();

      corsOriginValidator(allowed, undefined, callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    });
  });
});
