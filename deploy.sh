#!/usr/bin/env bash
# Deploy Eventory to the Vultr VM (single-host prod stack from EVT-19).
#
# Run from the repo root on your Mac:
#   ./deploy.sh
#
# What it does:
#   1. Packages the current HEAD commit with `git archive` (no node_modules,
#      no local junk — exactly what's committed).
#   2. Copies the tarball + local .env.prod to the VM over SSH.
#   3. On the VM: installs Docker if missing, opens ports 80/443 (ufw),
#      adds 2G swap when RAM < 2GB, unpacks to /opt/eventory, and runs
#      docker compose -f docker-compose.prod.yml up --build -d.
#
# Safe to re-run for updates — Docker volumes (db, photos, certs) persist.
# SSH connection sharing means you enter the password once per run.
set -euo pipefail

VM_IP="${VM_IP:-64.176.66.227}"
VM_USER="${VM_USER:-root}"
APP_DIR="/opt/eventory"

CTL_PATH="$(mktemp -d)/ssh-ctl"
SSH_OPTS=(-o ControlMaster=auto -o ControlPath="$CTL_PATH" -o ControlPersist=10m)
cleanup() { ssh -O exit "${SSH_OPTS[@]}" "${VM_USER}@${VM_IP}" 2>/dev/null || true; }
trap cleanup EXIT

[[ -f .env.prod ]] || { echo "ERROR: .env.prod not found — run from the repo root." >&2; exit 1; }
[[ -f docker-compose.prod.yml ]] || { echo "ERROR: run from the repo root." >&2; exit 1; }

echo "==> Packaging HEAD ($(git rev-parse --short HEAD) on $(git branch --show-current))"
TARBALL="$(mktemp -d)/eventory.tar.gz"
git archive --format=tar.gz -o "$TARBALL" HEAD

echo "==> Connecting to ${VM_USER}@${VM_IP} (enter password once)"
ssh "${SSH_OPTS[@]}" "${VM_USER}@${VM_IP}" "mkdir -p ${APP_DIR}"

echo "==> Uploading code + .env.prod"
scp "${SSH_OPTS[@]}" "$TARBALL" "${VM_USER}@${VM_IP}:${APP_DIR}/eventory.tar.gz"
scp "${SSH_OPTS[@]}" .env.prod "${VM_USER}@${VM_IP}:${APP_DIR}/.env.prod"

echo "==> Provisioning + starting the stack"
ssh "${SSH_OPTS[@]}" "${VM_USER}@${VM_IP}" bash -s <<'REMOTE'
set -euo pipefail
APP_DIR=/opt/eventory

# --- Docker ------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "--> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# --- Firewall (ufw ships on Vultr Ubuntu images) -----------------------------
if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
  echo "--> ufw: 22/80/443 open"
fi

# --- Swap: the on-VM image build OOMs on small instances ---------------------
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 1900000 ] && ! swapon --show | grep -q .; then
  echo "--> <2GB RAM and no swap: adding 2G swapfile"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Unpack and launch -------------------------------------------------------
cd "$APP_DIR"
# Clean tree before unpacking — plain tar-over-tar never deletes files that
# were removed from the repo, and stale sources poison the Docker build.
find . -mindepth 1 -maxdepth 1 ! -name '.env.prod' ! -name 'eventory.tar.gz' -exec rm -rf {} +
tar xzf eventory.tar.gz && rm eventory.tar.gz
chmod 600 .env.prod

# A pre-existing db container keeps the password it was initialized with —
# postgres ignores POSTGRES_PASSWORD after first init. Sync it to the
# current .env.prod (data preserved) so the api can authenticate. Works
# passwordless because the official image trusts local-socket connections.
if docker ps --format '{{.Names}}' | grep -q '^eventory-db-1$'; then
  set -a; . ./.env.prod; set +a
  docker exec eventory-db-1 psql -U "${POSTGRES_USER:-eventory}" -d "${POSTGRES_DB:-eventory}" -v ON_ERROR_STOP=1 \
    -c "ALTER USER \"${POSTGRES_USER:-eventory}\" WITH PASSWORD '${POSTGRES_PASSWORD}';" >/dev/null
  echo "--> existing db: password synced to .env.prod"
fi

echo "--> docker compose up --build -d (first build takes a few minutes)"
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d

echo "--> Waiting for the api container to report healthy"
for i in $(seq 1 60); do
  status=$(docker compose -f docker-compose.prod.yml ps --format '{{.Service}} {{.Health}}' | awk '$1=="api" {print $2}')
  [ "$status" = "healthy" ] && break
  sleep 5
done
docker compose -f docker-compose.prod.yml ps
[ "${status:-}" = "healthy" ] || { echo "ERROR: api never became healthy — check: docker compose -f docker-compose.prod.yml logs api"; exit 1; }
REMOTE

echo
echo "==> Deployed. Open: https://64-176-66-227.nip.io/"
echo "    (First visit may take ~30s while Caddy obtains the Let's Encrypt cert.)"
