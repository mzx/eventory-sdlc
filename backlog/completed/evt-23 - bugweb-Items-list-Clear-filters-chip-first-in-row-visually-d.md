---
id: EVT-23
title: 'bug(web): Items list ''Clear filters'' chip — first in row, visually distinct with X icon'
status: Done
priority: low
created_date: '2026-08-07 19:20'
updated_date: '2026-08-07 19:36'
assignee: []
labels:
  - bug
  - web
  - ui
dependencies: []
references:
  - 'https://github.com/mzx/eventory-sdlc/issues/23'
  - apps/web/src/pages/ItemsPage.tsx
---

## Problem

On the Items list (`apps/web/src/pages/ItemsPage.tsx` tag-filter row ~line 169), the "Clear filters" chip renders LAST after all tag chips (random position once the row wraps) and is styled identically to an unselected tag chip — it reads as a tag named "Clear filters", not an action.

Full context: GitHub issue #23 (operator report 2026-08-07).

## Acceptance Criteria

- [x] AC1: When any filter is active, the clear affordance renders as the FIRST element of the filter row, before all tag chips, in wrapped and unwrapped layouts.
- [x] AC2: It is visually distinct from tag chips: includes a clear/X icon and a styling treatment (color/variant) that no tag chip uses in either selected or unselected state.
- [x] AC3: Clicking it clears the text search AND the active tag (current behavior preserved); it disappears when no filters are active.
- [x] AC4: Tag chips keep their current behavior/appearance (count labels, toggle, selected=filled primary).
- [x] AC5: Component tests cover: first-position when active, icon presence, clearing both filter kinds, absence when no filter active.

## PR requirement

The PR body MUST include `Closes #23`.

## Final Summary

## Summary
Moved the Items-list "Clear filters" chip to the first position of the tag-filter row and made it visually distinct (ClearIcon + color="error" variant="outlined" — a color/variant pair no tag-chip state uses). Round 2 also fixed the row-visibility guard so the clear affordance renders in zero-tag workspaces with an active text search (`!isPhotoSearchActive && (tags.length > 0 || hasActiveFilters)`).

## Changes
- `apps/web/src/pages/ItemsPage.tsx` — clear chip rendered before `tags.map`, X icon + error/outlined styling, row guard decoupled from `tags.length`
- `apps/web/src/pages/ItemsPage.test.tsx` — 5 new tests round 1 + zero-tags/AC2-both-states/AC4-explicit tests round 2 (16 tests total)

## Design decisions
Used MUI `color="error"` + `variant="outlined"` + ClearIcon for the clear chip since tag chips only ever render default/outlined or primary/filled. Toolchain note: verification run with Node 22 (repo requires >=22; system default was 20).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (108 web + 377 api tests)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved on round 2 (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code)

## Follow-up
(none)
