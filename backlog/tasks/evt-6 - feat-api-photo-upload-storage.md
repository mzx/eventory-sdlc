---
id: EVT-6
title: 'feat(api): photo upload + local storage — multipart upload, static serving, Photo rows'
status: To Do
labels: [api, photos, storage]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Photo-first intake is the core UX; there is nowhere to put photos.

## Goal

`PhotosModule`:

- `POST /api/photos/upload` — multipart (`file` field). Accept jpeg/png/webp/heic, max 20 MB.
  Store on disk under `apps/api/storage/` with a uuid filename preserving extension.
  Create a `Photo` row (filename, mimeType, sizeBytes, width/height via `sharp` metadata).
  Optional `itemId` form field links it immediately. Returns the Photo row + public `url`.
- Serve `GET /storage/<filename>` as static files (NestJS `ServeStaticModule` or express static).
- `GET /api/photos/:id` — metadata row.
- Storage dir is a Docker volume so photos survive container rebuilds; `.gitignore`d.
- `?analyze=true` query param is ACCEPTED but returns `aiAnalysis: null` for now — EVT-7 fills it in.

## Non-goals

- Claude vision analysis (EVT-7), thumbnails/resizing pipeline, S3/remote storage
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Upload test: multipart PNG → 201 with url; GET that url returns the bytes with correct content-type
- [ ] Oversized (>20 MB) and wrong-type files rejected with 400/415
- [ ] width/height populated for a real test image
- [ ] `docker compose down && up` — previously uploaded file still served (volume works)
<!-- AC:END -->
