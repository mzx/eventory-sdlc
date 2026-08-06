import { globalThrottlerConfig, uploadThrottlerConfig } from './throttle.config';

// ---------------------------------------------------------------------------
// EVT-7 review round 2, finding 1 — env-tunable throttle limits.
// ---------------------------------------------------------------------------

describe('throttle.config', () => {
  const ENV_KEYS = [
    'EVENTORY_THROTTLE_GLOBAL_TTL_MS',
    'EVENTORY_THROTTLE_GLOBAL_LIMIT',
    'EVENTORY_THROTTLE_UPLOAD_TTL_MS',
    'EVENTORY_THROTTLE_UPLOAD_LIMIT',
  ];
  const originalValues = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originalValues.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const original = originalValues.get(key);
      if (original === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = original;
      }
    }
  });

  describe('globalThrottlerConfig', () => {
    it('defaults to 120 requests / 60s per IP when unset', () => {
      expect(globalThrottlerConfig()).toEqual([{ name: 'default', ttl: 60_000, limit: 120 }]);
    });

    it('honors env overrides', () => {
      process.env.EVENTORY_THROTTLE_GLOBAL_TTL_MS = '30000';
      process.env.EVENTORY_THROTTLE_GLOBAL_LIMIT = '5';

      expect(globalThrottlerConfig()).toEqual([{ name: 'default', ttl: 30_000, limit: 5 }]);
    });

    it('falls back to the default for non-numeric or non-positive env values', () => {
      process.env.EVENTORY_THROTTLE_GLOBAL_LIMIT = 'not-a-number';
      expect(globalThrottlerConfig()[0].limit).toBe(120);

      process.env.EVENTORY_THROTTLE_GLOBAL_LIMIT = '-5';
      expect(globalThrottlerConfig()[0].limit).toBe(120);

      process.env.EVENTORY_THROTTLE_GLOBAL_LIMIT = '0';
      expect(globalThrottlerConfig()[0].limit).toBe(120);
    });
  });

  describe('uploadThrottlerConfig', () => {
    it('defaults to a stricter 10 requests / 60s per IP when unset', () => {
      expect(uploadThrottlerConfig()).toEqual({ default: { ttl: 60_000, limit: 10 } });
    });

    it('honors env overrides', () => {
      process.env.EVENTORY_THROTTLE_UPLOAD_TTL_MS = '10000';
      process.env.EVENTORY_THROTTLE_UPLOAD_LIMIT = '2';

      expect(uploadThrottlerConfig()).toEqual({ default: { ttl: 10_000, limit: 2 } });
    });
  });
});
