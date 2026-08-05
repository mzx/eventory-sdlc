---
id: EVT-2
title: 'feat(db): core inventory domain — Prisma schema + migration for Location, Category, Tag, Item, ItemTag, Photo'
status: In Progress
labels: [db, prisma, domain]
dependencies: []
references: [PRODUCT.md, apps/api/prisma/schema.prisma]
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The API has an empty Prisma schema. Every feature task needs the core domain model.

## Goal

Add the core inventory models to `apps/api/prisma/schema.prisma` + one migration:

- **Location** — `name`, materialized-path `path` (unique, e.g. `garage.west-wall.cabinet-3`),
  self-relation `parentId` (`onDelete: SetNull`), `qrCode String @unique @default(uuid())`,
  `notes`; indexes on `parentId` and `path`.
- **Category** — same tree shape as Location (name, unique path, parent self-relation), no qrCode.
- **Tag** — unique `name`, optional `color`.
- **Item** — `name`, `description?`, `quantity Int @default(1)`, `unit?`,
  `properties Json @default("{}")` (Notion-style free-form attributes),
  `qrCode String @unique @default(uuid())`, optional `locationId`/`categoryId`
  (`onDelete: SetNull`), `primaryPhotoId?` → Photo, timestamps; indexes on
  `locationId`, `categoryId`, `name`.
- **ItemTag** — explicit join table, composite PK `[itemId, tagId]`, cascade deletes, index on `tagId`.
- **Photo** — `itemId?` (cascade on item delete), `filename`, `mimeType`, `sizeBytes`,
  `width?`, `height?`, `aiAnalysis Json?` (raw vision output kept for re-runs), timestamps.
- All ids: `String @id @default(uuid()) @db.Uuid`.

## Non-goals

- User model / ownership FKs (arrives with auth task EVT-14)
- Project + BomLine models (EVT-16)
- Any API endpoints
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] `prisma migrate dev` produces a migration that applies cleanly on a fresh compose up
- [ ] Circular Item↔Photo relation (photos list + primaryPhoto) compiles with named relations
- [ ] A seed script (`prisma/seed.ts`, wired to `prisma db seed`) creates a small location tree, a few tags, and 2–3 items for manual testing
- [ ] `docker compose up` from clean state still passes EVT-1 health checks
<!-- AC:END -->
