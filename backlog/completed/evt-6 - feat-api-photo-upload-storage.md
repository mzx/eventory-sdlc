---
id: EVT-6
title: 'feat(api): photo upload + local storage — multipart upload, static serving, Photo rows'
status: Done
labels: [api, photos, storage]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: high
updated_date: '2026-08-06 10:52'
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
- [x] Upload test: multipart PNG → 201 with url; GET that url returns the bytes with correct content-type
- [x] Oversized (>20 MB) and wrong-type files rejected with 400/415
- [x] width/height populated for a real test image
- [x] `docker compose down && up` — previously uploaded file still served (volume works)
<!-- AC:END -->

## Final Summary

## Summary
Added PhotosModule to apps/api: `POST /api/photos/upload` (multipart jpeg/png/webp/heic, 20 MB max, uuid filename, sharp width/height, optional `itemId` link, returns Photo row + public url), `GET /api/photos/:id`, and Express static serving of `GET /storage/<filename>` with `X-Content-Type-Options: nosniff`. Storage dir is the `eventory-photo-storage` Docker named volume so uploads survive container rebuilds. `?analyze=true` is accepted and returns `aiAnalysis: null` (EVT-7 fills it in).

## Changes
- `apps/api/src/photos/photos.module.ts` — new PhotosModule wiring
- `apps/api/src/photos/photos.controller.ts` — upload + metadata endpoints, inline UploadPhotoDto
- `apps/api/src/photos/photos.service.ts` — disk storage, sharp content validation, Photo row creation, orphan-file unlink on failure paths
- `apps/api/src/photos/photo-upload.helpers.ts` — multer options (tight fileSize/files/fields/fieldSize/parts limits), 413→400 remap filter, hard-fail extension mapping
- `apps/api/src/app.module.ts`, `apps/api/src/main.ts` — module registration + static serving with nosniff
- `apps/api/src/photos/*.spec.ts`, `apps/api/test/photos.e2e-spec.ts` — unit + e2e coverage (real PNG round-trip, oversized→400, wrong-type→415, decode-rejection, no-orphan-file)
- `docker-compose.yml` — `eventory-photo-storage` named volume mount
- `.gitignore`, `apps/api/storage/.gitkeep` — storage dir ignored, kept
- `apps/api/package.json`, `pnpm-lock.yaml` — multer@2.0.2, sharp@0.35.3, @types/multer

## Design decisions
Photo model already existed from EVT-2 — no new migration. Multer's LIMIT_FILE_SIZE 413 is remapped to 400 per AC2. Uploads whose bytes sharp cannot decode as the declared type are rejected (documented HEIC/HEIF carve-out — this libvips build cannot decode HEVC-compressed iPhone HEIC). image/heif gets a distinct `.heif` extension. Orphaned files are unlinked on decode-rejection and DB-error paths.

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 2 parallel reviews approved after 2 iterations (classifier scoped to [security, critic]; test-reviewer auto-approved by classifier) — ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable, fell back to claude-code)

## Follow-up
Security minors deferred (consistent with no-auth app stage): residual orphan path when ValidationPipe rejects `itemId` after multer writes the file; HEIC carve-out permits arbitrary bytes declared image/heic (nosniff + forced extension block XSS; magic-byte check suggested); no rate limit/quota on unauthenticated upload — revisit when auth (EVT-8+) lands.
