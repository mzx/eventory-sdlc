---
id: EVT-35
title: 'feat(web): mobile navigation — bottom nav at phone widths'
status: In Progress
priority: high
created_date: '2026-08-14 14:39'
updated_date: '2026-08-14 18:58'
assignee: []
labels:
  - web
  - mobile
  - enhancement
dependencies: []
references:
  - apps/web/src/App.tsx
  - apps/web/src/theme.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The AppBar Toolbar (App.tsx:86) holds the title + 5 text buttons (Scan, Projects,
Shopping List, Verification, Locations) + "Add item" + avatar in one non-wrapping
flex row with zero breakpoint handling (`useMediaQuery` count in the app: 0). With
the theme's mono/uppercase/letterSpacing button font the row needs ~750–850px; at
~390px the buttons crush into multi-line fragments and/or overflow — the
Verification and Shopping List badge buttons, core to the workshop loop, become
effectively unreachable on the phone this app is built for. (2026-08-14 mobile
audit, finding #1 — highest user impact.)

## Goal

At the xs/sm breakpoint, collapse navigation into a **bottom navigation bar**
(best for one-handed workshop use): Items / Scan / Add / Shopping / More —
with the Shopping List and Verification counts as `Badge`s on the bottom-nav
icons, and the "More" item opening the remaining destinations (Projects,
Locations, Verification if not promoted). The AppBar keeps only title + avatar
at xs. Desktop (md+) keeps the current toolbar unchanged.

## Non-goals

- Redesigning desktop nav
- New routes or renaming destinations

## Risk

- The bottom nav must not overlap page content (reserve bottom padding on the
  Container at xs) and must respect iOS safe-area insets
  (`env(safe-area-inset-bottom)`) in standalone PWA mode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] At xs/sm the AppBar shows only title + avatar; a fixed bottom navigation renders with ≥44px touch targets and badge counts for shopping list + verification
- [ ] All current destinations remain reachable at phone width (directly or via More)
- [ ] Desktop (md+) toolbar is visually unchanged
- [ ] Page content is never obscured by the bottom nav (bottom padding at xs; safe-area inset respected)
- [ ] Web tests cover: bottom nav renders at xs (via viewport/matchMedia mock), badges show counts, desktop toolbar unchanged; coverage meets the 80% threshold
<!-- AC:END -->
