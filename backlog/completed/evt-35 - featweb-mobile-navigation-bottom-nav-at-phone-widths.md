---
id: EVT-35
title: 'feat(web): mobile navigation — bottom nav at phone widths'
status: Done
priority: high
created_date: '2026-08-14 14:39'
updated_date: '2026-08-14 23:47'
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
- [x] At xs/sm the AppBar shows only title + avatar; a fixed bottom navigation renders with ≥44px touch targets and badge counts for shopping list + verification
- [x] All current destinations remain reachable at phone width (directly or via More)
- [x] Desktop (md+) toolbar is visually unchanged
- [x] Page content is never obscured by the bottom nav (bottom padding at xs; safe-area inset respected)
- [x] Web tests cover: bottom nav renders at xs (via viewport/matchMedia mock), badges show counts, desktop toolbar unchanged; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Bottom navigation at phone widths: at xs/sm the AppBar collapses to title + avatar and a fixed bottom nav (Items / Scan / Add / Shopping / More) renders with ≥44px targets, Badge counts for shopping list + verification, safe-area-inset padding, and reserved content padding; desktop (md+) toolbar unchanged.

## Review history
- Session: 2 review rounds → fully approved (0 findings); aborted cleanly at Step 10.5 on the known `setup.ts` semantic conflict (EVT-35 vs EVT-36 opposite matchMedia defaults)
- Orchestrator: sanctioned query-aware stub (`matches: /min-width/.test(query)`) merged both semantics; full web suite 299/299; focused post-rebase review approved (1 suggestion: docstring caveat for future `only()`/`between()` breakpoint forms)

## Verification
- `pnpm verify` all green at rebased head 4c5b436; web suite 299/299 (29 files)
- Reviews: 3/3 approved (rounds 1-2) + post-rebase focused pass ✅; ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable)

## Follow-up
- Docstring caveat in setup.ts/mockMatchMedia.ts: regex classification only handles up()/down() query shapes; only()/between()/orientation queries would need a smarter stub
