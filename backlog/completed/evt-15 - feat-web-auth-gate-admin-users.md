---
id: EVT-15
title: 'feat(web): auth gate — login/pending/rejected pages, user menu, admin users page'
status: Done
labels: [web, auth, admin]
dependencies: [EVT-14, EVT-9]
references: [PRODUCT.md]
priority: medium
updated_date: '2026-08-07 07:16'
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
- [x] Signed-out visit to any route shows LoginPage without flashing app content
- [x] Pending user sees PendingPage; after approval + refresh they land in the app
- [x] Admin sees Users page and can approve a pending user; non-admin gets no menu entry and `/admin/users` redirects home
- [x] Logout clears state and returns to LoginPage
<!-- AC:END -->

## Final Summary

## Summary
Implemented the auth gate for the web app: AuthContext loads /api/auth/me once at boot and exposes {user, loading, refresh}; AuthGate renders LoginPage/PendingPage/RejectedPage in place of the app shell for signed-out/pending/rejected users so no route ever flashes app content; added an AppBar UserMenu (avatar, name, logout, admin-only Admin>Users entry) and an AdminUsersPage with approve/reject and role-toggle actions via optimistic TanStack mutations; wired a 401/403 listener in api.ts so any failed request re-checks auth state.

## Changes
- `apps/web/src/auth/AuthContext.tsx` — new: loads GET /api/auth/me once at boot, exposes { user, loading, refresh }
- `apps/web/src/auth/AuthGate.tsx` (+ test) — new: routes loading → spinner, signed-out → LoginPage, pending → PendingPage, rejected → RejectedPage, approved → app
- `apps/web/src/pages/LoginPage.tsx` / `PendingPage.tsx` / `RejectedPage.tsx` — new auth-state pages
- `apps/web/src/components/UserMenu.tsx` — new: AppBar avatar/name/logout menu with admin-only Admin→Users entry
- `apps/web/src/pages/AdminUsersPage.tsx` (+ test) — new: /admin/users table with approve/reject + role toggle via optimistic TanStack mutations
- `apps/web/src/api.ts` — 401/403 listener triggering auth re-check; auth/user API helpers
- `apps/web/src/App.tsx` (+ test), `apps/web/src/main.tsx` — wiring: AuthProvider/AuthGate, /admin/users route with non-admin redirect home

## Design decisions
Sign-in/sign-out use full-page navigations to GET /api/auth/google and GET /api/auth/logout, matching the API's cookie-based session flow — no client-side token handling. Client-side admin gating is UX-only; authorization is enforced server-side (JwtAuthGuard + AdminGuard, verified during security review).

## Verification
- `pnpm build` — passed
- `pnpm test` — passed
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved (⚠ INDEPENDENCE NOT ENFORCED — codex unavailable, fell back to claude-code for all reviewers)

## Follow-up
Reviewer minors/suggestions (non-blocking): add tests for optimistic-update/rollback paths and reject/role-toggle success paths in AdminUsersPage; fix misleading comment on fetchCurrentUser re notifyIfAuthFailure; consider narrowing the global 403 auth-refresh trigger to 401 + /auth/* 403s; consider making logout a POST (pre-existing EVT-14 behaviour).
