/**
 * Env-tunable `@nestjs/throttler` limits.
 *
 * `POST /api/photos/upload?analyze=true` triggers a billed Anthropic vision
 * call and has no auth guard in front of it — auth itself is out of scope
 * here (EVT-14/15) — so an unauthenticated caller could loop the endpoint
 * to drive unbounded spend on `EVENTORY_ANTHROPIC_KEY` plus provider
 * rate-limit exhaustion for legitimate users. Throttling is the in-scope
 * mitigation (EVT-7 review round 2, finding 1).
 *
 * `@nestjs/throttler` v5+ expresses `ttl` in MILLISECONDS (earlier majors
 * used seconds) — every value below is already ms.
 */

function envPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Global per-IP default, applied to every route via the `APP_GUARD`
 * `ThrottlerGuard` registered in `AppModule`. Permissive — it exists as a
 * baseline safety net, not a primary control; the primary control is the
 * stricter `uploadThrottlerConfig` below applied directly to the upload
 * route.
 */
export function globalThrottlerConfig(): { name: string; ttl: number; limit: number }[] {
  return [
    {
      name: 'default',
      ttl: envPositiveInt('EVENTORY_THROTTLE_GLOBAL_TTL_MS', 60_000),
      limit: envPositiveInt('EVENTORY_THROTTLE_GLOBAL_LIMIT', 120),
    },
  ];
}

/**
 * Strict limit for `POST /api/photos/upload` — the route that can trigger a
 * billed AI call — applied via `@Throttle(uploadThrottlerConfig())` on the
 * route itself. Defaults to 10 requests/minute per IP.
 */
export function uploadThrottlerConfig(): { default: { ttl: number; limit: number } } {
  return {
    default: {
      ttl: envPositiveInt('EVENTORY_THROTTLE_UPLOAD_TTL_MS', 60_000),
      limit: envPositiveInt('EVENTORY_THROTTLE_UPLOAD_LIMIT', 10),
    },
  };
}
