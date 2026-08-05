---
id: EVT-5
title: 'feat(api): Tags list + Categories tree (read/create)'
status: To Do
labels: [api, tags, categories]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The web UI needs tag suggestions for filters/autocomplete and a category tree for item classification.

## Goal

- `GET /api/tags` — all tags with per-tag item counts, ordered by usage desc.
- `TagsModule` exposes the upsert-by-name service used by EVT-3 item create/update (single source of truth).
- `GET /api/categories` — flat list ordered by path (same materialized-path shape as locations).
- `POST /api/categories` — create child (same slug/path rules as EVT-4).

## Non-goals

- Tag rename/merge/delete endpoints, category rename/delete (post-parity)
- Dedicated web pages (categories appear only as a picker in item forms)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Tests: tag counts correct after items tagged/untagged; category path composition + duplicate sibling rejection
- [ ] Creating an item with a new tag name (EVT-3 flow) makes it appear in `GET /api/tags`
<!-- AC:END -->
