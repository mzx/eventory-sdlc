---
id: EVT-18
title: 'chore(infra): HTTPS dev via mkcert + PWA — phone camera and installable app'
status: To Do
labels: [infrastructure, web, pwa]
dependencies: [EVT-11]
references: [PRODUCT.md]
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Phone browsers only expose `capture`/camera and service workers on secure origins, and
the Google OAuth redirect (EVT-14) needs a stable https origin. The original runs HTTPS
on BOTH 5173 (web) and 3001 (api) with mkcert certificates.

## Goal

- Both dev servers serve HTTPS using mkcert certs from `apps/web/certs/` and
  `apps/api/certs/` (gitignored). Vite `server.https`; Nest bootstraps with
  `httpsOptions` when cert files exist — plain HTTP fallback when absent, so CI and
  fresh clones work without mkcert.
- `README` section: one-time operator setup (`mkcert -install`, generating certs for
  `localhost` + the machine's LAN hostname/IP so a phone on the same network can reach it).
- PWA via `vite-plugin-pwa`: manifest (name Eventory, icons, standalone display,
  theme color), service worker with sensible runtime caching for `/storage/*` images;
  NO caching of `/api/*` (stale inventory is worse than slow inventory).
- `PUBLIC_BASE_URL` guidance updated: QR stickers should encode the LAN-reachable https
  origin so native-camera scans open the app from a phone.

## Non-goals

- Offline mutation queue, push notifications, production TLS (EVT-19)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] With certs present both origins serve https; `curl -k https://localhost:3001/api/health` green; without certs everything still boots over http
- [ ] Lighthouse (or vite-plugin-pwa check) reports installable PWA
- [ ] Service worker never caches `/api/*` responses (verify cache storage after browsing)
- [ ] README documents the phone-on-LAN setup end to end
<!-- AC:END -->
