---
id: EVT-8
title: 'feat(api): QR code PNGs — GET /api/qr/:token renders scannable sticker linking to /r/:token'
status: Done
labels: [api, qr]
dependencies: [EVT-3, EVT-4]
references: [PRODUCT.md]
priority: high
updated_date: '2026-08-06 10:34'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Items and locations already carry `qrCode` uuid tokens (EVT-2), and `by-qr` lookups exist
(EVT-3/EVT-4), but there is nothing to print and stick on a bin.

## Goal

`QrModule`:

- `GET /api/qr/:token?size=512` — PNG QR code (via `qrcode` npm package) encoding
  `${PUBLIC_BASE_URL}/r/:token`. `size` clamps 64–2048, default 512. Content-Type
  `image/png`, long-lived cache headers (token is immutable).
- `PUBLIC_BASE_URL` env (default `https://localhost:5173`) — the WEB origin, so a phone
  scanning the sticker with its native camera lands in the app.
- 404 when the token matches neither an item nor a location (prevents printing orphans).

## Non-goals

- The `/r/:token` web route itself (EVT-13), sticker sheet layout/printing UI (post-parity)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] PNG decodes back (test with a QR-decoding lib) to `${PUBLIC_BASE_URL}/r/<token>`
- [x] size clamping works (size=10 → 64, size=99999 → 2048)
- [x] Unknown token → 404; item token and location token both → 200
<!-- AC:END -->

## Final Summary

## Summary
Implemented QrModule (controller + service) in apps/api serving `GET /api/qr/:token?size=512` — renders a PNG QR code (via `qrcode`) encoding `${PUBLIC_BASE_URL}/r/:token` so scanning a printed sticker lands in the web app. Size clamps to [64, 2048] (default 512), responses carry `Content-Type: image/png` + long-lived immutable Cache-Control, and unknown tokens (neither item nor location) return 404. `PUBLIC_BASE_URL` added to `.env.example` and `docker-compose.yml` (default `https://localhost:5173`).

## Changes
- `apps/api/src/qr/qr.module.ts` — new QrModule, registered in AppModule
- `apps/api/src/qr/qr.controller.ts` — GET /api/qr/:token with manual @Res() binary PNG handling
- `apps/api/src/qr/qr.service.ts` — token existence check (item-then-location via Prisma), size clamping, QR render
- `apps/api/src/qr/qr.service.spec.ts` — AC1 (real encode→jsqr decode round-trip), AC2 (clampSize boundaries incl. 10→64, 99999→2048), AC3 (item/location 200, unknown 404)
- `apps/api/src/qr/qr.controller.spec.ts` — headers, status, 404 propagation
- `apps/api/.env.example`, `docker-compose.yml` — PUBLIC_BASE_URL
- `apps/api/package.json`, `pnpm-lock.yaml` — deps: qrcode (+types); devDeps: jsqr, pngjs (+types)

## Design decisions
Controller uses manual @Res() because the body is a raw binary Buffer (Nest's default reply pipeline is JSON-oriented). The 2048 boundary is asserted via the pure `clampSize` unit (a real 2048px render takes ~15s under ts-jest in this environment); render wiring proven at an in-range size.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

## Follow-up
Reviewer suggestions (non-blocking): rate limiting on the render path (@nestjs/throttler), static 404 message instead of echoing the token, guard `clampSize` against non-string query values, trailing-slash trim for PUBLIC_BASE_URL, optional e2e spec for /api/qr.
