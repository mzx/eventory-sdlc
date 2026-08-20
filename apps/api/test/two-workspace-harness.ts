/**
 * Two-workspace isolation test harness (EVT-40 AC 6).
 *
 * Seeds TWO independent `Workspace` rows, each with an `owner`/`member`/
 * `viewer` `WorkspaceMember`, and returns cookie-authenticated HTTP clients
 * for each. Used by `tenancy-isolation.e2e-spec.ts` to prove the full
 * items/photos/storage/QR isolation matrix (every endpoint touched by
 * EVT-40: foreign -> 404/403, own -> correct, viewer -> reads-only).
 *
 * **Reused by EVT-41** (remaining modules' isolation coverage) — import
 * `seedTwoWorkspaces` from this file rather than hand-rolling a parallel
 * two-workspace fixture; extend `WorkspaceFixture` here if a new module
 * needs a shape this harness doesn't already expose.
 */

import { INestApplication } from '@nestjs/common';
import { UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthedHttp, wrapWithCookie } from './e2e-auth-helper';

/** One workspace's members, each pre-authenticated at the given role. */
export interface WorkspaceFixture {
  id: string;
  owner: AuthedHttp;
  member: AuthedHttp;
  viewer: AuthedHttp;
}

export interface TwoWorkspaceFixture {
  workspaceA: WorkspaceFixture;
  workspaceB: WorkspaceFixture;
}

let counter = 0;

/** Creates a User with a WorkspaceMember row in `workspaceId` at `role`, and an authed HTTP client for them. */
async function createMember(
  app: INestApplication,
  prisma: PrismaService,
  authService: AuthService,
  workspaceId: string,
  role: WorkspaceRole,
  label: string,
): Promise<AuthedHttp> {
  const unique = `${Date.now()}-${counter++}`;
  const user = await prisma.user.create({
    data: {
      email: `${label}-${unique}@example.com`,
      googleId: `google-${label}-${unique}`,
      // The global UserRole is distinct from the per-workspace WorkspaceRole
      // (see the schema doc comment) — every harness user is a plain,
      // approved `UserRole.user` regardless of their WorkspaceRole.
      role: UserRole.user,
      status: UserStatus.approved,
    },
  });
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
  return wrapWithCookie(app, authService, user);
}

async function seedWorkspace(
  app: INestApplication,
  prisma: PrismaService,
  authService: AuthService,
  name: string,
): Promise<WorkspaceFixture> {
  const unique = `${Date.now()}-${counter++}`;
  const workspace = await prisma.workspace.create({ data: { name: `${name}-${unique}` } });
  return {
    id: workspace.id,
    owner: await createMember(app, prisma, authService, workspace.id, WorkspaceRole.owner, 'owner'),
    member: await createMember(
      app,
      prisma,
      authService,
      workspace.id,
      WorkspaceRole.member,
      'member',
    ),
    viewer: await createMember(
      app,
      prisma,
      authService,
      workspace.id,
      WorkspaceRole.viewer,
      'viewer',
    ),
  };
}

/**
 * Seeds two fully independent workspaces (A and B), each with
 * owner/member/viewer members.
 *
 * Deliberately SEQUENTIAL (not `Promise.all`) — round-2 review, test
 * finding 4: `pnpm test:e2e` showed intermittent extra failures on this
 * branch (not reproduced on `main`) with symptoms consistent with
 * connection/socket-level noise. Firing two full workspace-seeding chains
 * concurrently against the same `PrismaService` connection pool + the same
 * `app.getHttpServer()` instance during setup was the most plausible
 * contributing factor found on inspection (every other e2e suite in this
 * repo seeds its fixtures sequentially, not concurrently); this file was
 * the one exception. Setup time cost is negligible (a handful of inserts)
 * so there's no reason to prefer the concurrent shape here.
 */
export async function seedTwoWorkspaces(
  app: INestApplication,
  prisma: PrismaService,
  authService: AuthService,
): Promise<TwoWorkspaceFixture> {
  const workspaceA = await seedWorkspace(app, prisma, authService, 'Workspace-A');
  const workspaceB = await seedWorkspace(app, prisma, authService, 'Workspace-B');
  return { workspaceA, workspaceB };
}
