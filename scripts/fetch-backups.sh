#!/usr/bin/env bash
# fetch-backups.sh — pull-based off-VM copy of the nightly backups (EVT-33).
#
# Run on the OPERATOR'S MAC (over the same key-auth SSH deploy.sh already
# uses — no new credentials). Mirrors /var/backups/eventory (the VM-side
# BACKUP_DIR default — deliberately outside deploy.sh's APP_DIR tree, see
# scripts/prod-backup.sh's header comment) into a local directory, prunes
# the local mirror on its own (longer) retention window, and warns if the
# newest backup is stale (AC5).
#
# Usage:
#   ./scripts/fetch-backups.sh
#
# Env overrides (all optional, same VM_IP/VM_USER convention as deploy.sh):
#   VM_IP                  default: 64.176.66.227
#   VM_USER                default: root
#   REMOTE_BACKUP_DIR       default: /var/backups/eventory — matches
#                           scripts/prod-backup.sh's default, which is
#                           deliberately outside deploy.sh's APP_DIR tree
#                           (deploy.sh wipes APP_DIR on every deploy; see
#                           prod-backup.sh's header comment)
#   LOCAL_BACKUP_DIR        default: $HOME/eventory-backups  (kept OUTSIDE
#                           the repo on purpose — never risk committing a
#                           binary backup blob)
#   LOCAL_RETENTION_DAYS    default: 30 (longer than the VM's default 14, so
#                           the off-VM copy still has history even if it
#                           wasn't fetched for a few days)
#   MAX_AGE_DAYS_WARN       default: 2 (AC5 staleness threshold)
#
# Schedule this from cron or launchd on your Mac, e.g. a launchd
# ~/Library/LaunchAgents/com.eventory.fetch-backups.plist running this once
# a day. A non-zero exit here (stale backups, or the fetch itself failing)
# is what should page/notify you — wire your scheduler's failure output
# accordingly (e.g. launchd StandardErrorPath -> `tail`/log-watcher, or a
# `mail`-piped cron entry).
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VM_IP="${VM_IP:-64.176.66.227}"
VM_USER="${VM_USER:-root}"
REMOTE_BACKUP_DIR="${REMOTE_BACKUP_DIR:-/var/backups/eventory}"
LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-$HOME/eventory-backups}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-30}"
MAX_AGE_DAYS_WARN="${MAX_AGE_DAYS_WARN:-2}"

mkdir -p "$LOCAL_BACKUP_DIR"
chmod 700 "$LOCAL_BACKUP_DIR"

echo "[fetch] rsync ${VM_USER}@${VM_IP}:${REMOTE_BACKUP_DIR}/ -> ${LOCAL_BACKUP_DIR}/"
# --delete NOT used: the VM already rotates (scripts/prod-backup.sh); the
# local mirror keeps its own longer window (LOCAL_RETENTION_DAYS) and prunes
# itself below, independent of what the VM currently has on disk. If the VM
# is ever lost entirely, the last successful rsync is exactly what this copy
# exists to preserve — it must never be truncated by a subsequent failed or
# partial sync.
#
# --safe-links: the VM is the internet-exposed asset in this pair — don't
# let a compromised sender write a symlink that escapes LOCAL_BACKUP_DIR.
# --chmod=F600,D700: backups contain the full DB (user emails, OAuth ids)
# and every photo; force owner-only perms on the Mac side regardless of
# what mode bits rsync would otherwise preserve from the remote.
# `--`: the operand that follows is a path, not an option, even if VM_IP or
# a path component were ever attacker-influenced.
rsync -az --partial --safe-links --chmod=F600,D700 \
  -e "ssh -o BatchMode=yes -o ConnectTimeout=15" \
  -- "${VM_USER}@${VM_IP}:${REMOTE_BACKUP_DIR}/" "${LOCAL_BACKUP_DIR}/"

echo "[fetch] pruning local mirror older than ${LOCAL_RETENTION_DAYS}d…"
find "$LOCAL_BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-db-*.dump' -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete
find "$LOCAL_BACKUP_DIR" -maxdepth 1 -type f -name 'eventory-photos-*.tar.gz' -mtime "+${LOCAL_RETENTION_DAYS}" -print -delete

echo "[fetch] checking freshness (warn threshold: ${MAX_AGE_DAYS_WARN}d)…"
node scripts/backup-lib.mjs freshness "$LOCAL_BACKUP_DIR" "$MAX_AGE_DAYS_WARN"
