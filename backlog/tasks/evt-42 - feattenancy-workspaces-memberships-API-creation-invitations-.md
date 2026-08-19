---
id: EVT-42
title: 'feat(tenancy): workspaces & memberships API — creation, invitations, roles'
status: To Do
priority: high
created_date: '2026-08-19 23:32'
updated_date: '2026-08-19 23:32'
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
- **Roles**: `owner` manages members/invites/rename; `member` full inventory
  access, no member management. Owner removes members; members leave; the
  last owner cannot leave/demote without transfer
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
- [ ] Create/list/rename workspaces with owner-role enforcement (e2e)
- [ ] Invite lifecycle: create → redeem (new Google user) → member sees data; revoke blocks redemption; expiry + single-use enforced (e2e)
- [ ] Removal/leave semantics incl. last-owner protection (e2e)
- [ ] Zero-membership users can create/redeem but cannot touch inventory endpoints (e2e)
- [ ] Fresh-deployment first-user path works with no env vars; README + .env examples updated
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
