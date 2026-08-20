---
id: EVT-45
title: 'feat(auth): sign-in allowlist — close open self-registration before public deploys'
status: Done
priority: high
updated_date: '2026-08-21'
labels:
  - auth
  - security
  - tenancy
dependencies: []
references:
  - apps/api/src/auth/auth.service.ts
  - apps/api/src/workspace/workspaces.service.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

EVT-42 retired the global approval gate (by design): any Google account can now
sign in (created `approved`), self-create a workspace, and immediately reach
billed Anthropic vision endpoints (`POST /api/photos/upload?analyze=true`,
`POST /api/items/search-by-photo`) plus unbounded on-disk photo storage —
bounded only by the 10-req/min-per-IP throttle. On the public VM this is an
open invitation to burn the operator's Anthropic budget and disk (EVT-42
clearance review, flagged for operator decision 2026-08-21).

**This task gates the next production deploy** — the tenancy stack should not
ship to the public internet with open registration.

## Goal

- `EVENTORY_ALLOWED_SIGNINS` env: comma-separated emails and/or `@domain.com`
  entries. Non-allowlisted Google sign-ins are refused at the OAuth callback
  with a clear "this instance is invite-only" page — no User row persisted
  (or persisted as `rejected` if a row is needed for audit; implementer's
  choice, documented)
- **Invited users pass**: redeeming a valid invitation token authorizes the
  sign-in even when not allowlisted (the invite IS the authorization) — the
  `/invite/<token>` flow must keep working for household members
- **Bootstrap preserved**: when the instance has zero users, the first
  sign-in is allowed regardless (fresh-deploy path, EVT-20 lesson) — and
  becomes instance admin per existing rules
- Unset/empty var: keep current open behavior BUT log a prominent startup
  warning ("open self-registration — set EVENTORY_ALLOWED_SIGNINS for
  public deployments"); document in README + both .env examples +
  docker-compose.prod.yml env passthrough (the EVT-20 lesson: env vars that
  aren't plumbed through prod compose silently do nothing)

## Also fix (same area, from the EVT-42 clearance review)

- `InvitesService.revoke`: conditional `updateMany({ where: { id, workspaceId,
  status: 'pending' } })`, 409 on count 0 — a raced redemption must not leave
  a revoked-but-redeemed audit state
- `redeem()` returns the upserted membership's ACTUAL role (existing member
  keeps their role; the response currently claims `invite.role`)
- Stale docs: workspace-context.guard.ts (~54) + workspaces.e2e-spec "EVT-41
  not yet landed"; default-workspace.ts (~18) cites TagsService as a caller —
  it is not

## Non-goals

- CAPTCHA/abuse scoring; per-workspace quotas (future); changing throttles
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Non-allowlisted Google sign-in refused at callback with the invite-only page; no usable session; e2e-covered
- [x] Allowlisted email and `@domain` entries both admit; invited users admit via token regardless of allowlist; zero-user bootstrap admits (all e2e)
- [x] Unset var keeps current behavior with a startup warning; README + .env examples + prod compose updated (env actually plumbed — the EVT-20 check)
- [x] Invite revoke is conditional (409 on already-redeemed); redeem returns the actual role; both tested
- [x] Stale doc references corrected
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
`EVENTORY_ALLOWED_SIGNINS` sign-in allowlist enforced at the Google OAuth callback for brand-new sign-ins only (existing accounts always re-admit; tightening the list never locks out provisioned users). Comma-separated exact emails and `@domain` entries, matched case-insensitively as exact sets (no substring/suffix matching — `evil-domain.com` does not match `@domain.com`). Three carve-outs always admit: zero-user bootstrap (fresh-deploy path), `EVENTORY_ADMIN_EMAILS`, and a valid pending WorkspaceInvite token forwarded through the OAuth `state` parameter (`GET /api/auth/google?invite=<token>` — validated, not redeemed, at sign-in time; the invite IS the authorization). A refused sign-in renders a self-contained static invite-only 403 page: no cookie, no redirect, no User row (creation throw rolls back inside the transaction). Unset/empty var keeps pre-EVT-45 open registration but logs a prominent boot warning; documented in README + both .env examples and plumbed through docker-compose.prod.yml (the EVT-20 check). Also, per the EVT-42 clearance review: `InvitesService.revoke` is now a conditional `updateMany` (409 when a raced redemption already consumed the invite), `redeem()` returns the upserted membership's actual role, and the stale doc references in workspace-context.guard.ts, workspaces.e2e-spec.ts, and default-workspace.ts were corrected.

## Review history
- 1 round → all 3 reviewers approved (0 critical, 0 major; 6 minor, 4 suggestions). ⚠ Independence not enforced — codex unavailable, all reviewers ran claude-code.
- Notable non-blocking findings (follow-up candidates): a still-pending invite token is validated but never consumed at sign-in, so one leaked link admits unlimited non-allowlisted accounts until redeemed/expired (single-use sign-in grant or email-binding suggested); raw invite token now travels in URL query strings on both OAuth legs (CWE-598 — consider log scrubbing or an opaque handle); `EVENTORY_ALLOWED_SIGNINS` not plumbed into local-dev docker-compose.yml; `EVENTORY_ADMIN_EMAILS` missing from prod compose (pre-existing, same bug class); zero-user bootstrap count is unlocked under READ COMMITTED (pre-existing EVT-20 race, now also gating the allowlist bypass).

## Verification
- `pnpm build` / `pnpm test` / `pnpm lint` / `pnpm format:check` — all passed
- Coverage: auth 98.5% lines / 94% branches, workspace ≥98% (gate: 80%)
- Test reviewer independently re-ran unit (109 passed) + auth/workspaces e2e (53 passed) suites against the isolated Postgres instance
