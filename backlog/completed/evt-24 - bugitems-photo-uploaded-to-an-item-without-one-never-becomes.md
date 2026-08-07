---
id: EVT-24
title: 'bug(items): photo uploaded to an item without one never becomes primary — item stays imageless in the list'
status: Done
priority: medium
created_date: '2026-08-07 19:20'
updated_date: '2026-08-07 19:20'
assignee: []
labels:
  - bug
  - api
  - web
  - photos
dependencies: []
references:
  - 'https://github.com/mzx/eventory-sdlc/issues/24'
  - apps/api/src/photos/photos.service.ts
  - apps/web/src/pages/EditItemPage.tsx
---

## Problem

The items list renders thumbnails exclusively from `primaryPhoto`, but nothing sets `primaryPhotoId` when a photo is uploaded to an item that has none: the API upload path (`apps/api/src/photos/photos.service.ts`) attaches the Photo without touching `primaryPhotoId`, and `EditItemPage`'s upload mutation only invalidates the item detail query — set-primary is a separate manual mutation. Flow "create item photo-skipped → edit → upload image" leaves the item permanently imageless in the list (photo visible on detail/edit only).

Full reproduction: GitHub issue #24 (hit in real usage 2026-08-07).

## Acceptance Criteria

- [ ] AC1: When a photo is uploaded for an item that currently has no `primaryPhotoId`, it automatically becomes the primary photo — enforced API-side in the upload path so every client inherits the behavior.
- [ ] AC2: Uploading additional photos to an item that already has a primary does NOT change the existing primary.
- [ ] AC3: Existing behavior preserved: deleting the primary still clears `primaryPhotoId` via schema `SetNull`; manual set-primary still works. Auto-promotion of a remaining photo after primary deletion is optional — document whichever behavior ships.
- [ ] AC4: After an upload on the edit page, the items LIST reflects the new thumbnail without a full reload (list query invalidated alongside detail).
- [ ] AC5: Tests: API first-upload-becomes-primary and second-upload-doesn't-steal-primary; web test that the list query invalidates after upload.

## PR requirement

The PR body MUST include `Closes #24`.
