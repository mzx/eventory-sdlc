import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { resolveBuildVersion } from './vite-config/build-version';
import { resolveApiProxyTarget, resolveHttpsOptions } from './vite-config/https-options';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Repo root — two levels up from apps/web. `VERSION` (see .gitattributes)
// is a git-archive `export-subst` placeholder; see build-version.ts for why
// this resolves to the `dev` marker for every build EXCEPT one whose
// source tree came from deploy.sh's `git archive` (EVT-34).
const buildVersion = resolveBuildVersion(path.join(dirname, '..', '..', 'VERSION'));

// mkcert-generated dev certs (see README.md "Phone-on-LAN dev setup" and
// apps/api/src/common/https-options.ts, which does the equivalent for the
// API). `apps/web/certs/` is gitignored — CI and fresh clones without
// mkcert fall back to plain HTTP automatically. See ./vite-config/https-options.ts
// for the implementation + tests.
const webCertsDir = path.join(dirname, 'certs');
// The API's OWN certs directory — in Docker this is bind-mounted read-only
// into the web container alongside its own certs/ (see docker-compose.yml
// `web` service); outside Docker it's the real sibling directory on the
// host. Used to pick the /api + /storage proxy scheme — see
// resolveApiProxyTarget's docstring for why we can't infer this from the
// web side's own cert presence.
const apiCertsDir = path.join(dirname, '..', 'api', 'certs');

// https://vitejs.dev/config/
export default defineConfig({
  // Build-time-only global (EVT-34 AC2) — replaced textually wherever
  // `__BUILD_VERSION__` appears in src (see vite-env.d.ts for the ambient
  // type, UserMenu.tsx for the one call site). No runtime git/network call.
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'Eventory',
        short_name: 'Eventory',
        description: 'Workshop home inventory — photograph, tag, and find anything in the shop.',
        theme_color: '#1a237e',
        background_color: '#1a237e',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/pwa-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Never let the SPA navigation fallback intercept API or upload
        // routes — those are never precached, and stale inventory data
        // reached through a cached shell would be worse than a network error.
        navigateFallbackDenylist: [/^\/api\//, /^\/storage\//],
        runtimeCaching: [
          {
            // Uploaded item photos (EVT-6): fine to cache — they're
            // immutable once uploaded, and caching keeps the gallery fast
            // on a flaky workshop wifi connection.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/storage/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'eventory-storage-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 30 },
              // statuses: [200] only — same-origin responses are never
              // opaque (status 0), so there's nothing unvalidatable to
              // guard against; narrowing avoids caching an opaque body for
              // 30 days on the off chance one shows up.
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Inventory data: NEVER cache. Stale inventory is worse than
            // slow inventory (see EVT-18 AC #3) — always hit the network.
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
      devOptions: {
        // Exercise the real service worker in `vite dev` too — this is the
        // origin phones on the LAN actually connect to (see README.md).
        enabled: true,
        type: 'module',
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    https: resolveHttpsOptions(webCertsDir),
    proxy: {
      // API routes (items, tags, locations, photos, health, ...).
      '/api': {
        target: resolveApiProxyTarget(apiCertsDir),
        changeOrigin: true,
        // Accept the mkcert-issued upstream cert without chain validation
        // when proxying https://api:3001 — Node's proxy client doesn't
        // have mkcert's local CA in its trust store inside the container.
        // Dev-only; the target is always the trusted docker-compose `api`
        // service or an explicit operator override, never an
        // operator/network-supplied host.
        secure: false,
      },
      // Uploaded photo files, served by the API outside the /api prefix
      // (see apps/api/src/main.ts `useStaticAssets`).
      '/storage': {
        target: resolveApiProxyTarget(apiCertsDir),
        changeOrigin: true,
        secure: false,
      },
    },
  },
  test: {
    environment: 'jsdom',
    // Required so `@testing-library/react`'s auto-`cleanup()` (registered
    // via a global `afterEach`) actually runs between tests.
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // The userEvent-driven MUI form tests (EditItemPage in particular) take
    // 300-800ms each locally under `--coverage`; on shared CI runners the
    // v8-instrumentation slowdown pushes them past vitest's 5000ms default.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
