# Production backups (EVT-33)

Nightly, off-VM, tested. This is the single highest-risk gap the app had: the
Vultr VM's Postgres volume and photo-storage volume were the *only* copies of
the operator's entire workshop inventory — a disk failure, VM loss, or a
fat-fingered `docker volume rm` was irreversible total data loss.

## What runs, where

| Piece | Runs on | Script |
|---|---|---|
| Nightly dump + tar + rotation | the VM, via systemd timer | [`scripts/prod-backup.sh`](../../scripts/prod-backup.sh) |
| Timer install (one-time) | the VM, run once as root | [`scripts/install-backup-timer.sh`](../../scripts/install-backup-timer.sh) |
| Off-VM copy + staleness check | the operator's Mac | [`scripts/fetch-backups.sh`](../../scripts/fetch-backups.sh) |

### On the VM: nightly dump + tar + rotation

`scripts/prod-backup.sh` (installed as a systemd timer, see below) runs once
a night at `/opt/eventory` and produces, into `/opt/eventory/backups/`:

- `eventory-db-<UTC timestamp>.dump` — a `pg_dump --format=custom` of the
  `eventory` database, taken via `docker compose exec db pg_dump …` so the
  dump always uses the **container's own `pg_dump` binary**, version-matched
  to the running `postgres:16` server (a mismatched host-installed
  `pg_dump` can silently produce a dump the same server's `pg_restore`
  rejects).
- `eventory-photos-<UTC timestamp>.tar.gz` — a tar of the
  `eventory-photo-storage` named volume, taken via a throwaway `alpine`
  container mounting the volume read-only (no need to know the volume's
  on-disk path). Uploads in flight during the nightly window are accepted
  for nightly home use — a photo mid-upload may be truncated or missing in
  that night's tar, but the *next* night's backup will have it.
- Both artifacts are written to a `.tmp` path and atomically `mv`'d into
  place, and each is checked non-empty, **before** rotation or the success
  marker run — a failed dump never displaces the last good backup, and never
  produces a fresh-looking success marker.
- **Rotation**: `find … -mtime +N -delete` prunes dumps/tars older than
  `BACKUP_RETENTION_DAYS` (default **14**).
- **Success marker**: `backups/last-success.txt`, an ISO-8601 UTC timestamp,
  written only after both artifacts are confirmed non-empty.

No credentials are embedded in the script — `POSTGRES_USER` / `POSTGRES_DB`
are read from the VM's existing `.env.prod`, and `pg_dump` authenticates
over Postgres's trusted local socket inside the container (same mechanism
`deploy.sh` already uses for its password-sync step) — `POSTGRES_PASSWORD`
is never read or logged.

**Install the timer once**, on the VM, after a normal `./deploy.sh`:

```bash
ssh root@<vm-ip>
cd /opt/eventory
./scripts/install-backup-timer.sh
```

This installs and enables `eventory-backup.timer` (systemd, `OnCalendar=*-*-*
03:15:00`, `Persistent=true` so a missed run — VM was off — catches up on
next boot). Check it:

```bash
systemctl status eventory-backup.timer
journalctl -u eventory-backup.service --since '2 days ago'
systemctl start eventory-backup.service   # run once now, on demand
```

Re-run `install-backup-timer.sh` any time after a `deploy.sh` update to
`scripts/prod-backup.sh` — it's idempotent (rewrites the unit files,
`daemon-reload`s).

### Off the VM: fetch to the operator's Mac

`scripts/fetch-backups.sh` runs on the operator's Mac and:

1. `rsync`s `/opt/eventory/backups/` down to `~/eventory-backups/` over the
   same key-auth SSH `deploy.sh` already uses (no new credentials, no
   object-storage account to manage). This was picked over S3-compatible
   object storage and Vultr snapshots as the simplest reliable mechanism for
   a one-VM home setup: **Vultr automatic snapshots alone are not
   sufficient** (same-provider, whole-VM granularity — a Vultr account
   incident takes out both copies at once), and object storage adds a
   billing account + a second credential to rotate for no benefit at this
   scale. `rsync`-to-Mac is the smallest number of moving parts that still
   gets a genuinely independent, off-provider copy.
2. Prunes its own local mirror on a **longer** window
   (`LOCAL_RETENTION_DAYS`, default **30**) than the VM's rotation, so the
   off-VM copy still has history even after a few missed fetches.
3. Runs `node scripts/backup-lib.mjs freshness ~/eventory-backups 2` (AC5):
   warns and exits non-zero if the newest backup is more than 2 days old —
   this is what should page you, not just a quiet log line. Wire your
   scheduler's failure output to something you'll actually see (launchd
   `StandardErrorPath` + a log-watcher, or a `mail`-piped cron entry).

Run it manually, or schedule it (cron, or a `launchd` agent) on the Mac:

```bash
./scripts/fetch-backups.sh
```

## Restore runbook

Both paths below were exercised for real against throwaway Docker
containers as part of implementing EVT-33 (same `postgres:16` image tag as
`docker-compose.prod.yml`) — commands and output are recorded in the EVT-33
PR. The commands below are exactly what was run, with `/opt/eventory` paths
substituted in for the VM case.

**Learned from that exercise:** a just-started `postgres:16` container can
report `pg_isready` (accepting connections) a moment *before* its
`POSTGRES_DB` database actually exists — `pg_restore -d eventory` fails with
`database "eventory" does not exist` in that narrow window. Always wait for
the compose healthcheck to report **healthy** (`docker compose -f
docker-compose.prod.yml ps` — the `db` service already has a `pg_isready`
healthcheck with `start_period: 10s`, `retries: 10`), not merely for the
container to have started, before restoring.

### Path A — fresh VM (total loss)

Starting point: a brand-new VM, nothing deployed yet, and your latest
backups sitting in `~/eventory-backups/` on your Mac (from `fetch-backups.sh`).

```bash
# 1. Deploy the stack as normal — this provisions Docker, creates the
#    (empty) volumes, and starts db/api/caddy.
./deploy.sh

# 2. Wait for the stack to be healthy (deploy.sh already does this and
#    exits non-zero if it isn't — re-run `docker compose -f
#    docker-compose.prod.yml ps` on the VM to confirm `db` shows healthy).

# 3. From your Mac, copy the backup files up (or SCP them from wherever the
#    off-VM copy lives) and pipe the restore straight into the db container:
scp ~/eventory-backups/eventory-db-<TIMESTAMP>.dump root@<vm-ip>:/tmp/
ssh root@<vm-ip>
cd /opt/eventory
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore -U eventory -d eventory --clean --if-exists < /tmp/eventory-db-<TIMESTAMP>.dump
rm /tmp/eventory-db-<TIMESTAMP>.dump

# 4. Restore photos into the (empty) eventory-photo-storage volume:
scp ~/eventory-backups/eventory-photos-<TIMESTAMP>.tar.gz root@<vm-ip>:/tmp/
ssh root@<vm-ip> '
  docker run --rm -v eventory-photo-storage:/data -v /tmp:/backup \
    alpine sh -c "rm -rf /data/* && tar xzf /backup/eventory-photos-<TIMESTAMP>.tar.gz -C /data" &&
  rm /tmp/eventory-photos-<TIMESTAMP>.tar.gz
'

# 5. Restart api so it picks up the restored data with a clean connection:
ssh root@<vm-ip> 'cd /opt/eventory && docker compose -f docker-compose.prod.yml restart api'

# 6. Verify: open the site, spot-check item counts, or:
ssh root@<vm-ip> 'cd /opt/eventory && docker compose -f docker-compose.prod.yml exec -T db \
  psql -U eventory -d eventory -tAc "SELECT count(*) FROM \"Item\";"'
```

### Path B — database corrupted, VM alive

Starting point: the VM and its containers are up, but the data is wrong
(bad migration, accidental delete, corruption) and you want to roll back to
last night's backup. Uses the backup already sitting in `/opt/eventory/backups/`
on the VM — no network transfer needed.

```bash
ssh root@<vm-ip>
cd /opt/eventory

# 1. Stop api so nothing writes to the db mid-restore:
docker compose -f docker-compose.prod.yml stop api

# 2. Find the backup you want (or use the newest):
ls -la backups/eventory-db-*.dump
TIMESTAMP=<pick one, e.g. 20260820T031500Z>

# 3. Restore (--clean --if-exists: drops+recreates existing objects,
#    --if-exists suppresses noisy-but-harmless "does not exist" errors):
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore -U eventory -d eventory --clean --if-exists < "backups/eventory-db-${TIMESTAMP}.dump"

# 4. Same idea for photos, if that volume is also affected:
docker run --rm -v eventory-photo-storage:/data \
  -v "$(pwd)/backups":/backup:ro \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/eventory-photos-${TIMESTAMP}.tar.gz -C /data"

# 5. Bring api back up and verify:
docker compose -f docker-compose.prod.yml start api
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U eventory -d eventory -tAc "SELECT count(*) FROM \"Item\";"
```

## AC4 evidence — restore exercised for real

Run once, locally, against throwaway `postgres:16` containers + a throwaway
Docker volume (never touched the real VM). Full transcript recorded in the
EVT-33 PR description; summary:

1. Started `evt33-throwaway-db` (`postgres:16`), created a sample `items`
   table with 4 rows.
2. Produced a custom-format dump with the exact `pg_dump … --format=custom`
   invocation `prod-backup.sh` uses (2737 bytes; `file` confirmed
   `PostgreSQL custom database dump - v1.15-0`).
3. Started a second throwaway container (`evt33-throwaway-restore`), empty
   `eventory` database.
4. Restored with the exact `pg_restore -U eventory -d eventory --clean
   --if-exists` command from this runbook — exit 0.
5. Verified: `SELECT count(*) FROM items` → 4, and every row's content
   matched the source exactly.
6. Repeated the same shape for photos: populated a throwaway named volume
   with sample files, tarred it via the exact alpine-container command
   `prod-backup.sh` uses, restored into a second fresh volume via this
   runbook's tar-extract command, and `diff -r`'d source vs restored — `IDENTICAL`.
7. Exercised `node scripts/backup-lib.mjs freshness <dir> 2` against both a
   fresh dump (reported OK, exit 0) and a synthetic 2020-dated filename
   (reported `WARNING: … 2423.0 days old …`, exit 1) — confirms AC5's
   staleness warning fires correctly.
8. Tore down all throwaway containers/volumes/scratch files.

## Known limitations (documented per the task's non-goals)

- **No point-in-time recovery / WAL archiving** — nightly granularity only;
  acceptable for a home workshop's write volume.
- **No encryption at rest** — the dump/tar files are plain (gzip-compressed
  for photos, Postgres's own custom-format compression for the db dump) but
  not encrypted. Follow-up if this becomes a concern: `gpg --encrypt` the
  artifacts before `rsync`, or switch the off-VM leg to an
  already-encrypted-at-rest object store.
- **Photo tar is not point-in-time consistent** with concurrent uploads —
  acceptable for nightly home use (see "On the VM" above).
