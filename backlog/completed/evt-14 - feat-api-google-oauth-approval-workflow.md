---
id: EVT-14
title: 'feat(api): auth — Google OAuth + JWT cookie, user approval workflow (pending/approved/rejected), admin endpoints'
status: Done
labels: [api, auth, users]
dependencies: [EVT-2]
references: [PRODUCT.md]
priority: medium
updated_date: '2026-08-06 18:42'
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
- [x] Tests (mock Google profile): first user → admin approved; second → pending and blocked from `/api/items` (403) but allowed `/auth/me`; after admin approves → allowed
- [x] Cookie is httpOnly + secure; `/auth/me` with no/invalid cookie → `null`, 200
- [x] Admin endpoints reject non-admins; self-demotion/self-rejection rejected
- [x] `GET /api/qr/:token` remains public (native camera scan hits it unauthenticated)
- [x] e2e guard sweep: every route except the @Public list returns 401/403 without a cookie
<!-- AC:END -->

## Final Summary

## Summary
Implemented Google OAuth + JWT httpOnly-cookie auth with an admin-approval workflow (pending/approved/rejected): new User model + Prisma migration, global JwtAuthGuard with @Public/@AllowPending carve-outs, AdminGuard, AuthModule (google/callback/me/logout), admin-only UsersModule (list/approve/reject/promote with self-demotion/self-rejection blocked), and createdById/uploadedById stamping on item/photo creation.

## Changes
- `apps/api/prisma/schema.prisma` + migration — User model (status/role enums, approvedBy self-relation), Item.createdById, Photo.uploadedById
- `apps/api/src/auth/*` — AuthModule: GoogleStrategy (verified-email-only), AuthService (googleId-first matching, no googleId rebinding, first-user-admin in $transaction, production JWT-secret fail-fast), JwtAuthGuard, AdminGuard, @Public/@AllowPending decorators
- `apps/api/src/users/*` — admin-only UsersModule with status/role PATCH endpoints and self-demotion/self-rejection guards
- `apps/api/src/common/cors.config.*` — CORS origin allowlist (WEB_BASE + dev Vite origins) extracted side-effect-free with direct unit tests
- `apps/api/src/items/*`, `apps/api/src/photos/*` — ownership stamping from JWT
- `apps/api/src/main.ts`, `app.module.ts`, `health/`, `qr/` — global guard wiring, @Public carve-outs
- `apps/api/test/*` — auth e2e suite incl. route-table-derived guard sweep (DiscoveryService), e2e auth helper, updated items/photos e2e
- `apps/api/.env.example` — GOOGLE_CLIENT_ID/SECRET, GOOGLE_CALLBACK_URL, JWT_SECRET, WEB_BASE (placeholders only)

## Design decisions
- `GET /api/auth/me` uses explicit `res.json()` because Nest sends an empty body for controller-returned `null`
- JWT secret falls back only in dev/test; production boot throws if JWT_SECRET is unset/default
- Google profiles with unverified emails are rejected; email-fallback matching only binds rows with no existing googleId
- AC5 guard sweep enumerates Nest's real route table so future routes are covered automatically

## Verification
- `pnpm build` — passed
- `pnpm test` — passed (280 API + 3 web tests, 24 suites)
- `pnpm lint` — passed
- `pnpm format:check` — passed
- 3 parallel reviews approved after 3 dev iterations (⚠ independence not enforced: codex unavailable, all reviewers ran claude-code)

## Follow-up
Deferred non-blocking hardening (noted in PR): OAuth state-param CSRF protection, authenticated /storage serving, JWT algorithm pinning + rotation/revocation, sanitized admin GET /api/users projection, approvedAt semantics on rejection, NODE_ENV-unset fail-fast heuristic, dev CORS origins gated off in production.
