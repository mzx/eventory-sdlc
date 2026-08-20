/**
 * Shared e2e test helper (EVT-14) — creates an approved admin `User` row
 * directly via Prisma (bypassing the real Google OAuth flow — most existing
 * e2e suites exercise Items/Photos endpoints, not auth itself) and returns a
 * supertest wrapper that attaches the signed session cookie to every
 * request. Needed because `JwtAuthGuard` is now global: every existing
 * item/photo e2e flow would otherwise 401 on its very first request.
 *
 * EVT-40: `WorkspaceContextGuard` is ALSO now global — a `User` with no
 * `WorkspaceMember` row resolves `request.workspace` to `null`, which
 * `@CurrentWorkspace()` turns into a 403 on every tenant-scoped route. Every
 * existing e2e suite (items/photos/etc., predating EVT-40) creates its
 * authed user via this helper and expects to keep operating against the
 * Default Workspace's data (the same workspace every legacy row already
 * defaults into per the EVT-39 migration) — so `createAuthedHttp` now ALSO
 * grants a `WorkspaceMember` row, defaulting to the Default Workspace with a
 * role mapped from `UserRole` the same way the EVT-39 migration's backfill
 * does (`admin` -> `owner`, `user` -> `member`). Both are overridable so
 * callers that need a NON-default workspace (e.g. the EVT-40 two-workspace
 * isolation harness, `two-workspace-harness.ts`) can opt out of the default.
 */

import { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import supertest from 'supertest';
import { AUTH_COOKIE_NAME, AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../src/workspace/default-workspace';

export interface AuthedHttp {
  get(url: string): supertest.Test;
  post(url: string): supertest.Test;
  patch(url: string): supertest.Test;
  delete(url: string): supertest.Test;
}

let counter = 0;

/** Mirrors the EVT-39 migration's backfill role mapping. */
function defaultWorkspaceRoleFor(role: UserRole): WorkspaceRole {
  return role === UserRole.admin ? WorkspaceRole.owner : WorkspaceRole.member;
}

/**
 * Creates an approved User and a supertest wrapper authenticated as them.
 *
 * `workspaceId`/`workspaceRole` (EVT-40) control the `WorkspaceMember` row
 * granted alongside the user — defaults to the Default Workspace with a role
 * mapped from `role`. Pass `workspaceId: null` to create a user with NO
 * workspace membership at all (e.g. to test the "zero memberships" edge
 * case of `WorkspaceContextGuard`).
 */
export async function createAuthedHttp(
  app: INestApplication,
  prisma: PrismaService,
  authService: AuthService,
  overrides: {
    email?: string;
    googleId?: string;
    role?: UserRole;
    status?: UserStatus;
    workspaceId?: string | null;
    workspaceRole?: WorkspaceRole;
  } = {},
): Promise<AuthedHttp> {
  const unique = `${Date.now()}-${counter++}`;
  const role = overrides.role ?? UserRole.admin;
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? `e2e-user-${unique}@example.com`,
      googleId: overrides.googleId ?? `e2e-google-${unique}`,
      role,
      status: overrides.status ?? UserStatus.approved,
    },
  });

  const workspaceId =
    overrides.workspaceId === undefined ? DEFAULT_WORKSPACE_ID : overrides.workspaceId;
  if (workspaceId) {
    await prisma.workspaceMember.create({
      data: {
        workspaceId,
        userId: user.id,
        role: overrides.workspaceRole ?? defaultWorkspaceRoleFor(role),
      },
    });
  }

  return wrapWithCookie(app, authService, user);
}

/** Wraps an existing user row with a supertest client carrying their session cookie. */
export function wrapWithCookie(
  app: INestApplication,
  authService: AuthService,
  user: { id: string; email: string; role: UserRole; status: UserStatus },
): AuthedHttp {
  const token = authService.signToken(user);
  const cookie = `${AUTH_COOKIE_NAME}=${token}`;
  const raw = supertest(app.getHttpServer());

  return {
    get: (url: string) => raw.get(url).set('Cookie', cookie),
    post: (url: string) => raw.post(url).set('Cookie', cookie),
    patch: (url: string) => raw.patch(url).set('Cookie', cookie),
    delete: (url: string) => raw.delete(url).set('Cookie', cookie),
  };
}
