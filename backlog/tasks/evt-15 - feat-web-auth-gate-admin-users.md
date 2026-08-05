---
id: EVT-15
title: 'feat(web): auth gate — login/pending/rejected pages, user menu, admin users page'
status: To Do
labels: [web, auth, admin]
dependencies: [EVT-14, EVT-9]
references: [PRODUCT.md]
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

EVT-14 locks the API; the web app must route users through sign-in and approval states.

## Goal

- `AuthContext` — loads `GET /api/auth/me` once at boot; exposes `{ user, loading, refresh }`.
- `AuthGate` wrapper: loading spinner → not signed in → **LoginPage** ("Sign in with
  Google" button → `/api/auth/google`); `status=pending` → **PendingPage** ("waiting for
  approval", refresh + logout); `rejected` → **RejectedPage**; approved → app.
- AppBar user menu: avatar (picture), name, logout; **Admin → Users** entry visible to admins.
- **AdminUsersPage** (`/admin/users`): table of users (avatar, email, status, role,
  last login), approve/reject buttons, role toggle; optimistic updates via TanStack mutations.
- 401/403 from any API call → refresh auth state (session expiry lands on LoginPage).

## Non-goals

- Profile editing, email notifications on approval
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Signed-out visit to any route shows LoginPage without flashing app content
- [ ] Pending user sees PendingPage; after approval + refresh they land in the app
- [ ] Admin sees Users page and can approve a pending user; non-admin gets no menu entry and `/admin/users` redirects home
- [ ] Logout clears state and returns to LoginPage
<!-- AC:END -->
