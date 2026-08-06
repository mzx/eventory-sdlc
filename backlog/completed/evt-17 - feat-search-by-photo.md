---
id: EVT-17
title: 'feat(search): search-by-photo — POST /api/items/search-by-photo matches a photo against inventory'
status: Done
labels: [api, web, ai, search]
dependencies: [EVT-7, EVT-9]
references: [PRODUCT.md]
priority: low
updated_date: '2026-08-06 20:43'
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
- [x] API test with mocked vision output: keywords matching seeded items return ranked matches; no-match returns empty list, 200
- [x] Uploaded search photo is NOT persisted to storage or DB
- [x] Web flow: photo search shows results + banner; clearing restores normal browsing
<!-- AC:END -->

## Final Summary

## Summary
POST /api/items/search-by-photo: memory-storage multipart upload → AiService vision analysis (never persisted) → items searched by suggested_name/search_keywords/tags against name/description/properties/tag-name via a single parameterized unnest query, ranked by distinct-term hits (createdAt tie-break) and capped at 50 matches. Web: camera button in the ItemsPage search bar, "Looks like" banner, clear action; any text/tag filter change clears an active photo search. Stub AI → empty matches with echoed analysis.

## Round 2 (review-driven)
- security major fixed: MAX_SEARCH_TERMS=10 cap + single batched query (was one full-scan query per uncapped AI-derived term — indirect-prompt-injection amplification); LIKE metacharacter escaping + ESCAPE on both this and the pre-existing ?search= path; rank-then-cap MAX_MATCHES=50
- testing major fixed: stale photo-results pinning on text/tag input — now cleared, tested both directions
- minor: tie-break test; parameterized PayloadTooLargeFilter messages (5MB vs 20MB routes)

## Verification
- build/test/lint/format all passed; 89 targeted api unit + 9 web ItemsPage tests; e2e 34/34 (docker Postgres) incl. non-persistence, escaping, capping, case-insensitivity
- Reviews: 2 rounds; classifier [testing critic security] @ 0.8; final: all three approved (1 low residual: SQL-side LIMIT hardening) — ⚠ codex unavailable, claude-native

## Follow-up
Low: add LIMIT (MAX_SEARCH_TERMS×MAX_MATCHES) inside the batched query; behavioral 429 throttle e2e; per-route in-flight concurrency cap when auth lands.
