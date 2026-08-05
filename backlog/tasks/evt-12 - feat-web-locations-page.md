---
id: EVT-12
title: 'feat(web): Locations page — tree browse, add child, location QR, "Add item here"'
status: To Do
labels: [web, locations]
dependencies: [EVT-4, EVT-8, EVT-9]
references: [PRODUCT.md]
priority: medium
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
- [ ] Seeded tree renders nested with counts; expanding/collapsing works
- [ ] Create child from the tree → appears under parent with composed path
- [ ] Location view lists its items; "Add item here" lands on intake with location pre-selected
- [ ] Print view for a location sticker shows QR + location path
<!-- AC:END -->
