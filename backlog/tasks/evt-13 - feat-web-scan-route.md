---
id: EVT-13
title: 'feat(web): scan landing route /r/:token — resolve to item or location'
status: To Do
labels: [web, qr, scan]
dependencies: [EVT-8, EVT-10, EVT-12]
references: [PRODUCT.md]
priority: medium
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
- [ ] Visiting `/r/<item-token>` lands on that item's detail; `/r/<location-token>` on the location view; garbage token shows the friendly error
- [ ] In-app scanner decodes a QR rendered by `GET /api/qr/:token` (test with a generated PNG fixture where feasible, else document manual check)
- [ ] Route works on hard refresh (SPA fallback configured in Vite/serve)
<!-- AC:END -->
