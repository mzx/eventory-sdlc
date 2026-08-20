#!/usr/bin/env bash
# prod-backup.sh — nightly production backup: Postgres (custom-format
# pg_dump) + photo-storage volume (tar), with N-day rotation and a
# timestamped success marker (EVT-33).
#
# Runs ON THE VM ONLY (targets Linux/GNU userland: `find -mtime`, `date -u`,
# `docker`). Installed as a systemd timer by scripts/install-backup-timer.sh
# — see docs/operations/backups.md for the full runbook (including restore).
#
# Usage (from /opt/eventory, the deploy.sh APP_DIR):
#   ./scripts/prod-backup.sh
#
# Env overrides (all optional):
#   APP_DIR                 default: /opt/eventory
#   BACKUP_DIR               default: /var/backups/eventory — deliberately
#                             OUTSIDE the deploy.sh APP_DIR tree: deploy.sh's
#                             clean-tree step (`find . -mindepth 1 -maxdepth 1
#                             ! -name .env.prod ! -name eventory.tar.gz -exec
#                             rm -rf {} +`) wipes everything under APP_DIR on
#                             every deploy, which would otherwise silently
#                             delete the entire on-VM backup history exactly
#                             in the post-deploy window a restore is most
#                             likely needed (EVT-33 review round 2, finding 4).
#   BACKUP_RETENTION_DAYS    default: 14
#
# Reuses .env.prod (already on the VM from deploy.sh) for POSTGRES_USER /
# POSTGRES_DB only — pulled via `grep` rather than sourcing the whole file,
# so POSTGRES_PASSWORD / JWT_SECRET / GOOGLE_CLIENT_SECRET / etc. are never
# read into this process's environment at all (EVT-33 review round 2,
# finding 7). pg_dump runs inside the db container via `docker compose exec`,
# authenticating over Postgres's trusted local socket, exactly like the
# password-sync step in deploy.sh. No credentials are read, embedded, or
# logged by this script.
set -euo pipefail

# Backups contain the full DB (user emails, OAuth ids) and every uploaded
# photo — default to owner-only permissions for everything this script
# creates. The postgres:16 container used for the photo tar has its own
# process umask, set explicitly inside that container's command below.
umask 077

APP_DIR="${APP_DIR:-/opt/eventory}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/eventory}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${APP_DIR}/docker-compose.prod.yml"
ENV_FILE="${APP_DIR}/.env.prod"

cd "$APP_DIR"
[[ -f "$COMPOSE_FILE" ]] || { echo "ERROR: $COMPOSE_FILE not found — run from a deployed /opt/eventory." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found." >&2; exit 1; }

# Extract only the two non-secret keys this script needs — never source
# .env.prod wholesale (see header comment / finding 7).
POSTGRES_USER="$(grep -m1 -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2- || true)"
POSTGRES_DB="$(grep -m1 -E '^POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2- || true)"
POSTGRES_USER="${POSTGRES_USER:-eventory}"
POSTGRES_DB="${POSTGRES_DB:-eventory}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DB_DUMP="${BACKUP_DIR}/eventory-db-${TS}.dump"
PHOTOS_TAR="${BACKUP_DIR}/eventory-photos-${TS}.tar.gz"

echo "[backup] $(date -u -Iseconds) starting (retention: ${RETENTION_DAYS}d, dir: ${BACKUP_DIR})"

# --- Database: custom-format pg_dump, via the container's own pg_dump binary
# (version-matched to the running postgres:16 image) so the dump is always
# compatible with that server's pg_restore -----------------------------------
echo "[backup] dumping database ($POSTGRES_DB)…"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom > "$DB_DUMP.tmp"
[[ -s "$DB_DUMP.tmp" ]] || { echo "ERROR: $DB_DUMP.tmp is empty — aborting, no marker written." >&2; exit 1; }
chmod 600 "$DB_DUMP.tmp"
mv "$DB_DUMP.tmp" "$DB_DUMP"
echo "[backup] db dump OK: $DB_DUMP ($(du -h "$DB_DUMP" | cut -f1))"

# --- Photos: tar the named volume via a throwaway container mounting it
# read-only, straight to a host file (no need to know the volume's on-disk
# mount path). Reuses the already-pinned postgres:16 image (it ships tar +
# gzip) rather than an unpinned `alpine:latest` running as root nightly
# (EVT-33 review round 2, finding 8) — one fewer image to trust, and it's
# already vetted by being the `db` service's own image. `umask 077` is set
# inside the container's own command because the host's umask above has no
# effect on files a *container* process creates. Photo tar while uploads are
# in flight is accepted for nightly home use — see
# docs/operations/backups.md ---------------------------
echo "[backup] archiving photo storage volume…"
docker run --rm \
  -v eventory-photo-storage:/data:ro \
  -v "$BACKUP_DIR":/backup \
  postgres:16 sh -c 'umask 077 && tar czf "/backup/$1.tmp" -C /data .' _ "$(basename "$PHOTOS_TAR")"
[[ -s "${PHOTOS_TAR}.tmp" ]] || { echo "ERROR: ${PHOTOS_TAR}.tmp is empty — aborting, no marker written." >&2; exit 1; }
chmod 600 "${PHOTOS_TAR}.tmp"
mv "${PHOTOS_TAR}.tmp" "$PHOTOS_TAR"
echo "[backup] photos archive OK: $PHOTOS_TAR ($(du -h "$PHOTOS_TAR" | cut -f1))"

# --- Rotation: prune backups older than RETENTION_DAYS -----------------------
echo "[backup] pruning backups older than ${RETENTION_DAYS}d…"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-db-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-photos-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete

# --- Success marker: written ONLY after both artifacts are confirmed
# non-empty above, so a stale marker never masks a failed run (AC5) ----------
date -u -Iseconds > "${BACKUP_DIR}/last-success.txt"
chmod 600 "${BACKUP_DIR}/last-success.txt"

echo "[backup] $(date -u -Iseconds) done — $(basename "$DB_DUMP"), $(basename "$PHOTOS_TAR")"
