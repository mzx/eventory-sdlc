# Eventory — Product Brief

**Goal:** Workshop home inventory app. Rebuild of the original `eventory` prototype
(`~/IdeaProjects/eventory`, reference only — no code is copied), developed from scratch
through the AI-SDLC framework: every feature enters as a DoR-ready backlog task, is
implemented by AI agents in isolated worktrees, reviewed, attested, and merged via PR.

## What the app does

A home-workshop inventory: photograph an item with your phone, let AI vision draft the
item record, confirm and save, print a QR sticker. Locations (garage → wall → cabinet →
drawer) form a tree, each with its own QR; scanning a bin's QR shows its contents and
lets you add items directly into it.

## Target architecture (from the validated prototype)

- **web** — Vite + React 18 + MUI 6 + TanStack Query (port 5173)
- **api** — NestJS 10 + Prisma 5 + Anthropic SDK + qrcode (port 3001)
- **db** — Postgres 16 with `pg_trgm` + `uuid-ossp` (port 5432)
- Docker Compose for dev; API auto-runs `prisma migrate deploy` on start.
- HTTPS on dev ports (mkcert) — required for phone camera + Google OAuth.

## Core capabilities (the backlog decomposes these)

1. **Item CRUD + search** — `GET/POST /api/items`, search by text/tag/location;
   `Item.properties` is JSONB (flexible attributes, no EAV); tags are a real
   many-to-many (`ItemTag`).
2. **Photo intake with AI draft** — upload photo → Claude vision (structured JSON:
   `suggested_name`, `tags`, `color`, `quantity`, `properties`, `search_keywords`) →
   prefilled form → human confirms. AI output is a draft, never auto-saved
   (vision is weak on exact specs: M4 vs M5, 18V vs 20V).
   Stub analyzer when no `EVENTORY_ANTHROPIC_KEY` is set.
3. **QR codes** — every item and location gets a UUID token; `GET /api/qr/:token`
   renders a PNG encoding `${PUBLIC_BASE_URL}/r/:token`; `GET /api/items/by-qr/:qr`
   resolves either kind.
4. **Location tree** — materialized path (`garage.west-wall.cabinet-3.drawer-2`);
   scan-bin → see contents → "Add item here" auto-assigns the location. Categories are
   a second, QR-less tree for classification.
5. **Auth** — Google OAuth → JWT httpOnly cookie, with an approval workflow: new users
   land `pending` until the admin (first-ever user) approves; admin users page.
6. **Projects + BOM** — workshop projects with bill-of-materials lines optionally
   linked to inventory items (denormalized name survives item deletion).
7. **Search by photo** — photograph a thing → vision keywords → ranked matches from
   the inventory ("do I already have one of these?").
8. **PWA + HTTPS dev** — installable, phone-first; mkcert HTTPS on 5173/3001 (camera
   & OAuth need secure origins); prod single-host deploy behind Caddy.

## Non-goals for v1

- Multi-tenancy / sharing between households (approval workflow ≠ multi-tenant)
- Native mobile app (responsive PWA-style web is enough)
- Barcode/UPC product lookup
- Offline mutation queue (PWA caches static assets only, never `/api/*`)

## Decision log seed (already decided — do not relitigate in tasks)

- Human-in-the-loop on AI suggestions (no auto-save of vision output)
- JSONB properties over EAV
- Materialized path over adjacency list / ltree extension for the location tree
- MUI over Tailwind (operator preference)
