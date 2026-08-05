---
id: EVT-17
title: 'feat(search): search-by-photo — POST /api/items/search-by-photo matches a photo against inventory'
status: To Do
labels: [api, web, ai, search]
dependencies: [EVT-7, EVT-9]
references: [PRODUCT.md]
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

"I'm holding a thing — do I already have more of these, and where?" The original answers
this by photographing the thing and searching the inventory with the vision output.

## Goal

- `POST /api/items/search-by-photo` — multipart photo. Runs the EVT-7 vision analysis
  (not persisted), then searches items using `suggested_name` + `search_keywords` +
  `tags` against the EVT-3 search (name/description/properties/tags), merged and ranked
  by match count. Returns `{ analysis, matches: Item[] }` (list-shape items with
  location paths). Stub AI → empty keywords → empty matches with a clear `analysis` echo.
- Web: camera button inside the ItemsPage search bar → capture/pick photo → results
  replace the grid, banner shows what the AI thought it saw ("Looks like: M4 hex bolt")
  with a clear-search action.

## Non-goals

- Embedding/vector similarity (the `.ai-sdlc/embedding-config.yaml` scaffold is
  unrelated), persisting search photos
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] API test with mocked vision output: keywords matching seeded items return ranked matches; no-match returns empty list, 200
- [ ] Uploaded search photo is NOT persisted to storage or DB
- [ ] Web flow: photo search shows results + banner; clearing restores normal browsing
<!-- AC:END -->
