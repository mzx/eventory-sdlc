---
id: EVT-19
title: 'chore(infra): production compose — multi-stage builds + Caddy reverse proxy'
status: Done
labels: [infrastructure, deploy]
dependencies: [EVT-11, EVT-15]
references: [PRODUCT.md]
priority: low
updated_date: '2026-08-07 09:33'
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
- [x] `docker compose -f docker-compose.prod.yml up --build` on a clean machine serves the app on 443: sign-in gate loads, API + storage proxied through Caddy same-origin
- [x] SPA hard-refresh on a deep route works (fallback configured)
- [x] api prod image contains no dev dependencies; migrations run automatically on boot
<!-- AC:END -->

## Final Summary

## Summary
Added a single-host production deployment path: multi-stage `apps/api/Dockerfile.prod` (slim `--prod`-only runtime with `prisma migrate deploy` on boot), `apps/web/Dockerfile.caddy` + `Caddyfile` serving the built SPA via Caddy with TLS termination and same-origin `/api` + `/storage` reverse proxy, `docker-compose.prod.yml` wiring db/api/caddy, and `.env.prod.example`. Security review round 2 hardened it: empty secret placeholders + extended `resolveJwtSecret` reject-list, Express trust-proxy config so per-IP throttling works behind Caddy, non-root API container user, env-driven TLS mode + baseline security headers, tightened `.dockerignore`, and NODE_ENV-gated CORS dev origins.

## Changes
- `apps/api/Dockerfile.prod` — multi-stage build → slim non-root runtime, migrations on boot
- `apps/web/Dockerfile.caddy`, `Caddyfile` — Caddy static SPA + TLS + `/api` + `/storage` proxy, security headers, env-driven TLS mode
- `docker-compose.prod.yml` — db (named volume), api (storage volume), caddy (80/443), restart policies, fail-fast env guards
- `.env.prod.example`, `.dockerignore`, `.gitignore` — documented env (no secrets, empty secret placeholders), build-context hardening
- `apps/api/package.json` + `pnpm-lock.yaml` — `prisma` moved to dependencies so `migrate deploy` survives `--prod` install
- `apps/api/src/auth/auth.service.ts` (+spec) — reject-list covers documented placeholder secrets in production
- `apps/api/src/common/trust-proxy.config.ts` (+spec), `main.ts` — `trust proxy: 1` behind Caddy
- `apps/api/src/common/cors.config.ts` (+spec) — dev origins gated on NODE_ENV

## Design decisions
- `prisma` moved from devDependencies to dependencies: `prisma migrate deploy` must run at container boot while AC3 forbids dev deps in the runtime image — standard Prisma production pattern.
- `trust proxy = 1` (numeric hop count): safe for the prod topology (api publishes no host port; Caddy is the only ingress) and verified against both Caddy ≥2.7 overwrite and older append X-Forwarded-For semantics.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- Docker end-to-end (both rounds): `docker compose -f docker-compose.prod.yml up --build` healthy; SPA on 443, deep-route hard-refresh serves index.html, `/api` + `/storage` proxied same-origin, HTTP→HTTPS redirect, 4 Prisma migrations auto-applied, no devDependencies in runtime image, non-root uid 1000 writes to storage volume; stack torn down cleanly.
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

## Follow-up
- (suggestions from review, non-blocking): env-gate trust-proxy hops for the unproxied dev compose topology; gate HSTS off the `TLS_MODE=internal` default; add edge `X-Content-Type-Options: nosniff` + fuller CSP; note URL-safe-characters requirement for `POSTGRES_PASSWORD` in `DATABASE_URL`; least-privilege runtime DB role.
