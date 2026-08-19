# Eventory

Workshop home inventory app. See [`PRODUCT.md`](./PRODUCT.md) for the product brief and
target architecture, and [`backlog/`](./backlog) for the AI-SDLC task backlog.

- **web** — Vite + React 18 + MUI 6 + TanStack Query, port `5173`
- **api** — NestJS 10 + Prisma 5 + Anthropic SDK + qrcode, port `3001`
- **db** — Postgres 16, port `5432`

## Quick start (Docker Compose)

```bash
cp apps/api/.env.example apps/api/.env   # fill in secrets you have; defaults work for local dev
pnpm dev                                 # docker compose up --build
```

Without mkcert certs (see below), both `api` and `web` boot over plain HTTP — this is the
default for a fresh clone and for CI. Camera capture, service-worker install, and the
Google OAuth redirect all require HTTPS, so for real phone testing set up certs first.

### Live dev source — plain `up` reflects your edits (EVT-21)

`docker-compose.yml` (dev only — **not** `docker-compose.prod.yml`) bind-mounts `apps/` and
the root manifests (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`) into both the
`api` and `web` containers, and each container runs the real dev server against that
mounted source:

- `api` runs `nest start --watch` (not the built `dist/`) — it recompiles and restarts on
  every save.
- `web` runs `vite --host 0.0.0.0` — Vite's HMR pushes updates over the mounted source with
  no restart.

`git pull && pnpm dev` (or even a plain `docker compose up` on an already-running stack)
now reflects the code on disk — **no manual rebuild needed to pick up source changes.**
`node_modules` is deliberately excluded from the bind mount (it lives on named Docker
volumes instead — `eventory-api-node-modules` etc., see `docker volume ls`) so the
container's own pnpm-installed tree, with native bindings built for the container's
platform, is never shadowed by whatever is (or isn't) in the host's `node_modules/`.

**When `pnpm-lock.yaml` changes** (e.g. after `git pull` merges a dependency bump), each
container detects the change automatically at startup/restart (a hash of the lockfile is
stamped into that container's `node_modules` volume) and reinstalls before starting the dev
server. If the reinstall itself fails (e.g. a broken lockfile), the container exits with a
clear `[dev] ERROR: pnpm install failed for ...` message in `pnpm logs` / `docker compose
logs <service>` instead of silently starting against a stale or missing dependency tree —
fix the lockfile, then `docker compose restart api` (or `web`).

**You still need a rebuild** (`pnpm dev`, which always runs `docker compose up --build`, or
explicitly `docker compose build api web`) when you change something baked into the
*image* rather than the source tree: `apps/api/Dockerfile` / `apps/web/Dockerfile`, the
base Node image/version, or an `apt-get` package. Editing application source, adding a
dependency to `package.json`, or updating `pnpm-lock.yaml` does **not** require a rebuild —
the running containers pick those up on their own (source instantly, lockfile changes on
next container start/restart, per above).

To fully reset the installed-dependency volumes (equivalent to deleting `node_modules`
locally): `docker compose down -v`.

### Schema changes just work — auto `prisma generate` + `migrate deploy` on api start (EVT-32)

`git pull`ing a schema-touching merge is enough — `docker compose up -d --build` (or a plain
restart of an already-running stack) brings the `api` container up with the schema fully
applied, no manual steps. Before the dev server starts, the `api` container's startup script
(`docker-compose.yml`, same idiom as the pnpm-lock reinstall check above) runs, in order:

1. `prisma generate` — regenerates the Prisma client so newly pulled models/fields are
   available. Needed because the generated client lives in the `node_modules` volume, not the
   bind-mounted source (EVT-21) — a schema change alone doesn't update it.
2. `prisma migrate deploy` — applies any migrations merged from git that aren't yet applied to
   the dev database. Deploy only, never `migrate dev` — the dev container must never create a
   migration.

Both steps log a distinct `[dev] ...` line in `docker compose logs api`, and each fails loudly
(a clear `[dev] ERROR: ...` message, non-zero exit) rather than letting the app start against a
stale client or an unmigrated schema — a failed step keeps the container restarting/unhealthy
instead of silently half-running. When nothing changed, both steps are a no-op that adds only a
few seconds to startup.

**Manual escape hatches** (e.g. to inspect state without waiting for a container restart):

```bash
docker compose exec api npx prisma migrate status   # check for pending migrations
docker compose exec api npx prisma generate          # regenerate the client by hand
docker compose exec api npx prisma migrate deploy     # apply pending migrations by hand
docker compose restart api                            # re-run the full startup sequence
```

## Phone-on-LAN dev setup (HTTPS via mkcert)

Both dev servers can serve HTTPS using locally-trusted certificates from
[mkcert](https://github.com/FiloSottile/mkcert), so a phone on the same Wi-Fi can open the
site, use its camera, install the PWA, and complete the Google OAuth flow — all of which
require a secure origin. Certs are **gitignored**; nobody commits key material, and every
operator generates their own.

### 1. Install mkcert and its local CA (one-time, per machine)

```bash
# macOS
brew install mkcert nss   # nss only needed if you also use Firefox
mkcert -install
```

See the [mkcert README](https://github.com/FiloSottile/mkcert#installation) for
Linux/Windows install instructions. `mkcert -install` adds a local CA to your OS/browser
trust stores — that's what makes the generated certs show up as "secure" with no browser
warning, on this machine only.

### 2. Find your machine's LAN IP (or hostname)

```bash
# macOS
ipconfig getifaddr en0
# or, for the mDNS hostname most phones can resolve on the same network:
scutil --get LocalHostName   # → <name>.local
```

### 3. Generate certs for both apps, covering `localhost` AND your LAN address

Run from the repo root, substituting your actual LAN IP / `.local` hostname from step 2:

```bash
mkdir -p apps/web/certs apps/api/certs

mkcert -cert-file apps/web/certs/cert.pem -key-file apps/web/certs/key.pem \
  localhost 127.0.0.1 ::1 192.168.1.42 my-laptop.local

mkcert -cert-file apps/api/certs/cert.pem -key-file apps/api/certs/key.pem \
  localhost 127.0.0.1 ::1 192.168.1.42 my-laptop.local
```

Both apps look specifically for `cert.pem` + `key.pem` in their own `certs/` directory
(`apps/web/certs/`, `apps/api/certs/`) — see `apps/web/vite.config.ts`
(`resolveHttpsOptions`) and `apps/api/src/common/https-options.ts`. When both files are
present, the dev server serves HTTPS with them; when either is missing, it falls back to
plain HTTP automatically, so there's no separate "HTTPS mode" flag to toggle.

### 4. Point `PUBLIC_BASE_URL` at the LAN origin

QR stickers encode `PUBLIC_BASE_URL` (see `apps/api/.env.example`) as the URL a scan opens.
For a phone's native camera app to resolve that URL, it must be your LAN-reachable https
origin, not `localhost` (a phone can't resolve your laptop's `localhost`):

```bash
# apps/api/.env
PUBLIC_BASE_URL=https://192.168.1.42:5173
# or the .local hostname from step 2:
# PUBLIC_BASE_URL=https://my-laptop.local:5173
```

### 5. Run it

**Without Docker** (fastest iteration):

```bash
pnpm --filter @eventory/api start:dev   # https://localhost:3001 (or LAN origin)
pnpm --filter @eventory/web dev         # https://localhost:5173 (or LAN origin)
```

**With Docker Compose** — `docker-compose.yml` bind-mounts `apps/web/certs/` and
`apps/api/certs/` into both containers read-only, so the same certs work there too:

```bash
pnpm dev
```

The web dev server's `/api` and `/storage` proxy (`apps/web/vite.config.ts`,
`resolveApiProxyTarget` in `apps/web/vite-config/https-options.ts`) automatically matches
whatever protocol the `api` container is actually serving: it checks the API's own
`apps/api/certs/` directory (bind-mounted read-only into the `web` container too, purely
for this check) and proxies `https://api:3001` when both `cert.pem` + `key.pem` are
present there, `http://api:3001` otherwise. This stays correct even if only one of
`apps/web/certs/` / `apps/api/certs/` has been generated — run step 3 above for both apps
together to avoid that split state. Set `VITE_API_PROXY_TARGET` in the `web` service's
`environment:` to override this (e.g. pointing at a non-Docker API host) if you ever need
to.

### 6. Verify

```bash
curl -k https://localhost:3001/api/health   # -k: mkcert's CA isn't in curl's trust store by default
```

From your phone, browse to `https://<lan-ip-or-hostname>:5173` — same Wi-Fi network as the
dev machine. You should see no certificate warning (mkcert's CA is trusted automatically
once installed on the machine serving it, but note: **only the machine running `mkcert
-install` trusts the cert** — a phone will show a warning unless you also install mkcert's
root CA on the phone, which `mkcert -install` does not do for you. For workshop dev use,
tapping through the browser's warning is the expected flow).

## Installable PWA

The web app is a PWA (`vite-plugin-pwa`, `apps/web/vite.config.ts`): manifest (name
"Eventory", standalone display, theme color, 192/512 icons), and a service worker that
precaches the built app shell plus runtime-caches `/storage/*` (uploaded item photos —
safe to cache, immutable once uploaded) but **never** caches `/api/*` (inventory data —
stale inventory is worse than slow inventory; every API request always hits the network).

To verify: open Chrome DevTools → Application → Manifest (installability checks) and
Application → Service Workers, or run Lighthouse's PWA/installable audit against
`https://localhost:5173`. To confirm `/api/*` is never cached, browse the app, then check
DevTools → Application → Cache Storage — only `eventory-storage-images` should appear
(never an API-response cache), and Network tab requests to `/api/*` should show `(from
disk cache)`/`(from ServiceWorker)` **never** appearing for API calls.

## Auth: admin bootstrap and recovery (EVT-20)

Google sign-in (`apps/api/src/auth/auth.service.ts`) auto-promotes the FIRST-ever user to
`admin` + `approved`, so the household is never locked out waiting for an admin to approve
the very first admin. "First" only counts rows that have actually signed in via Google
(have a `googleId`) — a manually-seeded/dev row with no `googleId` never consumes this slot.

That said, the count-based check can still be defeated by any pre-existing row that *does*
have a `googleId` (e.g. a persisted-volume leftover from earlier testing). For a guaranteed
bootstrap, or to recover an already-stuck instance, set `EVENTORY_ADMIN_EMAILS` (see
`apps/api/.env.example`) — a comma-separated allowlist of Google account emails that
**always** land `admin` + `approved` on sign-in, independent of the table's row count:

```bash
# apps/api/.env
EVENTORY_ADMIN_EMAILS=you@example.com
```

Then sign in (or sign in again, if you're already stuck on the "pending" page) with that
Google account — no manual SQL required. This works both for a brand-new deployment and for
recovering an instance where someone else's row already consumed the first-user slot; the
promotion is applied retroactively on sign-in even if the row already exists as `pending`.

## Production backups (EVT-33)

Nightly, off-VM, tested restore procedure — see
[`docs/operations/backups.md`](./docs/operations/backups.md) for the full
runbook (install, fetch, and restore for both "fresh VM" and "db corrupted,
VM alive" scenarios).

## Other useful commands

```bash
pnpm build          # build all workspace packages
pnpm test            # run all tests
pnpm lint            # lint all packages
pnpm format:check    # prettier --check all packages
pnpm logs            # docker compose logs -f
pnpm psql            # psql shell into the dev Postgres container
pnpm down            # docker compose down
```
