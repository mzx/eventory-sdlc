---
id: EVT-12
title: 'feat(web): Locations page — tree browse, add child, location QR, "Add item here"'
status: Done
labels: [web, locations]
dependencies: [EVT-4, EVT-8, EVT-9]
references: [PRODUCT.md]
priority: medium
updated_date: '2026-08-06 13:36'
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The location tree exists only as API data; the sticker-on-every-bin workflow needs a UI.

## Goal

- **LocationsPage** (`/locations`): collapsible tree (MUI TreeView or nested lists) with
  item counts; "add child location" inline at every node and at root; rename + delete
  (delete disabled when children exist).
- **Location view** (`/locations/:id`): breadcrumb, children as tappable cards, direct
  items grid (reuse the ItemsPage card), QR sticker block with print (reuse `QrThumb`),
  and an **"Add item here"** button → `/intake?locationId=:id`.
- Mutations invalidate `['locations']`.

## Non-goals

- Drag-and-drop re-parenting, bulk moves
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Seeded tree renders nested with counts; expanding/collapsing works
- [x] Create child from the tree → appears under parent with composed path
- [x] Location view lists its items; "Add item here" lands on intake with location pre-selected
- [x] Print view for a location sticker shows QR + location path
<!-- AC:END -->

## Final Summary

## Summary
Added /locations (collapsible tree with item counts, inline add-child/rename/delete, delete disabled while children exist) and /locations/:id (breadcrumb, child cards, direct items grid reusing ItemCard, printable QR sticker via shared QrThumb, "Add item here" → /intake?locationId=:id). All location mutations invalidate the ['locations'] query.

## Changes
- apps/web/src/pages/LocationsPage.tsx — tree page with inline add/rename/delete
- apps/web/src/pages/LocationsPage.test.tsx — tree nesting/counts, create-child, rename, delete-confirm tests
- apps/web/src/pages/LocationDetailPage.tsx — breadcrumb, children cards, items grid, QR sticker, intake link
- apps/web/src/pages/LocationDetailPage.test.tsx — items/intake/print coverage
- apps/web/src/components/LocationTree.tsx — nested MUI List/Collapse tree rows
- apps/web/src/components/QrThumb.tsx — shared QR thumb + safe DOM-built print popup (opener nulled)
- apps/web/src/components/QrThumb.test.tsx — malicious-label XSS regression test
- apps/web/src/lib/locationTree.ts(+test) — flat list → tree builder
- apps/web/src/api.ts — locations/QR client fns with encodeURIComponent on segments
- apps/web/src/App.tsx — /locations + /locations/:id routes

## Design decisions
Tree built with nested MUI List/Collapse (no @mui/x-tree-view dependency). Print popup builds its DOM via createElement/textContent (no document.write) and nulls opener — closed a critical XSS finding from review round 1. Breadcrumb ancestor ids resolved by cross-referencing the flat ['locations'] list.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (18 tests)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 2 iterations (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

## Follow-up
- Mutation error paths (onError → Alert) untested (minor, carried over)
- fetchItem still lacks encodeURIComponent (pre-existing, out of scope)
