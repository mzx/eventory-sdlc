---
id: EVT-21
title: 'bug(dx): dev docker compose serves stale code silently — bind-mount source for live dev'
status: Done
priority: medium
created_date: '2026-08-07 19:20'
updated_date: '2026-08-07 19:42'
assignee: []
labels:
  - bug
  - infrastructure
  - dx
dependencies: []
references:
  - 'https://github.com/mzx/eventory-sdlc/issues/21'
  - docker-compose.yml
---

## Problem

The dev `docker-compose.yml` bakes the source tree into the api/web images (no source bind mounts), while running dev servers inside the containers. `git pull` + `docker compose up` therefore serves old code with zero warning — the stack boots healthy but features merged since the last `--build` don't exist. Hit in real usage 2026-08-07: after 5 merges the running app had no login page; diagnosis required comparing `docker images` timestamps with merge times.

Full reproduction: GitHub issue #21.

## Acceptance Criteria

- [x] AC1: `docker compose up` in dev reflects local source changes without a manual image rebuild — e.g. bind-mount `apps/` + root manifests with a named/anonymous volume for `node_modules`, or `compose watch`. Vite HMR and Nest watch-restart must work through it.
- [x] AC2: Dependency changes handled: when `pnpm-lock.yaml` changes, the setup reinstalls automatically or fails loudly with a clear message.
- [x] AC3: The production compose path (`docker-compose.prod.*`, EVT-19) is untouched — baked images remain correct there.
- [x] AC4: README quickstart documents the dev flow and when a rebuild is still required (Dockerfile/base-image changes); removes any implication that plain `up` picks up new code.
- [x] AC5: api/web healthchecks keep working with the mounted-source setup; CI unaffected.

## PR requirement

The PR body MUST include `Closes #21`.

## Final Summary

## Summary
Fixed dev docker-compose.yml so `docker compose up` serves live source: api/web containers now bind-mount `apps/` + root manifests and run the real dev servers (`nest start --watch`, `vite --host 0.0.0.0`) instead of baked/dist artifacts, with `node_modules` kept on named volumes so the container's pnpm-installed tree (native bindings, generated Prisma client) is never shadowed by the host directory. Each container auto-reinstalls when `pnpm-lock.yaml` changes and fails loudly if the install fails; `docker-compose.prod.yml` is untouched; README documents the new flow and when a rebuild is still required.

## Changes
- `docker-compose.yml` — bind-mount source + named node_modules volumes; lockfile-hash reinstall-or-fail-loudly entrypoints; dev servers run in watch mode
- `README.md` — dev quickstart documents live-reload flow and when a rebuild is still required

## Design decisions
- `target: build` for the api image so the generated Prisma client + devDependencies (@nestjs/cli) seed the named volume
- Lockfile-hash stamp file (`.pnpm-lock.sha256`) in the volume drives skip/reinstall decisions; `pnpm install --frozen-lockfile` at container start on change
- Live-verified: nest watch-restart and Vite HMR through the bind mounts; api healthcheck healthy; reinstall skipped on unchanged lockfile

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code); 0 critical, 0 major, 4 minor, 5 suggestions

## Follow-up
- Reviewer suggestions (non-blocking): narrow the web service's bind mount from `./apps` to `./apps/web`; consider running `prisma migrate deploy` before `start:dev` in the dev api command; consider `docker compose config -q` validation in CI; healthcheck grace window may be exceeded by a long dependency reinstall; lockfile-failure path crash-loops under `restart: unless-stopped`.
