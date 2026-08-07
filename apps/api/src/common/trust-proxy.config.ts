/**
 * Enables Express's `trust proxy` setting on the given app.
 *
 * Behind the Caddy reverse proxy (EVT-19), every request Express sees
 * originates from Caddy's container IP, not the real client — so `req.ip`
 * (which `@nestjs/throttler` keys its per-IP buckets on, see
 * throttle.config.ts) is identical for every caller. Without this, the
 * global 120/60s default limit and the strict 10/60s upload/AI limit both
 * collapse into ONE shared bucket across every visitor: any single caller
 * can exhaust it and 429 every other caller, and there's no per-caller
 * isolation on billed Anthropic AI spend (EVT-19 review round 2, finding
 * 2).
 *
 * `1` tells Express to trust exactly one hop in front of it (Caddy), so it
 * reads the client IP from the first entry of `X-Forwarded-For` — which is
 * the real originating client, because Caddy sets/overwrites that header
 * itself rather than trusting whatever an upstream client sent. This is
 * safe here specifically because the `api` service
 * (docker-compose.prod.yml) publishes no host port: Caddy is the ONLY way
 * to reach it, so nothing can spoof an extra hop in front of Caddy to
 * forge `X-Forwarded-For`.
 *
 * Extracted out of `main.ts` (same rationale as cors.config.ts) so it can
 * be unit-tested directly without triggering `bootstrap()`'s side effects.
 */
export interface TrustProxyCapable {
  set(key: string, value: unknown): unknown;
}

export function configureTrustProxy(app: TrustProxyCapable): void {
  app.set('trust proxy', 1);
}
