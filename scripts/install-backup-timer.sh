#!/usr/bin/env bash
# install-backup-timer.sh — one-time install of the nightly backup systemd
# timer on the production VM (EVT-33).
#
# Run ONCE on the VM as root, after deploy.sh has placed the stack at
# /opt/eventory:
#   ssh root@<vm-ip>
#   cd /opt/eventory && ./scripts/install-backup-timer.sh
#
# Idempotent — safe to re-run (e.g. after `./deploy.sh` re-syncs the repo)
# to pick up script changes; it just rewrites the unit files and reloads.
#
# Uses a systemd timer rather than a plain crontab entry so failures are
# visible via `systemctl status eventory-backup.timer` / `journalctl -u
# eventory-backup.service` and a missed run (VM was off at 03:15) still
# fires on next boot (Persistent=true).
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/eventory}"
[[ "$(id -u)" -eq 0 ]] || { echo "ERROR: run as root (sudo ./scripts/install-backup-timer.sh)." >&2; exit 1; }
[[ -x "${APP_DIR}/scripts/prod-backup.sh" ]] || {
  echo "ERROR: ${APP_DIR}/scripts/prod-backup.sh not found or not executable." >&2
  exit 1
}

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

echo "==> Installed. Nightly backup runs ~03:15 (+/- 5m jitter), Persistent=true (catches up on next boot if missed)."
echo "==> Check status:   systemctl status eventory-backup.timer"
echo "==> Check history:  journalctl -u eventory-backup.service --since '2 days ago'"
echo "==> Run once now:   systemctl start eventory-backup.service"
