---
id: EVT-36
title: 'fix(web): projects area on mobile — table containment, fullscreen backflush dialog, delete confirm'
status: To Do
priority: high
created_date: '2026-08-14 14:39'
updated_date: '2026-08-14 14:39'
assignee: []
labels:
  - web
  - mobile
  - projects
  - bug
dependencies: []
references:
  - apps/web/src/pages/ProjectDetailPage.tsx
  - apps/web/src/pages/AdminUsersPage.tsx
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Three phone-width failures in ProjectDetailPage (2026-08-14 mobile audit,
findings #2–#4):

1. **Tables without containment**: the clear-to-build AvailabilityPanel renders a
   6-column Table (~line 325) and the BOM section a 5-column Table (~line 736)
   whose add-row embeds an Autocomplete + two fixed-90px TextFields in one
   TableRow. Neither is wrapped in a TableContainer/overflowX container — at
   ~390px cells compress to slivers and long location paths force page-level
   horizontal scroll. (AdminUsersPage:166 already shows the correct in-repo
   pattern: `Box` with `overflowX:'auto'`.)
2. **Backflush dialog cramped**: BackflushDialog (~line 441) is maxWidth='sm'
   with a 4-column table + 90px number inputs per row and no fullScreen-on-mobile;
   the confirm-consumption step — where inventory actually gets written — invites
   mis-taps at 390px.
3. **One-tap project delete**: "Delete project" (~line 695) mutates immediately
   with no confirmation, unlike item delete (confirm Dialog) and location delete
   (window.confirm) — a fat-finger hazard next to the Status select.

## Goal

- Wrap both tables in scroll containment as a minimum; at xs prefer stacked
  card/list rows for availability lines (name, required/on-hand, status chip,
  action) and move the add-BOM-line controls out of the table into a stacked form
- BackflushDialog: `fullScreen` at `breakpoints.down('sm')` (useMediaQuery);
  at xs render each line stacked (name + shortage chip, plan/on-hand caption,
  full-width consume input)
- Delete project gets the same confirm Dialog pattern as item deletion

## Non-goals

- Changing any backflush/BOM API behavior — layout and confirmation only
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] At ~390px neither the availability panel nor the BOM section causes page-level horizontal scroll; content is readable (stacked rows or contained scroll)
- [ ] The add-BOM-line controls are usable at 390px (no broken intra-table stacking)
- [ ] BackflushDialog is fullScreen below 'sm' with stacked, tappable per-line consume inputs; behavior (clamping, skip, confirm) unchanged
- [ ] Deleting a project requires an explicit confirmation dialog
- [ ] Web tests cover: xs table/stacked rendering, fullScreen dialog at small viewport, delete-confirm flow (cancel + confirm); coverage meets the 80% threshold
<!-- AC:END -->
