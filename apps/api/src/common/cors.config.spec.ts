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
    it('includes the dev-default WEB_BASE and Vite origins when WEB_BASE is unset outside production', () => {
      const origins = allowedCorsOrigins({ NODE_ENV: 'test' });

      expect(origins.has('http://localhost:5173')).toBe(true);
      expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    });

    it('includes a custom WEB_BASE alongside dev origins outside production', () => {
      const origins = allowedCorsOrigins({ WEB_BASE: 'https://app.example.com', NODE_ENV: 'test' });

      expect(origins.has('https://app.example.com')).toBe(true);
      // dev origins remain allowed alongside the configured production one
      expect(origins.has('http://localhost:5173')).toBe(true);
      expect(origins.has('http://127.0.0.1:5173')).toBe(true);
    });

    // EVT-19 review round 2 (minor finding): dev Vite origins must not be
    // allow-listed for credentialed CORS in production.
    it('excludes the Vite dev origins when NODE_ENV=production', () => {
      const origins = allowedCorsOrigins({
        WEB_BASE: 'https://app.example.com',
        NODE_ENV: 'production',
      });

      expect(origins.has('https://app.example.com')).toBe(true);
      expect(origins.has('http://localhost:5173')).toBe(false);
      expect(origins.has('http://127.0.0.1:5173')).toBe(false);
    });

    it('falls back to process.env when no env argument is given', () => {
      process.env.WEB_BASE = 'https://from-process-env.example.com';

      const origins = allowedCorsOrigins();

      expect(origins.has('https://from-process-env.example.com')).toBe(true);
    });

    // Fails closed rather than silently falling back to a dev origin: a
    // production deploy missing WEB_BASE shouldn't happen (compose enforces
    // it via `${WEB_BASE:?}`), but if it somehow did, no credentialed
    // origin should be allowed rather than defaulting to localhost:5173.
    it('allows no origins when WEB_BASE is unset and NODE_ENV=production', () => {
      const origins = allowedCorsOrigins({ NODE_ENV: 'production' });

      expect(origins.size).toBe(0);
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
