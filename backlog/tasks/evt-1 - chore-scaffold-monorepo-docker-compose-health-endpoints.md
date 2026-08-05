---
id: EVT-1
title: 'chore(scaffold): monorepo skeleton — web + api + db via Docker Compose, health endpoints green'
status: In Progress
labels:
  - scaffold
  - infrastructure
dependencies: []
references:
  - PRODUCT.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The repository is empty except for framework config and the product brief. Nothing can
be built, run, or reviewed until the three-service skeleton exists.

## Goal

Stand up the target architecture from PRODUCT.md as a running skeleton:

- npm workspaces root (`apps/web`, `apps/api`)
- `apps/api`: NestJS 10 + Prisma 5, Postgres datasource, `/api/health` returning
  `{ status: 'ok', db: true }` (checks a real DB round-trip)
- `apps/web`: Vite + React 18 + MUI 6 + TanStack Query, single page that calls
  `/api/health` and renders the result
- `db`: Postgres 16 with `pg_trgm` + `uuid-ossp` extensions enabled via init script
- `docker-compose.yml` wiring all three; API runs `prisma migrate deploy` on start
- Root scripts: `dev` (compose up --build), `down`, `logs`, `psql`

## Non-goals

- Any domain model beyond an empty Prisma schema + first migration
- Auth, HTTPS/mkcert (separate task — needs operator's cert setup)
- CI workflows beyond what ai-sdlc init already scaffolded

## Risk

- Prisma migrate on container start races the DB being ready — use a healthcheck +
  `depends_on: condition: service_healthy`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] `docker compose up --build` from a clean checkout brings up db, api, web with no errors
- [ ] `curl http://localhost:3001/api/health` returns `{"status":"ok","db":true}`
- [ ] Web page at `http://localhost:5173` renders the health status fetched from the API
- [ ] `SELECT * FROM pg_extension` shows `pg_trgm` and `uuid-ossp`
- [ ] Fresh clone + compose up requires no manual migration step
<!-- AC:END -->
