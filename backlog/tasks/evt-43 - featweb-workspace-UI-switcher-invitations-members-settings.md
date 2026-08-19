---
id: EVT-43
title: 'feat(web): workspace UI — switcher, invitations, members settings'
status: To Do
priority: medium
created_date: '2026-08-19 23:32'
updated_date: '2026-08-19 23:32'
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

## Non-goals

- Email sending; roles beyond owner/member; per-item sharing

## Risk

- The query-key change touches every hook — a missed key leaks one workspace's
  cached data into another's UI. The shared key factory + a test asserting the
  workspace id is present in all keys is the guard.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Every API-bound query/mutation carries the active workspace (key factory; test asserts workspace id in all query keys; header on all requests)
- [ ] Switching workspaces swaps ALL visible data with no stale flashes (test with two mocked workspaces)
- [ ] Switcher in avatar menu and mobile nav; create-workspace flow works
- [ ] Zero-membership onboarding replaces the pending page; redemption route works end-to-end
- [ ] Members settings: invite create/copy/revoke, remove, last-owner protection surfaced
- [ ] `pnpm verify` green; coverage meets the 80% threshold
<!-- AC:END -->
