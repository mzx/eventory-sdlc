---
id: EVT-43
title: 'feat(web): workspace UI — switcher, invitations, members settings'
status: Done
priority: medium
created_date: '2026-08-19 23:32'
updated_date: '2026-08-21 12:30'
assignee: []
labels:
  - tenancy
  - web
  - enhancement
dependencies:
  - EVT-41
  - EVT-42
references:
  - apps/web/src/App.tsx
  - apps/web/src/api.ts
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Tenancy exists server-side; the web app must speak it: pick a workspace,
switch, invite the household, manage members.

## Goal

- **Active-workspace state**: persisted selection (localStorage), sent as
  `X-Workspace-Id` on every API call; **all TanStack Query keys gain the
  workspace id** via a shared key factory — cache from one workspace must never
  render in another (switching isolates everything incl. badge counts)
- **Switcher**: avatar menu (desktop) + the mobile bottom-nav "More" surface
  (EVT-35 layout); list my workspaces, switch, create
- **Onboarding**: zero-membership users get create-or-redeem instead of the old
  pending page
- **Members settings** (owners): member list with roles, remove, invite
  creation with copyable link, pending-invite revoke
- **Redemption route**: `/invite/<token>` — sign-in-if-needed → redeem → land
  in the workspace
- Mobile-first per EVT-35..38 standards (44px targets, xs layouts)
- **Viewer-aware UI**: when the active membership is `viewer`, mutating
  affordances (Add item, edit/delete, consume/count, move container,
  backflush, restock, running-low) are hidden or disabled with a "read-only
  access" hint — the UI mirrors, never substitutes for, the server-side guard.
  Members settings shows a role column with owner-only member↔viewer toggle
  and role selection on invite creation

## Non-goals

- Email sending; roles beyond owner/member; per-item sharing

## Risk

- The query-key change touches every hook — a missed key leaks one workspace's
  cached data into another's UI. The shared key factory + a test asserting the
  workspace id is present in all keys is the guard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [x] Every API-bound query/mutation carries the active workspace (key factory; test asserts workspace id in all query keys; header on all requests)
- [x] Switching workspaces swaps ALL visible data with no stale flashes (test with two mocked workspaces)
- [x] Switcher in avatar menu and mobile nav; create-workspace flow works
- [x] Zero-membership onboarding replaces the pending page; redemption route works end-to-end
- [x] Members settings: invite create/copy/revoke, remove, last-owner protection surfaced; role column with owner-only member↔viewer toggle; invite role selection
- [x] Viewer sees a read-only UI: mutating affordances hidden/disabled with a hint, verified by tests rendering the same pages as viewer vs member
- [x] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented the full tenancy web surface: persisted active-workspace state with
`X-Workspace-Id` on every request and a shared query-key factory (workspace id
asserted present in all keys by test), workspace switcher in the avatar menu +
mobile "More" surface with create flow, zero-membership create-or-redeem
onboarding, `/invite/<token>` redemption route, owner Members settings
(invite create/copy/revoke, remove, last-owner protection, role column with
owner-only member↔viewer toggle, invite role selection), and viewer-aware
read-only UI gating across all mutating affordances.

Two review rounds converged on one MAJOR: the workspace-context invalidation
listener was a single nullable module slot, so any consumer's unmount broke the
403 self-heal for survivors. Fixed by a Set-backed
`addWorkspaceContextInvalidatedListener` mirroring the existing listener
stores, with module-level and React-level partial-unmount regression tests
(empirically verified to fail on the single-slot shape). Final focused review:
approved, 0 critical/major, 1 non-blocking suggestion (shared with pre-existing
listener loops). `pnpm verify` green, 400/400 web tests, coverage ≥80%.
<!-- SECTION:FINAL_SUMMARY:END -->
