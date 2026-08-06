/**
 * Shared e2e test helper (EVT-14) — creates an approved admin `User` row
 * directly via Prisma (bypassing the real Google OAuth flow — most existing
 * e2e suites exercise Items/Photos endpoints, not auth itself) and returns a
 * supertest wrapper that attaches the signed session cookie to every
 * request. Needed because `JwtAuthGuard` is now global: every existing
 * item/photo e2e flow would otherwise 401 on its very first request.
 */

import { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import supertest from 'supertest';
import { AUTH_COOKIE_NAME, AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';

export interface AuthedHttp {
  get(url: string): supertest.Test;
  post(url: string): supertest.Test;
  patch(url: string): supertest.Test;
  delete(url: string): supertest.Test;
}

let counter = 0;

/** Creates an approved admin User and a supertest wrapper authenticated as them. */
export async function createAuthedHttp(
  app: INestApplication,
  prisma: PrismaService,
  authService: AuthService,
  overrides: { email?: string; googleId?: string; role?: UserRole; status?: UserStatus } = {},
): Promise<AuthedHttp> {
  const unique = `${Date.now()}-${counter++}`;
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? `e2e-user-${unique}@example.com`,
      googleId: overrides.googleId ?? `e2e-google-${unique}`,
      role: overrides.role ?? UserRole.admin,
      status: overrides.status ?? UserStatus.approved,
    },
  });
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
