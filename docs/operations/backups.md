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
a night at `/opt/eventory` and produces, into `/var/backups/eventory/`
(deliberately **outside** `/opt/eventory` — see "Why BACKUP_DIR lives outside
the deploy tree" below):

- `eventory-db-<UTC timestamp>.dump` — a `pg_dump --format=custom` of the
  `eventory` database, taken via `docker compose exec db pg_dump …` so the
  dump always uses the **container's own `pg_dump` binary**, version-matched
  to the running `postgres:16` server (a mismatched host-installed
  `pg_dump` can silently produce a dump the same server's `pg_restore`
  rejects).
- `eventory-photos-<UTC timestamp>.tar.gz` — a tar of the
  `eventory-photo-storage` named volume, taken via a throwaway `postgres:16`
  container (already pinned, already vetted as the `db` service's own image,
  ships `tar`/`gzip` — no separate unpinned `alpine:latest` running as root
  nightly) mounting the volume read-only (no need to know the volume's
  on-disk path). Uploads in flight during the nightly window are accepted
  for nightly home use — a photo mid-upload may be truncated or missing in
  that night's tar, but the *next* night's backup will have it.
- Both artifacts are written to a `.tmp` path and checked non-empty **before**
  the atomic `mv` into their final name, and before rotation or the success
  marker run — a failed/empty dump never displaces the last good backup
  under its final name, is never synced by `fetch-backups.sh`, and never
  produces a fresh-looking success marker.
- **Permissions**: the script runs under `umask 077`, `BACKUP_DIR` is
  `chmod 700`, and every artifact (dump, tar, `last-success.txt`) ends up
  `chmod 600` — the DB dump contains every user's email + OAuth id and the
  photo tar is the operator's full inventory; nothing here should be
  world-readable to any other local account on the VM. The photo tar is
  produced *inside* a container process, whose own umask the host's `umask
  077` cannot reach, so `umask 077` is set explicitly inside that container's
  command too.
- **Rotation**: `find … -mtime +N -delete` prunes dumps/tars older than
  `BACKUP_RETENTION_DAYS` (default **14**).
- **Success marker**: `backups/last-success.txt`, an ISO-8601 UTC timestamp,
  written only after both artifacts are confirmed non-empty.

No credentials are embedded in the script, and none are sourced into its
process environment either — `POSTGRES_USER` / `POSTGRES_DB` are pulled from
the VM's existing `.env.prod` with a targeted `grep`, not by sourcing the
whole file (which would otherwise export `POSTGRES_PASSWORD`, `JWT_SECRET`,
`GOOGLE_CLIENT_SECRET`, etc. into this process for no reason). `pg_dump`
authenticates over Postgres's trusted local socket inside the container
(same mechanism `deploy.sh` already uses for its password-sync step) —
`POSTGRES_PASSWORD` is never read or logged.

### Why BACKUP_DIR lives outside the deploy tree

`deploy.sh`'s on-VM clean-tree step
(`find . -mindepth 1 -maxdepth 1 ! -name .env.prod ! -name eventory.tar.gz
-exec rm -rf {} +`) deletes **everything** under `/opt/eventory` on every
`./deploy.sh` run, to make sure files removed from the repo don't linger and
poison the Docker build. If `BACKUP_DIR` lived under `/opt/eventory` (e.g.
the original `/opt/eventory/backups`), every deploy would silently delete
the entire on-VM backup history — precisely in the post-deploy window a
restore is most likely to be needed, and with no local signal that it
happened (the Mac-side `fetch-backups.sh` staleness check only notices once
the *next* fetch runs, and even then only if a fetch has never yet
completed since).

The fix is to default `BACKUP_DIR` to `/var/backups/eventory`, entirely
outside anything `deploy.sh` touches — the primary defense against this
class of bug. `scripts/fetch-backups.sh`'s `REMOTE_BACKUP_DIR` default was
updated to match.

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

1. `rsync`s `/var/backups/eventory/` down to `~/eventory-backups/` over the
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

## One-time volume migration (existing VM only)

`docker-compose.prod.yml`'s `eventory-photo-storage` volume now has an
explicit `name: eventory-photo-storage` (EVT-33 review round 2, finding 1):
without it, Compose names the actual on-disk volume
`<project>_eventory-photo-storage` (project = the basename of `APP_DIR`,
i.e. `eventory` for `/opt/eventory`), but `scripts/prod-backup.sh` and this
runbook's restore commands both reach the volume via a bare
`docker run -v eventory-photo-storage:...` — a command that has no idea
about Compose's project prefixing. Without the pin, that `docker run` would
silently create and tar a brand-new **empty** volume literally named
`eventory-photo-storage` every night — every nightly photos backup would
contain zero real photos, while still reporting success (a non-empty tar of
an empty directory still passes the `[[ -s ]]` check).

**If you have already deployed before this fix**, your real photos live in
the *old* prefixed volume (`eventory_eventory-photo-storage`), and pinning
the name in compose means the *next* `./deploy.sh` will look for (and, if
missing, silently create empty) the unprefixed `eventory-photo-storage`
volume instead. Run this **once**, on the VM, **before** your next
`./deploy.sh`, to copy the data across to the name Compose will use going
forward:

```bash
ssh root@<vm-ip>
# 1. Confirm the old volume exists and has the data you expect:
docker volume ls | grep eventory-photo-storage
docker run --rm -v eventory_eventory-photo-storage:/data:ro alpine sh -c 'ls /data | wc -l'

# 2. Create the new pinned-name volume and copy everything across:
docker volume create eventory-photo-storage
docker run --rm \
  -v eventory_eventory-photo-storage:/from:ro \
  -v eventory-photo-storage:/to \
  alpine sh -c 'cp -a /from/. /to/'

# 3. Verify the copy is complete and byte-identical:
docker run --rm \
  -v eventory_eventory-photo-storage:/from:ro \
  -v eventory-photo-storage:/to:ro \
  alpine sh -c 'diff -rq /from /to && echo IDENTICAL'

# 4. Only after step 3 prints IDENTICAL, proceed with the normal
#    ./deploy.sh — Compose will now attach the already-populated
#    eventory-photo-storage volume (it won't recreate it; Docker volumes
#    are created only if the name doesn't already exist). Leave the old
#    eventory_eventory-photo-storage volume in place for a few days as a
#    safety net before removing it manually.
```

If this is a **fresh** VM with nothing deployed yet, skip this section
entirely — `./deploy.sh` will create `eventory-photo-storage` under its
pinned name from the start, with nothing to migrate.

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
#    off-VM copy lives) into a 0700 staging dir on the VM — NOT /tmp, which
#    is world-readable and these files contain every user's email/OAuth id:
ssh root@<vm-ip> 'mkdir -p -m 700 /root/eventory-restore'
scp ~/eventory-backups/eventory-db-<TIMESTAMP>.dump root@<vm-ip>:/root/eventory-restore/
ssh root@<vm-ip>
cd /opt/eventory
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore -U eventory -d eventory --clean --if-exists < /root/eventory-restore/eventory-db-<TIMESTAMP>.dump
rm /root/eventory-restore/eventory-db-<TIMESTAMP>.dump

# 4. Restore photos into the (empty) eventory-photo-storage volume. Verify
#    the archive with `tar tzf` BEFORE `rm -rf`-ing the target — an empty or
#    corrupt TIMESTAMP/archive must never wipe the only copy of the data
#    without extracting first:
scp ~/eventory-backups/eventory-photos-<TIMESTAMP>.tar.gz root@<vm-ip>:/root/eventory-restore/
ssh root@<vm-ip> '
  TIMESTAMP=<TIMESTAMP>
  [ -n "$TIMESTAMP" ] || { echo "ERROR: TIMESTAMP not set" >&2; exit 1; }
  ARCHIVE="/root/eventory-restore/eventory-photos-${TIMESTAMP}.tar.gz"
  [ -s "$ARCHIVE" ] || { echo "ERROR: $ARCHIVE missing or empty" >&2; exit 1; }
  docker run --rm -v "$ARCHIVE":/backup.tar.gz:ro postgres:16 tar tzf /backup.tar.gz >/dev/null ||
    { echo "ERROR: $ARCHIVE failed tar integrity check — not touching the volume" >&2; exit 1; }
  docker run --rm -v eventory-photo-storage:/data -v "$ARCHIVE":/backup.tar.gz:ro \
    postgres:16 sh -c "rm -rf /data/* && tar xzf /backup.tar.gz -C /data" &&
  rm "$ARCHIVE"
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
last night's backup. Uses the backup already sitting in `/var/backups/eventory/`
on the VM — no network transfer needed.

```bash
ssh root@<vm-ip>
cd /opt/eventory

# 1. Stop api so nothing writes to the db mid-restore:
docker compose -f docker-compose.prod.yml stop api

# 2. Find the backup you want (or use the newest). Backups live in
#    BACKUP_DIR (default /var/backups/eventory — see "Why BACKUP_DIR lives
#    outside the deploy tree" above), NOT under /opt/eventory:
ls -la /var/backups/eventory/eventory-db-*.dump
TIMESTAMP=<pick one, e.g. 20260820T031500Z>
[ -n "$TIMESTAMP" ] || { echo "ERROR: TIMESTAMP not set" >&2; exit 1; }

# 3. Restore (--clean --if-exists: drops+recreates existing objects,
#    --if-exists suppresses noisy-but-harmless "does not exist" errors):
DUMP="/var/backups/eventory/eventory-db-${TIMESTAMP}.dump"
[ -s "$DUMP" ] || { echo "ERROR: $DUMP missing or empty" >&2; exit 1; }
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T db \
  pg_restore -U eventory -d eventory --clean --if-exists < "$DUMP"

# 4. Same idea for photos, if that volume is also affected. Verify the
#    archive with `tar tzf` BEFORE `rm -rf`-ing the target — an empty or
#    corrupt TIMESTAMP/archive must never wipe the only copy of the data
#    without extracting first:
ARCHIVE="/var/backups/eventory/eventory-photos-${TIMESTAMP}.tar.gz"
[ -s "$ARCHIVE" ] || { echo "ERROR: $ARCHIVE missing or empty" >&2; exit 1; }
docker run --rm -v "$ARCHIVE":/backup.tar.gz:ro postgres:16 tar tzf /backup.tar.gz >/dev/null ||
  { echo "ERROR: $ARCHIVE failed tar integrity check — not touching the volume" >&2; exit 1; }
docker run --rm -v eventory-photo-storage:/data -v "$ARCHIVE":/backup.tar.gz:ro \
  postgres:16 sh -c "rm -rf /data/* && tar xzf /backup.tar.gz -C /data"

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
   with sample files, tarred it via the exact `postgres:16`-container
   command `prod-backup.sh` uses (including the `umask 077` set inside the
   container and the positional-arg archive name), restored into a second
   fresh volume via this runbook's tar-extract command, and `diff -r`'d
   source vs restored — `IDENTICAL`.
7. Exercised `node scripts/backup-lib.mjs freshness <dir> 2` against both a
   fresh dump (reported OK, exit 0) and a synthetic 2020-dated filename
   (reported `WARNING: … 2423.0 days old …`, exit 1) — confirms AC5's
   staleness warning fires correctly.
8. Tore down all throwaway containers/volumes/scratch files.

**Round-2 re-verification (review findings 1-8):** re-exercised after the
volume-name-pinning + permissions-hardening + image-pinning fixes above,
against throwaway resources only:
- Simulated the existing-VM scenario: created a volume under the *old*
  Compose-prefixed name (`eventory_eventory-photo-storage`) with sample
  files, then ran exactly the "One-time volume migration" commands above
  (`docker volume create` + `cp -a` copy + `diff -rq`) — reported
  `IDENTICAL`, confirming the migration path is correct.
- Ran the updated `prod-backup.sh` photos step (`postgres:16`, `umask 077`
  inside the container, non-empty check on the `.tmp` file before `mv`)
  against the newly-named `eventory-photo-storage` volume, confirmed the
  resulting `.tar.gz` is `0600`, and confirmed a throwaway restore via this
  runbook's updated tar-extract command (including the `tar tzf` integrity
  check) round-trips byte-identical (`diff -r` → `IDENTICAL`).
- Confirmed `chmod 700`/`chmod 600` land as expected on `BACKUP_DIR` and
  both artifacts when the script is run with a scratch `BACKUP_DIR`.
- Re-ran the full DB dump/restore round trip (fresh `postgres:16` seed
  container → `.tmp`-file-non-empty-then-`mv` dump → second throwaway
  `postgres:16` container → `pg_restore`) end to end: 4 seeded rows,
  restored row count and content matched exactly.
- Confirmed `. "$ENV_FILE"`'s replacement (`grep`-only extraction of
  `POSTGRES_USER`/`POSTGRES_DB`) still resolves both values correctly
  against a sample `.env.prod`-shaped file containing other secret keys,
  and that those other keys are absent from the script's exported
  environment.
- Confirmed `node scripts/backup-lib.mjs freshness <dir> <garbage>` now
  exits 2 with a usage error instead of silently defaulting to "not stale"
  (finding 10).

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
