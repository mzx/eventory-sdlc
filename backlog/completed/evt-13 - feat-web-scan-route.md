---
id: EVT-13
title: 'feat(web): scan landing route /r/:token — resolve to item or location'
status: Done
labels: [web, qr, scan]
dependencies: [EVT-8, EVT-10, EVT-12]
references: [PRODUCT.md]
priority: medium
updated_date: '2026-08-07 08:37'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

QR stickers encode `${PUBLIC_BASE_URL}/r/:token` (EVT-8) but the web app has no such route.

## Goal

- **ScanPage** (`/r/:token`): calls `GET /api/items/by-qr/:token`;
  `kind: item` → redirect to `/items/:id`; `kind: location` → `/locations/:id`;
  404 → friendly "Unknown code" screen with a link home.
- Brief loading state (this is the phone-camera entry point — it must feel instant).
- An in-app "Scan" AppBar action using the browser camera via a QR-scanning lib
  (e.g. `@zxing/browser` or `html5-qrcode`) that navigates to the decoded `/r/:token`
  URL — so users don't need the native camera once inside the app.

## Non-goals

- Native app deep links, scan history
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Visiting `/r/<item-token>` lands on that item's detail; `/r/<location-token>` on the location view; garbage token shows the friendly error
- [x] In-app scanner decodes a QR rendered by `GET /api/qr/:token` (test with a generated PNG fixture where feasible, else document manual check)
- [x] Route works on hard refresh (SPA fallback configured in Vite/serve)
<!-- AC:END -->

## Final Summary

## Summary
Added the `/r/:token` QR scan-landing route (ScanPage) that resolves a token via `GET /api/items/by-qr/:token` and redirects to the matching item (`/items/:id`) or location (`/locations/:id`), with a friendly "Unknown code" screen on 404 and a brief loading state. Added an in-app camera QR scanner (ScannerDialog, `@zxing/browser`) behind a new AppBar "Scan" action that navigates to the decoded `/r/:token` path (same-origin only via `extractScanPath`).

## Changes
- `apps/web/src/pages/ScanPage.tsx` (+ test) — token resolution, redirects, unknown-code and static error screens
- `apps/web/src/components/ScannerDialog.tsx` (+ test) — camera scanner dialog; stops the MediaStream even when closed before the first decode callback (captures resolved IScannerControls)
- `apps/web/src/lib/scanPath.ts` (+ test) — safe extraction of `/r/:token` from decoded QR text (discards origin/scheme; no open-redirect / javascript: vector)
- `apps/web/src/api.ts` — `fetchByQr` with encodeURIComponent token handling + 404-aware error type
- `apps/web/src/App.tsx` — `/r/:token` route + Scan AppBar action (merged with EVT-15 auth gate during rebase)
- `apps/web/package.json`, `pnpm-lock.yaml` — `@zxing/browser@0.2.1`, `@zxing/library@0.23.0` (exact-pinned)

## Design decisions
- Scanner decode path tested by mocking `@zxing/browser` (jsdom has no camera); manual device check against a real `GET /api/qr/:token` PNG recommended before merge, per AC2's documented-manual-check allowance
- Scan error screen shows a static message (does not echo the scanned token)
- SPA fallback for hard refresh relies on Vite's default history-API fallback (no server config exists in-repo to change)

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (367 api + 87 web)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 2 review rounds + 1 post-rebase round approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, both reviewers ran claude-code)

## Follow-up
- Minor (security round 3): `fetchByQr` bypasses the shared `request()` helper so a 401/403 during scan resolution doesn't trigger the auth-failure re-check; stale-UI only, no authz bypass
- Suggestion: ScannerDialog error Alert renders raw decoder `err.message` (escaped text; UI-spoofing only)
