---
id: EVT-46
title: 'chore(test): fix pre-existing e2e debt — auth-helper adoption + migration-harness readiness race'
status: To Do
priority: medium
labels:
  - test
  - dx
dependencies: []
references:
  - apps/api/test/projects.e2e-spec.ts
  - apps/api/test/search-by-photo.e2e-spec.ts
  - apps/api/test/e2e-auth-helper.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Two pre-existing main defects make every full e2e run cry wolf (diagnosed
precisely during EVT-42's rebase, 2026-08-21; first observed 2026-08-14):

1. `projects.e2e-spec.ts` and `search-by-photo.e2e-spec.ts` never adopted
   `test/e2e-auth-helper.ts` after `JwtAuthGuard` went global — 15 tests fail
   with 401s on every full run. CI never notices because Build & Test runs
   unit tests only, so this debt is invisible until someone runs e2e locally
   and burns time re-diagnosing (has happened in at least four pipeline runs).
2. `workspace-migration.e2e-spec.ts`'s `waitForPostgres` uses docker-exec
   `pg_isready`, which succeeds over the unix socket during postgres:16's
   initdb temporary-server phase BEFORE TCP is listening — `client.connect()`
   then dies with "Connection terminated unexpectedly" in beforeAll.
   Intermittent, load-dependent.

## Goal

- Port both 401-failing specs to the `AuthedHttp`/auth-helper pattern the
  other e2e suites use (mechanical; items/photos specs are the template)
- Replace the migration harness's readiness probe with a TCP-level check
  against the mapped port (retry `client.connect()` itself, or poll the TCP
  socket) so initdb's socket-only phase can't fake readiness
- Full `apps/api` e2e suite passes locally N=3 consecutive runs (the flake
  bar), evidence in the PR

3. `scripts/fetch-backups.sh` fails on macOS: Apple's BSD rsync 2.6.9 rejects
   the GNU-style `--chmod=F600,D700` argument (found 2026-08-21 during the
   first real off-VM fetch; worked around with scp + chmod). Fix: portable
   invocation (separate `--chmod` flags, detect rsync flavor, or plain
   scp + chmod fallback), plus a spec in the backup-lib tests.

4. **The prod VM is Alpine Linux, not Ubuntu** (discovered 2026-08-21 installing
   the backup timer): `install-backup-timer.sh` assumes systemd (`/etc/systemd/
   system` does not exist; init is BusyBox) and deploy.sh's ufw section has
   been silently no-opping since day one (`command -v ufw` guard). The nightly
   backup was installed manually via Alpine crond (`/etc/crontabs/root`,
   03:15 daily, log at /var/log/eventory-backup.log) — port exposure is still
   correct (prod compose publishes only caddy 80/443). Fix: make
   install-backup-timer.sh detect init system (systemd unit OR crontab entry),
   and either make deploy.sh's firewall section Alpine-aware (iptables/nftables)
   or delete it with a comment stating the compose port model is the boundary.

## Non-goals

- Adding e2e to CI's required checks (separate decision — note it in the PR
  as a suggestion)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Both specs use the shared auth helper; the 15 401-failures are gone
- [ ] Readiness probe is TCP-level; the initdb race is closed (comment explains why unix-socket pg_isready lies)
- [ ] Three consecutive clean full e2e runs, evidence in PR
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
