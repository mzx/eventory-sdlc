---
id: EVT-9
title: 'feat(web): app shell + Items list — routing, MUI theme, TanStack Query, search & filters'
status: Done
labels: [web, items, shell]
dependencies: [EVT-3, EVT-5]
references: [PRODUCT.md]
priority: high
updated_date: '2026-08-06 11:41'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The web app is still the EVT-1 health-check placeholder.

## Goal

- App shell: `react-router-dom` routes, MUI 6 theme (`theme.ts`), top AppBar with title +
  primary "Add item" action, responsive container (phone-first — this app is used
  standing in a garage).
- `api.ts`: typed fetch client for the API (base url from `VITE_API_BASE`, default
  `/api` via Vite dev proxy to :3001); TanStack Query provider with sane defaults.
- **ItemsPage** (`/`): debounced search box, tag filter chips (from `GET /api/tags`),
  responsive card grid — primary photo thumbnail, name, quantity, location path
  breadcrumb, tag chips. Empty state prompts to add the first item. Click → `/items/:id`
  (page arrives in EVT-10; route can stub).
- Query invalidation strategy: item mutations invalidate `['items']` and `['tags']`.

## Non-goals

- Item detail/edit (EVT-10), intake flow (EVT-11), locations UI (EVT-12), auth (EVT-15), PWA (EVT-18)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] With seeded data (EVT-2 seed): items render with photos-or-placeholder, search narrows the grid, tag chip filters, clearing restores
- [x] Vite dev proxy forwards `/api` and `/storage` to :3001 (no CORS config needed)
- [x] Component tests (vitest + testing-library) for ItemsPage: renders list, search triggers refetch with `?search=`
- [x] Layout usable at 375 px width
<!-- AC:END -->

## Final Summary

## Summary
Built the EVT-9 web app shell: react-router-dom routing, MUI 6 theme, sticky AppBar with "Add item" action, phone-first container. Typed api.ts fetch client (VITE_API_BASE, default /api) with TanStack Query at the root. ItemsPage with debounced search, GET /api/tags filter chips, responsive card grid (photo-or-placeholder, name, qty, location breadcrumb, tag chips), empty states, and routed stubs for EVT-10/EVT-11. Vite dev proxy forwards /api and /storage to :3001.

## Changes
- apps/web/src/App.tsx — routes + AppBar shell
- apps/web/src/theme.ts — MUI 6 theme
- apps/web/src/api.ts — typed fetch client
- apps/web/src/pages/ItemsPage.tsx (+ ItemCard.tsx) — search/filter/grid
- apps/web/src/pages/ItemsPage.test.tsx (+ src/test/setup.ts) — 3 component tests
- apps/web/src/pages/ItemDetailPage.tsx, IntakePage.tsx — route stubs
- apps/web/vite.config.ts — dev proxy + vitest config
- apps/web/package.json, pnpm-lock.yaml — deps (react-router-dom, @mui/icons-material, vitest 1.6.1, testing-library)

## Design decisions
vitest 1.6.1 chosen to pair with workspace vite 5.4.21 (avoids unrelated major bump). test.globals: true for testing-library auto-cleanup.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- Reviews: code-reviewer ✓, security-reviewer ✓ (classifier-selected @ 0.9; testing auto-approved) — ⚠ independence not enforced (codex unavailable, claude-native fallback)

## Follow-up
Minor findings deferred: encodeURIComponent in fetchItem/photoUrl, keepPreviousData for grid flash, 404 catch-all route, no-op disableRipple override.
