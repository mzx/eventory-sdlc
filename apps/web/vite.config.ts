import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// mkcert-generated dev certs (see README.md "Phone-on-LAN dev setup" and
// apps/api/src/common/https-options.ts, which does the equivalent for the
// API). `apps/web/certs/` is gitignored — CI and fresh clones without
// mkcert fall back to plain HTTP automatically.
function resolveHttpsOptions(): { cert: Buffer; key: Buffer } | undefined {
  const certPath = path.join(dirname, 'certs', 'cert.pem');
  const keyPath = path.join(dirname, 'certs', 'key.pem');
  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    return undefined;
  }
  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

// https://vitejs.dev/config/
export default defineConfig({
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
              cacheableResponse: { statuses: [0, 200] },
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
    https: resolveHttpsOptions(),
    proxy: {
      // API routes (items, tags, locations, photos, health, ...).
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://api:3001',
        changeOrigin: true,
      },
      // Uploaded photo files, served by the API outside the /api prefix
      // (see apps/api/src/main.ts `useStaticAssets`).
      '/storage': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://api:3001',
        changeOrigin: true,
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
