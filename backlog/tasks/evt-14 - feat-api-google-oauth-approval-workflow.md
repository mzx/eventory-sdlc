---
id: EVT-14
title: 'feat(api): auth — Google OAuth + JWT cookie, user approval workflow (pending/approved/rejected), admin endpoints'
status: To Do
labels: [api, auth, users]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The API is wide open. The original gates everything behind Google sign-in with an
operator-approval step (household members get approved by the admin).

## Goal

- Migration: `User` model — email (unique), name, picture, googleId (unique),
  `status` enum `pending|approved|rejected` (default pending), `role` enum `user|admin`,
  approvedAt/approvedById (self-relation), lastLoginAt; add nullable `createdById` to
  Item and `uploadedById` to Photo (SetNull).
- `AuthModule` (passport): `GET /api/auth/google` → Google redirect;
  `GET /api/auth/google/callback` → upsert user by googleId/email, first-ever user
  becomes `admin` + `approved`, sign JWT (`@nestjs/jwt`), set httpOnly SameSite=Lax
  secure cookie, then redirect: pending → `${WEB_BASE}/pending`, rejected →
  `${WEB_BASE}/rejected`, approved → `${WEB_BASE}`.
- `GET /api/auth/me` — always public; returns user from cookie or `null` (never 401).
- `GET /api/auth/logout` — clears cookie, redirects to web base.
- Global `JwtAuthGuard`: everything requires an APPROVED user by default. Decorators:
  `@Public()` (health, auth routes, `GET /api/qr/:token`), `@AllowPending()` (`/auth/me`).
  `AdminGuard` for admin-only routes.
- `UsersModule` (admin-only): `GET /api/users`, `PATCH /api/users/:id/status`
  (approve/reject, stamps approvedBy/At), `PATCH /api/users/:id/role`. Admin cannot
  demote or reject themself.
- Item create / photo upload now stamp `createdById` / `uploadedById` from the JWT.
- Env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`, `JWT_SECRET`,
  `WEB_BASE`. All documented in `.env.example`; secrets NEVER committed (operator holds
  real values — see original project's OAuth client).

## Non-goals

- Web UI for auth (EVT-15), refresh tokens/sessions table, non-Google providers
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] Tests (mock Google profile): first user → admin approved; second → pending and blocked from `/api/items` (403) but allowed `/auth/me`; after admin approves → allowed
- [ ] Cookie is httpOnly + secure; `/auth/me` with no/invalid cookie → `null`, 200
- [ ] Admin endpoints reject non-admins; self-demotion/self-rejection rejected
- [ ] `GET /api/qr/:token` remains public (native camera scan hits it unauthenticated)
- [ ] e2e guard sweep: every route except the @Public list returns 401/403 without a cookie
<!-- AC:END -->
