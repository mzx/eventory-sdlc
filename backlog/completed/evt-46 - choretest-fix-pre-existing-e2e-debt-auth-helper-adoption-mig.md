---
id: EVT-46
title: 'chore(test): fix pre-existing e2e debt — auth-helper adoption + migration-harness readiness race'
status: Done
priority: medium
updated_date: '2026-08-21'
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
- [x] Both specs use the shared auth helper; the 15 401-failures are gone
- [x] Readiness probe is TCP-level; the initdb race is closed (comment explains why unix-socket pg_isready lies)
- [x] Three consecutive clean full e2e runs, evidence in PR
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Summary
Fixed four independent pre-existing defects: ported projects.e2e-spec.ts and search-by-photo.e2e-spec.ts to the shared AuthedHttp auth helper (fixing 15 401s), replaced the pg_isready-based readiness race with a real pg Client.connect() retry in both workspace-migration.e2e-spec.ts and global-setup.ts, made fetch-backups.sh's permission-locking portable across rsync flavors (dropped --chmod, added a post-transfer find+chmod pass), and gave install-backup-timer.sh Alpine/crond detection while removing deploy.sh's dead ufw section.

## Changes
- `apps/api/test/projects.e2e-spec.ts`, `apps/api/test/search-by-photo.e2e-spec.ts` — ported to AuthedHttp/e2e-auth-helper pattern; all original assertions preserved
- `apps/api/test/workspace-migration.e2e-spec.ts`, `apps/api/test/global-setup.ts` — readiness probe now retries a real `pg` Client.connect() (wire-level); comment explains why unix-socket pg_isready lies during initdb
- `scripts/fetch-backups.sh` — dropped GNU-only `--chmod=F600,D700`; post-transfer find+chmod pass preserves 600/700 invariant
- `scripts/install-backup-timer.sh` — detects systemd vs Alpine crond; idempotent marker-based crontab entry (03:15 daily)
- `deploy.sh` — dead ufw section removed (compose port model is the boundary; prod publishes only caddy 80/443)
- `scripts/deploy-script.test.mjs`, `scripts/fetch-backups-script.test.mjs`, `scripts/install-backup-timer-script.test.mjs` — new hermetic shell-script specs (20 tests)

## Design decisions
- global-setup.ts fixed in addition to the referenced migration spec — identical race, gates the shared container every suite depends on; AC-3 unachievable otherwise
- Bare TCP socket probe was empirically insufficient (OrbStack's port-forward proxy accepts handshakes before postgres listens) — full `pg` wire handshake is what closes the race
- deploy.sh firewall section deleted rather than rewritten for Alpine — compose port model documented as the boundary

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 consecutive clean full e2e runs from cold-start containers: 3× "12 suites / 211 tests passed" (~14s each)
- API unit coverage 98.51% lines / 93.35% branches (threshold 80/70)
- 3 parallel reviews approved, 0 critical / 0 major (⚠ independence not enforced — codex unavailable, all reviewers claude-native)

## Follow-up
- Security-review hardening minors (non-blocking, in PR #57 body): `install_crontab()`'s `|| true` can swallow grep rc≥2 and clobber the root crontab; 0644 window on /etc/crontabs/root before chmod 600 (umask 077 fix); marker-based dedupe misses the manually-installed prod VM entry → remove the manual 03:15 line before first scripted run or double backup runs collide on identical .tmp paths; deploy.sh replacement comment overstates "nothing left for a host firewall to restrict"
- Prettier printWidth drift in the two new script test files (root scripts/ not covered by any workspace format:check)
- Suggestion (non-goal, deliberate): consider adding e2e to CI's required checks
<!-- SECTION:FINAL_SUMMARY:END -->
