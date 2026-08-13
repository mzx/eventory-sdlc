#!/usr/bin/env bash
# dev-refresh.sh — refresh the local Docker stack to latest origin/main.
#
# Encodes the debris-safe procedure that manual refreshes kept needing
# (2026-08-13 session): AI-SDLC pipeline sessions leave backlog/** copies in
# the parent working tree that block `git pull --ff-only`, and the api
# container serves bind-mounted source, so compose skips recreating it and
# the startup prisma generate + migrate deploy (EVT-32) never runs.
#
# Usage: pnpm refresh   (or: bash scripts/dev-refresh.sh)
set -euo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "main" ]; then
  echo "[refresh] ERROR: on branch '$BRANCH', not main — refusing." >&2
  exit 1
fi

echo "[refresh] fetching origin/main…"
git fetch origin main -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse FETCH_HEAD)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[refresh] already at origin/main ($(git rev-parse --short HEAD)) — nothing to pull."
else
  # ── Debris pass (backlog/** only — pipeline bookkeeping, never app code) ──
  # 1. Tracked backlog files with local modifications: restore to HEAD so an
  #    incoming rename/delete can apply (sessions flip task status in-place).
  git diff --name-only -z -- backlog/ | while IFS= read -r -d '' f; do
    echo "[refresh] debris: restoring modified tracked file: $f"
    git checkout HEAD -- "$f"
  done
  # 2. Untracked backlog files: remove only if byte-identical to origin/main's
  #    copy (the incoming merge recreates them); anything else is moved aside.
  BACKUP_DIR=".git/refresh-debris-$(date +%Y%m%dT%H%M%S)"
  git ls-files --others --exclude-standard -z -- backlog/ | while IFS= read -r -d '' f; do
    if git cat-file -e "FETCH_HEAD:$f" 2>/dev/null \
       && git show "FETCH_HEAD:$f" | diff -q - "$f" >/dev/null 2>&1; then
      echo "[refresh] debris: removing untracked copy identical to origin: $f"
      rm "$f"
    else
      mkdir -p "$BACKUP_DIR"
      echo "[refresh] debris: differs from origin — moving aside to $BACKUP_DIR: $f"
      mv "$f" "$BACKUP_DIR/$(basename "$f")"
    fi
  done

  git merge --ff-only FETCH_HEAD
  echo "[refresh] pulled: $(git rev-parse --short "$LOCAL")..$(git rev-parse --short HEAD)"
  git log --oneline "$LOCAL"..HEAD | sed 's/^/[refresh]   /'
fi

echo "[refresh] rebuilding stack…"
docker compose up -d --build
# force-recreate api even when compose sees no config change: source is
# bind-mounted, and only a fresh start runs prisma generate + migrate deploy.
docker compose up -d --force-recreate api

echo "[refresh] waiting for api health…"
n=0
until curl -skf https://localhost:3001/api/health >/dev/null 2>&1; do
  n=$((n + 1))
  if [ "$n" -gt 60 ]; then
    echo "[refresh] ERROR: api not healthy after 120s. Last logs:" >&2
    docker compose logs api --tail 20 >&2
    exit 1
  fi
  sleep 2
done
echo "[refresh] api healthy: $(curl -sk https://localhost:3001/api/health)"

LATEST_FILE=$(ls apps/api/prisma/migrations | grep -E '^[0-9]' | sort | tail -1)
LATEST_DB=$(docker compose exec -T db psql -U eventory -d eventory -tA \
  -c "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1")
if [ "$LATEST_FILE" != "$LATEST_DB" ]; then
  echo "[refresh] ERROR: migration mismatch — latest file '$LATEST_FILE' vs db '$LATEST_DB'." >&2
  echo "[refresh] Check: docker compose logs api | grep -i migrate" >&2
  exit 1
fi
echo "[refresh] migrations in sync: $LATEST_DB"

WEB_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://localhost:5173 || echo "000")
if [ "$WEB_CODE" != "200" ]; then
  echo "[refresh] WARNING: web returned $WEB_CODE (may still be starting)" >&2
else
  echo "[refresh] web OK (200)"
fi
echo "[refresh] done — stack at $(git rev-parse --short HEAD)"
