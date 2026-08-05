---
id: EVT-4
title: 'feat(api): Locations tree — materialized path CRUD, by-qr, subtree rename'
status: To Do
labels: [api, locations]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Locations are the physical backbone (garage → wall → cabinet → drawer). Nothing manages the tree yet.

## Goal

`LocationsModule`:

- `GET /api/locations` — flat list ordered by `path`, each with `id, name, path, parentId, qrCode, itemCount` (direct items).
- `GET /api/locations/:id` — detail: children, direct items (id/name/primary photo), breadcrumb derived from path.
- `GET /api/locations/by-qr/:qr` — location by QR token.
- `POST /api/locations` — create child of optional `parentId`; `path` = parent path + `.` + slugified name; root when no parent. Reject duplicate sibling slugs (unique path).
- `PATCH /api/locations/:id` — rename: recompute own path AND rewrite all descendant paths in one transaction (`UPDATE ... SET path = replace(path, old, new) WHERE path LIKE old || '.%'`).
- `DELETE /api/locations/:id` — only when no descendants; items in it get `locationId = null` (schema SetNull).

## Non-goals

- QR PNG rendering (EVT-8), web UI (EVT-12), moving subtrees between parents (post-parity)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Tests cover: create root + nested child (path composition), duplicate sibling rejected, rename rewrites descendant paths atomically, delete-with-children rejected, by-qr hit
- [ ] `itemCount` in flat list matches actual direct items
- [ ] Slugification: "West Wall / Cabinet #3" → path segment `west-wall-cabinet-3` (lowercase, non-alnum → `-`)
<!-- AC:END -->
