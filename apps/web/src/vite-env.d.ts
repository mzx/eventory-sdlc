/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Base URL for the Eventory API. Defaults to `/api` (Vite dev proxy → :3001). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * Build-time version string, e.g. `994831b · 2026-08-14`, or the `dev`
 * marker — injected via `vite.config.ts`'s `define` (EVT-34 AC2). Replaced
 * textually at build time; never fetched at runtime. See
 * `vite-config/build-version.ts` and `components/UserMenu.tsx`.
 */
declare const __BUILD_VERSION__: string;
