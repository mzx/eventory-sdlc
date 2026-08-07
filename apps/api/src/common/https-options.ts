import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';

/**
 * Resolves HTTPS credentials for the Nest bootstrap from mkcert-generated
 * `cert.pem` / `key.pem` files under `certsDir` (default: `<cwd>/certs`,
 * i.e. `apps/api/certs/` when the API is started from `apps/api/` — both
 * `nest start` and the Docker runtime image use that as their working
 * directory).
 *
 * Both dev servers need HTTPS: phone browsers gate camera `capture` and
 * service workers on secure origins, and the Google OAuth redirect
 * (EVT-14) needs a stable https origin. See `apps/web/vite.config.ts` for
 * the equivalent on the web dev server, and README.md "Phone-on-LAN dev
 * setup" for how to generate the certs.
 *
 * `apps/api/certs/` is gitignored and NOT required — when the files are
 * absent (CI, a fresh clone without mkcert) this returns `undefined` and
 * Nest boots over plain HTTP instead of failing.
 */
export function resolveHttpsOptions(
  certsDir: string = join(process.cwd(), 'certs'),
): HttpsOptions | undefined {
  const certPath = join(certsDir, 'cert.pem');
  const keyPath = join(certsDir, 'key.pem');
  if (!existsSync(certPath) || !existsSync(keyPath)) {
    return undefined;
  }
  return {
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
  };
}
