#!/usr/bin/env bash
# install-backup-timer.sh — one-time install of the nightly backup schedule
# on the production VM (EVT-33; EVT-46 — Alpine/crond support).
#
# Run ONCE on the VM as root, after deploy.sh has placed the stack at
# /opt/eventory:
#   ssh root@<vm-ip>
#   cd /opt/eventory && ./scripts/install-backup-timer.sh
#
# Idempotent — safe to re-run (e.g. after `./deploy.sh` re-syncs the repo)
# to pick up script changes; it just rewrites the unit files / crontab line
# and reloads.
#
# EVT-46: this script originally assumed systemd unconditionally
# (`/etc/systemd/system` unit files), but the actual prod VM is Alpine
# Linux — no systemd at all, init is BusyBox/OpenRC. Because this script
# never ran successfully there, the nightly backup was installed manually
# via Alpine's crond instead (`/etc/crontabs/root`, 03:15 daily, logged to
# /var/log/eventory-backup.log). This script now detects which init system
# is actually present and installs the matching mechanism — a systemd timer
# on systemd hosts (unchanged behavior, visible via
# `systemctl status eventory-backup.timer` / `journalctl -u
# eventory-backup.service`, and a missed run still fires on next boot via
# `Persistent=true`), or an idempotent crontab entry on Alpine/BusyBox hosts
# that mirrors what's already running on the VM today — so re-running this
# script on the real VM formalizes the manual install instead of fighting
# it or leaving a duplicate entry behind.
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/eventory}"
LOG_FILE="${LOG_FILE:-/var/log/eventory-backup.log}"
CRON_MARKER="eventory-backup (installed by install-backup-timer.sh)"

[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: run as root (sudo ./scripts/install-backup-timer.sh)." >&2; exit 1; }
[[ -x "${APP_DIR}/scripts/prod-backup.sh" ]] || {
  echo "ERROR: ${APP_DIR}/scripts/prod-backup.sh not found or not executable." >&2
  exit 1
}

install_systemd() {
  cat > /etc/systemd/system/eventory-backup.service <<UNIT
[Unit]
Description=Eventory nightly backup (db + photos)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=${APP_DIR}
ExecStart=${APP_DIR}/scripts/prod-backup.sh
# Backup runs are I/O-heavy but not latency-sensitive — nice them out of the
# way of the live api/db containers.
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
UNIT

  cat > /etc/systemd/system/eventory-backup.timer <<UNIT
[Unit]
Description=Run eventory-backup.service nightly

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=300
Persistent=true

[Install]
WantedBy=timers.target
UNIT

  systemctl daemon-reload
  systemctl enable --now eventory-backup.timer

  echo "==> Installed systemd timer. Nightly backup runs ~03:15 (0-5m random delay), Persistent=true (catches up on next boot if missed)."
  echo "==> Check status:   systemctl status eventory-backup.timer"
  echo "==> Check history:  journalctl -u eventory-backup.service --since '2 days ago'"
  echo "==> Run once now:   systemctl start eventory-backup.service"
}

install_crontab() {
  local cron_file="${CRON_FILE:-/etc/crontabs/root}"
  local cron_line="15 3 * * * cd ${APP_DIR} && ./scripts/prod-backup.sh >> ${LOG_FILE} 2>&1 # ${CRON_MARKER}"

  [[ -d "$(dirname "$cron_file")" ]] || {
    echo "ERROR: neither systemd nor $(dirname "$cron_file") exist — unsupported init system." >&2
    exit 1
  }

  touch "$cron_file"
  # Idempotent: strip any previously-installed line carrying this script's
  # marker (identified by the trailing shell comment, which BusyBox's `sh
  # -c` — what crond hands each line to — treats exactly like any other
  # trailing comment), then append the current one. Safe to re-run, and
  # mirrors what's already been running on the VM manually: same schedule
  # (03:15 daily), same log destination.
  grep -v -F "$CRON_MARKER" "$cron_file" > "${cron_file}.tmp" || true
  mv "${cron_file}.tmp" "$cron_file"
  echo "$cron_line" >> "$cron_file"
  chmod 600 "$cron_file"

  # BusyBox crond re-reads /etc/crontabs/* on its own poll interval — no
  # reload/restart signal is required for the new line to take effect.
  echo "==> Installed Alpine crond entry (${cron_file}): nightly backup runs at 03:15, logged to ${LOG_FILE}."
  echo "==> Check history:  tail -f ${LOG_FILE}"
  echo "==> Run once now:   ${APP_DIR}/scripts/prod-backup.sh"
}

if command -v systemctl >/dev/null 2>&1 && [[ -d /etc/systemd/system ]]; then
  install_systemd
elif [[ -d /etc/crontabs ]] || command -v crond >/dev/null 2>&1; then
  install_crontab
else
  echo "ERROR: neither systemd (/etc/systemd/system) nor Alpine crond (/etc/crontabs, crond) detected — unsupported init system." >&2
  exit 1
fi
