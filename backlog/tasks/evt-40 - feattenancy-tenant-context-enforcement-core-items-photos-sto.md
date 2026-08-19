---
id: EVT-40
title: 'feat(tenancy): tenant context + enforcement core — items, photos, storage, QR'
status: To Do
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-19 23:32'
assignee: []
labels:
  - tenancy
  - api
  - security
  - enhancement
dependencies:
  - EVT-39
references:
  - apps/api/src/items/items.service.ts
  - apps/api/src/photos/photos.service.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

After EVT-39 the schema is workspace-aware but every request still operates on
the default workspace. Build the per-request tenant context and enforce
isolation on the highest-risk surfaces: items, photos, file storage, QR.

## Goal

- **Tenant context**: request-scoped provider resolving the active workspace —
  `X-Workspace-Id` header validated against the caller's memberships, default
  = the user's first workspace. 403 for a non-member workspace. Exposed as a
  Nest injectable (same pattern as `@CurrentUser()`)
- **Items module**: every query/write scoped; foreign items resolve as 404
  (don't confirm existence)
- **Photos + storage serving**: photo metadata AND the `/storage/...` file
  route authorize against the photo's workspace — the guessed-URL surface
- **QR scan-landing**: token lookup stays global (physical labels) but returns
  the resource ONLY to members of its workspace; neutral not-found otherwise
- **Isolation e2e harness**: dockerized suite seeding TWO workspaces; every
  endpoint touched here proven 404/403-for-foreign + correct-for-own; harness
  reused by EVT-41
- StockMovement writes on these paths inherit the item's workspace (asserted)

## Non-goals

- Remaining modules (EVT-41); membership APIs (EVT-42); UI (EVT-43)

## Risk

- Missed scoping = data leak. Every endpoint in this PR must appear in the e2e
  isolation matrix; reviews treat any unscoped query as critical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Tenant context resolves membership-validated workspace (header or default); non-member header → 403 (e2e)
- [ ] Items endpoints: foreign ids → 404 across GET/PATCH/DELETE/consume/count/movements; own-workspace correct (e2e matrix)
- [ ] Photo metadata and raw /storage requests for foreign photos → 404/403; own → 200 (e2e)
- [ ] QR: member resolves; non-member gets neutral response (e2e)
- [ ] Two-workspace isolation harness landed and documented for reuse
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
