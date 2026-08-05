---
id: EVT-8
title: 'feat(api): QR code PNGs — GET /api/qr/:token renders scannable sticker linking to /r/:token'
status: To Do
labels: [api, qr]
dependencies: [EVT-3, EVT-4]
references: [PRODUCT.md]
priority: high
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
- [ ] PNG decodes back (test with a QR-decoding lib) to `${PUBLIC_BASE_URL}/r/<token>`
- [ ] size clamping works (size=10 → 64, size=99999 → 2048)
- [ ] Unknown token → 404; item token and location token both → 200
<!-- AC:END -->
