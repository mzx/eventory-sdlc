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
#   BACKUP_DIR               default: $APP_DIR/backups
#   BACKUP_RETENTION_DAYS    default: 14
#
# Reuses .env.prod (already on the VM from deploy.sh) for POSTGRES_USER /
# POSTGRES_DB only — pg_dump runs inside the db container via
# `docker compose exec`, authenticating over Postgres's trusted local
# socket, exactly like the password-sync step in deploy.sh. No credentials
# are read, embedded, or logged by this script.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/eventory}"
BACKUP_DIR="${BACKUP_DIR:-${APP_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
COMPOSE_FILE="${APP_DIR}/docker-compose.prod.yml"
ENV_FILE="${APP_DIR}/.env.prod"

cd "$APP_DIR"
[[ -f "$COMPOSE_FILE" ]] || { echo "ERROR: $COMPOSE_FILE not found — run from a deployed /opt/eventory." >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "ERROR: $ENV_FILE not found." >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
POSTGRES_USER="${POSTGRES_USER:-eventory}"
POSTGRES_DB="${POSTGRES_DB:-eventory}"

mkdir -p "$BACKUP_DIR"

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
mv "$DB_DUMP.tmp" "$DB_DUMP"
[[ -s "$DB_DUMP" ]] || { echo "ERROR: $DB_DUMP is empty — aborting, no marker written." >&2; exit 1; }
echo "[backup] db dump OK: $DB_DUMP ($(du -h "$DB_DUMP" | cut -f1))"

# --- Photos: tar the named volume via a throwaway alpine container mounting
# it read-only, straight to a host file (no need to know the volume's
# on-disk mount path). Photo tar while uploads are in flight is accepted for
# nightly home use — see docs/operations/backups.md ---------------------------
echo "[backup] archiving photo storage volume…"
docker run --rm \
  -v eventory-photo-storage:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine sh -c "tar czf /backup/$(basename "$PHOTOS_TAR").tmp -C /data ."
mv "${PHOTOS_TAR}.tmp" "$PHOTOS_TAR"
[[ -s "$PHOTOS_TAR" ]] || { echo "ERROR: $PHOTOS_TAR is empty — aborting, no marker written." >&2; exit 1; }
echo "[backup] photos archive OK: $PHOTOS_TAR ($(du -h "$PHOTOS_TAR" | cut -f1))"

# --- Rotation: prune backups older than RETENTION_DAYS -----------------------
echo "[backup] pruning backups older than ${RETENTION_DAYS}d…"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-db-*.dump' -mtime "+${RETENTION_DAYS}" -print -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-photos-*.tar.gz' -mtime "+${RETENTION_DAYS}" -print -delete

# --- Success marker: written ONLY after both artifacts are confirmed
# non-empty above, so a stale marker never masks a failed run (AC5) ----------
date -u -Iseconds > "${BACKUP_DIR}/last-success.txt"

echo "[backup] $(date -u -Iseconds) done — $(basename "$DB_DUMP"), $(basename "$PHOTOS_TAR")"
