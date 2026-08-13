---
id: EVT-32
title: 'fix(dx): dev compose — run prisma generate + migrate deploy on api start so schema merges just work'
status: To Do
priority: medium
created_date: '2026-08-13 09:01'
updated_date: '2026-08-13 09:01'
assignee: []
labels:
  - dx
  - infrastructure
  - api
  - bug
dependencies: []
references:
  - docker-compose.yml
  - apps/api/prisma/schema.prisma
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Pulling a schema-touching merge silently breaks the local dev stack. Observed on
2026-08-13 after EVT-25 (#36) merged: `docker compose up -d --build` brought the
api container up with (a) a **stale generated Prisma client** — the source is
bind-mounted (EVT-21) but `node_modules` lives in a container volume, so the
TypeScript watcher failed on the new `stockMovement` model — and (b) an
**unmigrated database**: `_prisma_migrations` was two migrations behind
(`20260807120000_google_id_nullable` from EVT-20 and
`20260812190000_add_stock_movement` were both unapplied), proving the dev
entrypoint has not run `prisma migrate deploy` on start for at least a week.
EVT-1's design explicitly said "API runs `prisma migrate deploy` on start."
Both had to be fixed by hand (`docker compose exec api npx prisma generate` +
`npx prisma migrate deploy`). This is the same failure class as EVT-21
("dev compose serves stale code silently").

## Goal

Make the api dev container self-healing on schema changes:

- The api service's dev startup sequence runs, in order, BEFORE the watch
  server: `prisma generate` → `prisma migrate deploy` → dev server
- Both steps log clearly (one line each on success; loud failure that keeps the
  container in a visibly broken state rather than half-running)
- Idempotent and fast when nothing changed (generate on an unchanged schema and
  deploy with no pending migrations should add only a few seconds)
- README dev section documents the behavior (and the manual escape hatches)

## Non-goals

- Production compose changes (EVT-19's prod flow is separate; do not touch
  `docker-compose.prod.yml` behavior beyond confirming it is unaffected)
- Database seeding, `prisma migrate dev` (deploy only — dev containers must
  never create migrations)
- Rebuilding the node_modules volume strategy from EVT-21

## Risk

- Migrate deploy racing DB readiness — already mitigated by the existing
  `depends_on: condition: service_healthy`; keep it that way.
- A failed migration must not leave the container "Up (healthy)" while the app
  is broken — the healthcheck must fail if the startup sequence failed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Reproduce-then-fix: starting from a stack built on an older schema, `git pull` + `docker compose up -d --build` (no manual steps) brings api to healthy with the regenerated client and all migrations applied
- [ ] `docker compose exec api npx prisma migrate status` reports no pending migrations immediately after container start
- [ ] Startup logs show the generate and deploy steps distinctly, with success/failure visible in `docker compose logs api`
- [ ] A failed migrate deploy leaves the container unhealthy (healthcheck fails), not silently half-running
- [ ] A no-op restart (unchanged schema, no pending migrations) adds no more than a few seconds to api startup
- [ ] README dev section documents the auto-generate/auto-migrate behavior
- [ ] The startup script/entrypoint change is covered by a test or CI smoke check where feasible (e.g. shell-script lint + a compose-level check), per repo test requirements
<!-- AC:END -->
