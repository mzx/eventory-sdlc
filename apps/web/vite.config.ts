import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
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
  },
});
