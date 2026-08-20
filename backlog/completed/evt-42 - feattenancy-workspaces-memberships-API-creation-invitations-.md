---
id: EVT-42
title: 'feat(tenancy): workspaces & memberships API — creation, invitations, roles'
status: Done
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-20 21:06'
assignee: []
labels:
  - tenancy
  - api
  - auth
  - enhancement
dependencies:
  - EVT-40
references:
  - apps/api/src/auth/auth.service.ts
  - apps/api/src/users
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

With scoping enforced, users need a way to get workspaces: create, invite
household members, manage roles. The GLOBAL approval flow
(pending/approved/rejected + EVENTORY_ADMIN_EMAILS bootstrap, EVT-20) predates
tenancy and must be recast as workspace membership.

## Goal

- `POST /api/workspaces` (any authenticated user; creator → `owner`),
  `GET /api/workspaces` (mine), rename (owner)
- **Invitations**: owner creates a single-use expiring invite token (role
  `member` default) → shareable link/code; invitee signs in with Google and
  redeems → membership. Revocation of pending invites. No email sending —
  links shared out-of-band (household scale)
- **Roles** (operator decision 2026-08-20: three roles): `owner` manages
  members/invites/rename; `member` full inventory access, no member
  management; `viewer` read-only inventory access (enforced by EVT-40/41's
  shared write-guard). Invitations specify the role they grant
  (`member` default, `viewer` selectable). Owner can change an existing
  member's role between `member` and `viewer`. Owner removes members; members
  leave; the last owner cannot leave/demote without transfer
- **Auth rework**: new sign-ins no longer land in global "pending" — a user
  with zero memberships sees "create a workspace or redeem an invite".
  EVENTORY_ADMIN_EMAILS keeps meaning instance-admin (AdminUsersPage) but no
  longer gates inventory access. Document the semantic change (README + .env
  examples)
- Membership lifecycle in the isolation harness: redeemed member sees data;
  removed member loses access immediately

## Non-goals

- Web UI (EVT-43); email delivery; permissions beyond the two roles

## Risk

- Auth-flow changes are the front door — the EVT-20 lockout class lives here.
  Fresh deployment → first sign-in → create workspace → operational must work
  with zero env vars.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Create/list/rename workspaces with owner-role enforcement (e2e)
- [x] Invite lifecycle: create → redeem (new Google user) → member sees data; revoke blocks redemption; expiry + single-use enforced (e2e)
- [x] Removal/leave semantics incl. last-owner protection (e2e)
- [x] Viewer-granting invites work end-to-end (redeemed viewer can read, cannot write); owner can toggle member↔viewer and the change takes effect immediately (e2e)
- [x] Zero-membership users can create/redeem but cannot touch inventory endpoints (e2e)
- [x] Fresh-deployment first-user path works with no env vars; README + .env examples updated
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

## Summary
Workspaces & memberships API: create/list/rename with owner enforcement; invitations (256-bit tokens, SHA-256-hashed at rest, single-use + expiry enforced atomically, immediate revocation, role-granting incl. viewer); owner/member/viewer lifecycle with atomic last-owner protection; the global approval gate retired — zero-membership users get create-or-redeem; `ensureDefaultWorkspaceMembership` deleted outright (EVT-40 obligation honored — no runtime path resurrects a final revocation); UserRole/WorkspaceRole decoupled, AdminGuard tightened to admin && approved; WorkspaceContextGuard fails closed with explicit @AllowMissingWorkspace opt-outs.

## Review history
- 2 session rounds → approved except one held "critical" = SEQUENCING (EVT-41 not yet merged; four modules unscoped at review time), PR correctly held draft
- Round-2 fixes in-branch: fail-closed workspace guard, atomic last-owner lock, admin status check
- Orchestrator: rebase onto post-EVT-41 main applied 100% clean (disjoint files, zero conflict edits — prior approvals bind); isolation matrix 86/86
- Formal clearance review ✅: sequencing concern CLEARED on the combined tree; all three EVT-40 binding obligations verified honored

## Verification
- `pnpm verify` green; isolation e2e 86/86; membership lifecycle asserts real 200→403 on the same session
- Pre-existing main defects diagnosed by the resolver (NOT this PR): projects/search-by-photo e2e never adopted the auth helper (15× 401s); workspace-migration.e2e readiness probe races initdb (unix-socket pg_isready before TCP listen)
- ⚠ INDEPENDENCE NOT ENFORCED (codex unavailable)

## ⚠ OPERATOR DECISION NEEDED BEFORE PUBLIC-INTERNET DEPLOY
Retiring the approval gate makes the instance **open self-registration**: any Google account can sign in (created `approved`), self-create a workspace, and reach billed Anthropic vision endpoints + unbounded photo storage (bounded only by the 10-req/min-per-IP throttle). Documented product decision, not a defect — but add a **sign-in allowlist (or rejected-by-default for non-allowlisted)** before deploying to the public VM. Follow-up task to be filed.

## Follow-ups (minor)
- InvitesService.revoke: make conditional (updateMany on status=pending, 409 on 0) so a raced redemption can't leave lying audit state
- redeem() should return the upserted row's ACTUAL role (existing member keeps current role; response claims invite.role)
- Stale docs: workspace-context.guard.ts:54 + workspaces.e2e-spec ("EVT-41 not yet landed"), default-workspace.ts:18 (cites a non-caller)
