import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves HTTPS credentials for the Vite dev server from mkcert-generated
 * `cert.pem` / `key.pem` under `certsDir` (default caller: `apps/web/certs/`
 * — see `vite.config.ts`). Mirrors `apps/api/src/common/https-options.ts`
 * (the equivalent for the API dev server); see README.md "Phone-on-LAN dev
 * setup" for how the certs get there.
 *
 * `apps/web/certs/` is gitignored and NOT required — when either file is
 * absent (CI, a fresh clone without mkcert) this returns `undefined` and
 * Vite falls back to plain HTTP instead of failing.
 *
 * NOTE: this module is intentionally kept outside `src/` (it's Node-only
 * dev-server config, never bundled into the app) — same as `vite.config.ts`
 * itself, which is why it isn't covered by the `eslint "src/**"` / `tsc`
 * (`"include": ["src"]`) scopes; it IS covered by `vitest run`, which has
 * no `include` override and picks up any `*.spec.ts` in the project.
 */
export function resolveHttpsOptions(certsDir: string): { cert: Buffer; key: Buffer } | undefined {
  const certPath = path.join(certsDir, 'cert.pem');
  const keyPath = path.join(certsDir, 'key.pem');
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    return undefined;
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

/**
 * Resolves the Vite dev-server proxy target for `/api` and `/storage`
 * (the NestJS API, `apps/api`).
 *
 * `VITE_API_PROXY_TARGET` (in `env`), when set, always wins — an explicit
 * operator override, e.g. pointing the web dev server at a non-Docker API
 * host.
 *
 * Otherwise the scheme is picked from whether the API's OWN certs are
 * present at `apiCertsDir`, NOT from the web dev server's own HTTPS state.
 * EVT-18 review finding: the api and web `certs/` directories are
 * populated independently (separate host paths / separate Docker
 * bind-mounts — see the `web` service in docker-compose.yml, which mounts
 * `apps/api/certs/` read-only alongside its own `apps/web/certs/` purely so
 * this check can see the API's real state). Inferring the API's protocol
 * from the web side's own cert presence would be wrong whenever the two are
 * asymmetric (e.g. only one side has certs) — reading the API's directory
 * directly is correct in every combination.
 */
export function resolveApiProxyTarget(
  apiCertsDir: string,
  host = 'api:3001',
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.VITE_API_PROXY_TARGET) {
    return env.VITE_API_PROXY_TARGET;
  }
  const certPath = path.join(apiCertsDir, 'cert.pem');
  const keyPath = path.join(apiCertsDir, 'key.pem');
  const apiHasCerts = fs.existsSync(certPath) && fs.existsSync(keyPath);
  return `${apiHasCerts ? 'https' : 'http'}://${host}`;
}
