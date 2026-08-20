---
id: EVT-40
title: 'feat(tenancy): tenant context + enforcement core — items, photos, storage, QR'
status: Done
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-20 13:36'
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
- **Role-aware writes (viewer role, operator decision 2026-08-20)**: the tenant
  context exposes the caller's role; ALL mutating endpoints in this task's
  modules require `owner|member` — a `viewer` gets 403 on writes and full 200
  on reads. Implement as one reusable guard/decorator, not per-endpoint ifs

## Non-goals

- Remaining modules (EVT-41); membership APIs (EVT-42); UI (EVT-43)

## Risk

- Missed scoping = data leak. Every endpoint in this PR must appear in the e2e
  isolation matrix; reviews treat any unscoped query as critical.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Tenant context resolves membership-validated workspace (header or default); non-member header → 403 (e2e)
- [x] Items endpoints: foreign ids → 404 across GET/PATCH/DELETE/consume/count/movements; own-workspace correct (e2e matrix)
- [x] Photo metadata and raw /storage requests for foreign photos → 404/403; own → 200 (e2e)
- [x] QR: member resolves; non-member gets neutral response (e2e)
- [x] Viewer-role matrix: a `viewer` member reads everything (200) but every mutating endpoint in this task's modules returns 403, via the shared write-guard (e2e)
- [x] Two-workspace isolation harness landed and documented for reuse
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Tenant context + core enforcement: request-scoped workspace resolution (X-Workspace-Id validated against memberships, 403 non-member, null for membership-less users), full scoping on items (404 for foreign resources across the endpoint matrix), photos + a new storage controller authorizing raw file serving, QR resolution neutral for non-members, the shared viewer write-guard, and the two-workspace isolation e2e harness (26 cases) that EVT-41 reuses. 34 files.

## Review history (3 rounds + fix)
- R1: 5 majors (tags cross-tenant read, unscoped locations by-qr, e2e flake, viewer-guard gaps) → fixed/dispositioned in R2 commit (tags scoping, derived in-transaction workspaceId, self-healing membership)
- R2: code ✅ / test ✅ (668 unit + 25 isolation e2e; flake confirmed pre-existing on main) / security: 2 NEW majors → cap reached, PR held draft
- Operator-directed fix (102152f): unscoped `GET /api/locations/by-qr/:qr` DELETED (grep-verified client-unused; items/by-qr covers scan-landing with membership check); `ensureDefaultWorkspaceMembership` gated on zero-memberships-anywhere (EVT-20 recovery preserved; revocation-resurrection + viewer→member upgrade closed). Security re-review ✅ — both majors verified genuinely closed
- Final verdicts: code ✅, test ✅, security ✅ (4 documented minors deferred, 2 doc-staleness suggestions)

## Verification
- `pnpm verify` green; isolation e2e 26/26 (dockerized, two-workspace matrix)
- Pre-existing projects/search-by-photo e2e failures confirmed identical on main (out of scope)
- ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable)

## OPERATIONAL CONSTRAINT (until EVT-41 + EVT-42 merge)
**Create no second workspace and assign no viewer membership** — locations list/tags read paths and shopping/projects write paths gain full scoping in EVT-41; membership lifecycle in EVT-42.

## Carry into EVT-42's ACs (security reviewer, binding)
- Pair last-membership revocation with un-approval (status != approved) or a tombstone — the zero-membership self-heal contract in default-workspace.ts:114 will otherwise resurrect the final revocation
- Remove/replace `ensureDefaultWorkspaceMembership` as part of the invitation flow
- Role demotion must handle WorkspaceRole desync

## Follow-ups (minor)
- Doc staleness: qr.service.ts:73 cites deleted findByQr; users.service.ts:34 "idempotent" now conditional
- ItemTag same-workspace invariant → schema comment (real fix: EVT-44 RLS)
- QR PNG existence oracle (@Public, UUID-bounded) → EVT-41
