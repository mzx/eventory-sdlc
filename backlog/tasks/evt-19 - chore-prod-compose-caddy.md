---
id: EVT-19
title: 'chore(infra): production compose — multi-stage builds + Caddy reverse proxy'
status: To Do
labels: [infrastructure, deploy]
dependencies: [EVT-11, EVT-15]
references: [PRODUCT.md]
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Dev compose rebuilds from source with dev servers; the original also ships a
`docker-compose.prod.yml` + `Caddyfile` for a single-host deployment.

## Goal

- `apps/api/Dockerfile.prod` — multi-stage: build Nest + prisma generate → slim runtime
  image, `prisma migrate deploy` on start.
- Web production build served as static files by **Caddy** (`Dockerfile.caddy` +
  `Caddyfile`): Caddy terminates TLS (internal CA or real domain), serves the SPA with
  fallback to `index.html`, reverse-proxies `/api/*` and `/storage/*` to the api service.
- `docker-compose.prod.yml`: db (named volume), api (storage volume), caddy (ports
  80/443); restart policies; env via `.env.prod.example` (documented, no secrets).

## Non-goals

- CI/CD deploy pipeline, backups, monitoring, multi-host
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] `docker compose -f docker-compose.prod.yml up --build` on a clean machine serves the app on 443: sign-in gate loads, API + storage proxied through Caddy same-origin
- [ ] SPA hard-refresh on a deep route works (fallback configured)
- [ ] api prod image contains no dev dependencies; migrations run automatically on boot
<!-- AC:END -->
