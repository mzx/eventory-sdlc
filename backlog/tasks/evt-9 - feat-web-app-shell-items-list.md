---
id: EVT-9
title: 'feat(web): app shell + Items list — routing, MUI theme, TanStack Query, search & filters'
status: To Do
labels: [web, items, shell]
dependencies: [EVT-3, EVT-5]
references: [PRODUCT.md]
priority: high
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
- [ ] With seeded data (EVT-2 seed): items render with photos-or-placeholder, search narrows the grid, tag chip filters, clearing restores
- [ ] Vite dev proxy forwards `/api` and `/storage` to :3001 (no CORS config needed)
- [ ] Component tests (vitest + testing-library) for ItemsPage: renders list, search triggers refetch with `?search=`
- [ ] Layout usable at 375 px width
<!-- AC:END -->
