---
id: EVT-22
title: 'feat(web): intake flow — allow choosing an existing image as an alternative to camera capture'
status: Done
priority: medium
created_date: '2026-08-07 19:20'
updated_date: '2026-08-07 19:34'
assignee: []
labels:
  - enhancement
  - web
  - intake
dependencies: []
references:
  - 'https://github.com/mzx/eventory-sdlc/issues/22'
  - apps/web/src/pages/IntakePage.tsx
---

## Problem

The intake photo input (`apps/web/src/pages/IntakePage.tsx` ~line 254) is a single `<input type="file" accept="image/*" capture="environment">`. On phones, `capture="environment"` forces the rear camera — there is no way to pick an existing photo from the gallery/files. The operator should be able to add items from photos they already have.

Full context: GitHub issue #22 (operator request 2026-08-07).

## Acceptance Criteria

- [x] AC1: The intake photo step offers BOTH paths as distinct affordances: "Take photo" (camera capture, keeps `capture="environment"` on mobile) and "Choose image" (gallery/file picker — input WITHOUT the `capture` attribute).
- [x] AC2: A chosen existing image flows through the identical downstream pipeline as a captured one (upload via `POST /api/photos/upload?analyze=…`, AI draft prefill, confirm/edit, save with QR) — no separate code path beyond input acquisition.
- [x] AC3: Both affordances work on desktop without erroring or duplicating uploads.
- [x] AC4: The existing "skip photo / manual entry" path is unchanged.
- [x] AC5: Component tests: choosing a file via the non-capture input triggers upload + draft flow; the capture input still carries `capture="environment"`.
- [x] AC6: Non-image / oversized selections surface the existing error UI, not a blank state.

## PR requirement

The PR body MUST include `Closes #22`.

## Final Summary

## Summary
Added a "Choose image" affordance to the intake photo step (hidden file input WITHOUT `capture`) alongside the existing "Take photo" camera-capture input (which keeps `capture="environment"`). Both inputs share a single `handleFileSelected` handler feeding the identical upload → AI draft → confirm → save pipeline.

## Changes
- `apps/web/src/pages/IntakePage.tsx` — second hidden file input + "Choose image" button; shared onChange handler extracted; no separate downstream code path.
- `apps/web/src/pages/IntakePage.test.tsx` — distinct camera/gallery input helpers; new tests for the capture-attribute distinction, gallery-input upload + draft flow, and error UI on upload failure. 8/8 tests pass.

## Design decisions
Input acquisition is the only divergence point (AC2): both inputs call the same handler, so upload, AI-draft prefill, confirm/edit, and QR save are untouched. Skip-photo/manual path unchanged (AC4).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (8/8)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code). 0 critical, 0 major, 1 minor, 4 suggestions.

## Follow-up
- (minor, test-reviewer) No test exercises the visible-button → hidden-input onClick wiring; a swapped-handler regression would not be caught.
- (suggestion, security-reviewer) Consider a client-side `file.size` fail-fast guard before upload for gallery selections.
