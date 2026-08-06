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
 * Extracted out of `main.ts` (EVT-14 review round 3) so it — and the
 * `corsOriginValidator` callback below — can be unit-tested directly.
 * `main.ts` calls `bootstrap()` at module load, so importing it in a spec
 * would start the app as a side effect; this module has none.
 */
export function allowedCorsOrigins(): Set<string> {
  return new Set(
    [
      process.env.WEB_BASE,
      DEFAULT_WEB_BASE,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter((origin): origin is string => Boolean(origin)),
  );
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
