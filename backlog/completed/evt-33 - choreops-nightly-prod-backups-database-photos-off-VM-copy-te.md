---
id: EVT-33
title: 'chore(ops): nightly prod backups — database + photos, off-VM copy, tested restore'
status: Done
priority: high
created_date: '2026-08-13 16:56'
updated_date: '2026-08-20 00:36'
assignee: []
labels:
  - ops
  - infrastructure
  - data-safety
dependencies: []
references:
  - deploy.sh
  - docker-compose.prod.yml
  - .env.prod.example
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The production VM (Vultr, single host, `/opt/eventory`) has NO backup story. The
Postgres volume and the photo-storage volume are the only copies of the operator's
entire workshop inventory. A disk failure, VM loss, or a fat-fingered
`docker volume rm` is irreversible total data loss. This is the single biggest
risk blocking day-to-day trust in the app (risk assessment, 2026-08-13) — every
other known issue is an inconvenience; this one is unrecoverable.

## Goal

Automated nightly backups with at least one copy OFF the VM, and a restore
procedure that has been executed once for real:

- On the VM (cron or systemd timer): nightly `pg_dump` (custom format) of the
  eventory database + tar of the photo-storage volume, into a backups directory
  with N-day rotation (default 14)
- Off-VM copy — pick the simplest reliable mechanism and document the choice:
  pull-based fetch to the operator's Mac (launchd + rsync/scp over the existing
  key-auth SSH), push to object storage (e.g. Vultr Object Storage / S3-compatible
  with lifecycle rules), or Vultr automatic snapshots as a supplement
  (snapshots alone are NOT sufficient — same-provider, whole-VM granularity)
- Restore runbook in docs/ (or README ops section): exact commands from
  "fresh VM" and from "corrupted db, VM alive" starting points
- The restore MUST be exercised once against a throwaway target (local container
  or scratch dir) as part of this task — an untested backup is not a backup
- Backup failure must be observable: at minimum, a timestamped success marker
  file the operator can check (and the fetch job should warn when the newest
  backup is older than 2 days)

## Non-goals

- Point-in-time recovery / WAL archiving (nightly granularity is fine for a
  home workshop)
- Encrypted-at-rest backups (nice-to-have; document as follow-up if skipped)
- Backing up the dev stack

## Risk

- `pg_dump` against the running container must use the container's own
  `pg_dump` binary (version match) via `docker compose exec`
- Photo tar while uploads are in flight: acceptable for nightly home use;
  note it in the runbook
- Do NOT store credentials in the backup scripts — reuse `.env.prod` on the VM
  and existing SSH key auth for the fetch
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Nightly job on the VM produces `pg_dump` (custom format) + photos archive with rotation (default 14 days), driven by cron or a systemd timer installed by a committed script
- [x] At least one off-VM copy mechanism is implemented and documented (fetch-to-Mac, object storage, or equivalent), with credentials/keys reused — none embedded in scripts
- [x] Restore runbook exists covering both "fresh VM" and "db corrupted, VM alive" paths with exact commands
- [x] A restore was actually executed once against a throwaway target and the runbook corrected from what was learned; evidence (commands + output summary) recorded in the PR
- [x] Backup failure is observable: success marker with timestamp, and the off-VM fetch warns when the newest backup is older than 2 days
- [x] Scripts pass the repo's verification gates (`pnpm verify` — the root test script picks up `scripts/*.test.mjs`; shell scripts get at least `bash -n` / shellcheck-clean noted in the PR)
<!-- AC:END -->

## Final Summary

## Summary
Nightly prod backups: on-VM cron producing `pg_dump` (custom format) + photo-volume tar with 14-day rotation and a timestamped success marker; pull-based off-VM fetch to the operator's Mac over existing SSH key auth with a stale-backup (>2 days) warning; restore runbook (`docs/operations/backups.md`) covering fresh-VM and db-corrupted paths — restore exercised for real against a throwaway target per AC.

## Review history
- Session: 2 rounds; iteration cap reached with 1 unresolved MAJOR — the restore/migration runbook copied into the photo volume while the live api could still write (write-skew data loss). Session correctly kept the PR draft (ready = unattended auto-merge of a flagged PR)
- Operator-directed fix (4830729): api quiesced (`docker compose stop api`) before every copy/restore-into across all three flows, restart-with-health-verify after, nightly-tar read-tradeoff explicitly distinguished and unchanged. Focused re-review ✅ (1 cosmetic suggestion)

## Verification
- `pnpm verify` green at final head; restore evidence in PR
- ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable)

## Follow-up / OPS SEQUENCING (critical)
- **Before the first deploy that includes EVT-39's whole-table tenancy migration: run the backup once on the VM and verify artifacts + off-VM copy.** deploy.sh ships whole-HEAD and the migration runs on api start — the backup must exist first
- Cosmetic: renumber Path A's pg_restore step in the runbook
