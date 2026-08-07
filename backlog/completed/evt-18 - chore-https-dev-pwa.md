---
id: EVT-18
title: 'chore(infra): HTTPS dev via mkcert + PWA — phone camera and installable app'
status: Done
updated_date: '2026-08-07 12:35'
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
- [x] With certs present both origins serve https; `curl -k https://localhost:3001/api/health` green; without certs everything still boots over http
- [x] Lighthouse (or vite-plugin-pwa check) reports installable PWA
- [x] Service worker never caches `/api/*` responses (verify cache storage after browsing)
- [x] README documents the phone-on-LAN setup end to end
<!-- AC:END -->

## Final Summary

Both dev servers now serve HTTPS from mkcert certs (`apps/api/certs/`, `apps/web/certs/`, gitignored and dockerignored) with clean plain-HTTP fallback when certs are absent, so CI and fresh clones boot unchanged. The API resolves certs via a tested `resolveHttpsOptions` module passed to Nest's `httpsOptions`; the web side mirrors the pattern in `apps/web/vite-config/https-options.ts` (tested, 7 specs) and additionally selects the dev-proxy protocol for `/api` and `/storage` from the API's own cert state (bind-mounted read-only into the web container), keeping the Docker Compose + phone-on-LAN flow working in all four cert-presence combinations. PWA via vite-plugin-pwa: installable manifest (Eventory, 192/512 icons, standalone), `/storage/*` CacheFirst (statuses [200], 30d/300 entries), `/api/*` strictly NetworkOnly with `navigateFallbackDenylist`. Docker healthcheck probes https-then-http; README documents mkcert setup, LAN cert SANs, `PUBLIC_BASE_URL` QR guidance end to end.

Reviews: 2 iterations. Round 1: code-reviewer blocked on a real compose bug (plaintext `VITE_API_PROXY_TARGET` vs HTTPS-only API); fixed in round 2 along with `.dockerignore` cert exclusion, cacheable-statuses narrowing, and healthcheck TLS-rationale comment. Round 2: all three reviewers approved (0 critical/major; 3 minor + 4 suggestions left as non-blocking follow-ups). Verification: pnpm build/test/lint/format:check all passed; AC1 manually verified with real mkcert certs (https 200 with certs; http 200 + refused TLS without).
