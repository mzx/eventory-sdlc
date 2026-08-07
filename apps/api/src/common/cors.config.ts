import { DEFAULT_WEB_BASE } from '../auth/auth.service';

/**
 * Origins allowed to make credentialed (cookie-bearing) requests.
 *
 * `origin: true` reflects ANY request's `Origin` header back with
 * `Access-Control-Allow-Credentials: true` — any site the browser loads can
 * ride the visitor's session cookie. Restricted to the configured
 * `WEB_BASE` plus the dev-default Vite origins instead (EVT-14 review
 * round 2, finding 4).
 *
 * The Vite dev-server origins (`localhost:5173` / `127.0.0.1:5173`) are
 * only added when `NODE_ENV !== 'production'` — a production deploy behind
 * the Caddy reverse proxy (EVT-19) has no legitimate same-origin caller on
 * that port, so allow-listing it there just widens the credentialed-CORS
 * surface for no benefit (EVT-19 review round 2, minor finding).
 *
 * Extracted out of `main.ts` (EVT-14 review round 3) so it — and the
 * `corsOriginValidator` callback below — can be unit-tested directly.
 * `main.ts` calls `bootstrap()` at module load, so importing it in a spec
 * would start the app as a side effect; this module has none.
 *
 * Takes `env` as a parameter (defaulting to `process.env`), matching the
 * `resolveJwtSecret` pattern in auth.service.ts, so it's directly testable.
 */
export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const isProduction = env.NODE_ENV === 'production';
  // DEFAULT_WEB_BASE ('http://localhost:5173') is itself a dev-only
  // fallback, so it's gated the same as the two explicit Vite origins
  // below rather than always-included — production deployments must set
  // WEB_BASE explicitly (docker-compose.prod.yml enforces this via
  // `${WEB_BASE:?}`) instead of silently falling back to a dev origin.
  const webBase = env.WEB_BASE ?? (isProduction ? undefined : DEFAULT_WEB_BASE);
  const devOrigins = isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return new Set([webBase, ...devOrigins].filter((origin): origin is string => Boolean(origin)));
}

/**
 * `origin` callback passed to Nest's `enableCors({ origin })`.
 *
 * No `Origin` header (curl, server-to-server, same-origin requests) —
 * nothing for CORS to police, and there's no browser enforcing
 * same-origin policy to bypass.
 */
export function corsOriginValidator(
  allowedOrigins: Set<string>,
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  if (!origin || allowedOrigins.has(origin)) {
    callback(null, true);
    return;
  }
  callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
}
