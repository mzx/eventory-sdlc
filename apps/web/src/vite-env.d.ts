/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for the Eventory API. Defaults to `/api` (Vite dev proxy → :3001). */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
