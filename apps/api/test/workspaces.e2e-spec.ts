/**
 * Workspaces & Memberships API — end-to-end integration tests (EVT-42).
 *
 * These tests spin up the full NestJS application backed by the Docker
 * PostgreSQL container started in jest.e2e.config.js → global-setup.ts, the
 * same way auth.e2e-spec.ts / tenancy-isolation.e2e-spec.ts do. The real
 * Google OAuth handshake is not exercised — `AuthService.upsertFromGoogleProfile`
 * is called directly with a synthetic profile, exactly what
 * `AuthController.googleCallback` does with the profile passport hands it
 * after a real handshake.
 *
 * Coverage:
 *   AC1 — create/list/rename with owner-role enforcement
 *   AC2 — invite lifecycle: create -> redeem (new Google user) -> member
 *          sees data; revoke blocks redemption; single-use + expiry enforced
 *   AC3 — removal/leave semantics incl. last-owner protection
 *   AC4 — viewer-granting invites end-to-end; live member<->viewer toggle
 *   AC5 — zero-membership users can create/redeem but cannot touch
 *          inventory endpoints
 *   AC6 — fresh-deployment first-user path (zero env vars): sign in ->
 *          create workspace -> operational immediately
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceRole } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { GoogleProfile } from '../src/auth/google.strategy';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthedHttp, createAuthedHttp, wrapWithCookie } from './e2e-auth-helper';

// ---------------------------------------------------------------------------
// Test database URL — provided by global-setup.ts via the known container URL
// ---------------------------------------------------------------------------

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let profileCounter = 0;

function makeProfile(overrides: Partial<GoogleProfile> = {}): GoogleProfile {
  const n = profileCounter++;
  return {
    googleId: `evt42-google-${n}`,
    email: `evt42-user-${n}@example.com`,
    name: `User ${n}`,
    picture: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Workspaces & Memberships API (e2e) — EVT-42', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }),
    );
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    authService = moduleFixture.get<AuthService>(AuthService);
  });

  afterAll(async () => {
    await app.close();
  });

  /**
   * `User` delete cascades `WorkspaceMember` (onDelete: Cascade — see the
   * schema) so this alone isolates every test's membership graph. Workspace/
   * WorkspaceInvite rows are intentionally left behind (same convention as
   * `two-workspace-harness.ts`) — they carry no uniqueness constraint that
   * would collide across tests, and every test creates its own via a signed-
   * in user rather than relying on a shared fixture.
   */
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  // =========================================================================
  // AC1 — create / list / rename, owner-role enforcement
  // =========================================================================

  describe('AC1: create / list / rename', () => {
    it('creates a workspace; the creator becomes its owner', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });

      const res = await owner.post('/api/workspaces').send({ name: 'Garage' }).expect(201);

      expect(res.body).toMatchObject({ name: 'Garage', role: WorkspaceRole.owner });
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('lists only the workspaces the caller belongs to, each with their own role', async () => {
      const alice = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const bob = await createAuthedHttp(app, prisma, authService, { workspaceId: null });

      const aliceWs = await alice.post('/api/workspaces').send({ name: "Alice's Garage" });
      await bob.post('/api/workspaces').send({ name: "Bob's Shed" });

      const res = await alice.get('/api/workspaces').expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(aliceWs.body.id);
      expect(res.body[0].role).toBe(WorkspaceRole.owner);
    });

    it('owner can rename', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Old Name' });

      const res = await owner
        .patch(`/api/workspaces/${ws.body.id}`)
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.name).toBe('New Name');
    });

    it('AC1: a non-owner member cannot rename (403)', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const member = await createAuthedHttp(app, prisma, authService, {
        workspaceId: ws.body.id,
        workspaceRole: WorkspaceRole.member,
      });

      await member.patch(`/api/workspaces/${ws.body.id}`).send({ name: 'Hijacked' }).expect(403);
    });

    it('EVT-42 round-2 (fail-closed): a TOTAL stranger (zero memberships anywhere) gets 403 from WorkspaceContextGuard before ever reaching the handler', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const stranger = await createAuthedHttp(app, prisma, authService, { workspaceId: null });

      await stranger.patch(`/api/workspaces/${ws.body.id}`).send({ name: 'Hijacked' }).expect(403);
    });

    it('a member of a DIFFERENT workspace gets 404 targeting a foreign workspace (does not confirm existence)', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      // Not a stranger — has SOME ambient workspace (their own), just not
      // this one, so WorkspaceContextGuard resolves fine and the 404 comes
      // from WorkspacesService.requireMembership as before.
      const otherOwner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      await otherOwner.post('/api/workspaces').send({ name: 'Shed' });

      await otherOwner
        .patch(`/api/workspaces/${ws.body.id}`)
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  // =========================================================================
  // AC2 — invite lifecycle
  // =========================================================================

  describe('AC2: invite lifecycle', () => {
    it('owner creates an invite; a NEW Google user redeems it and gains member access', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });

      const inviteRes = await owner
        .post(`/api/workspaces/${ws.body.id}/invites`)
        .send({})
        .expect(201);
      expect(inviteRes.body.role).toBe(WorkspaceRole.member);
      expect(typeof inviteRes.body.token).toBe('string');

      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      const inviteeHttp = wrapWithCookie(app, authService, invitee);

      const redeemRes = await inviteeHttp
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(201);
      expect(redeemRes.body).toEqual({ workspaceId: ws.body.id, role: WorkspaceRole.member });

      // The invitee now sees the workspace's data.
      const created = await owner.post('/api/items').send({ name: 'Drill', quantity: 1 });
      const itemsRes = await inviteeHttp.get('/api/items').expect(200);
      expect(itemsRes.body.map((i: { id: string }) => i.id)).toContain(created.body.id);
    });

    it('revoke blocks redemption', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner.post(`/api/workspaces/${ws.body.id}/invites`).send({});

      await owner.delete(`/api/workspaces/${ws.body.id}/invites/${inviteRes.body.id}`).expect(204);

      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      const inviteeHttp = wrapWithCookie(app, authService, invitee);
      await inviteeHttp
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(409);
    });

    it('single-use: a second redemption of the same token 409s', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner.post(`/api/workspaces/${ws.body.id}/invites`).send({});

      const firstInvitee = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, firstInvitee)
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(201);

      const secondInvitee = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, secondInvitee)
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(409);
    });

    it('an expired invite cannot be redeemed', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner.post(`/api/workspaces/${ws.body.id}/invites`).send({});

      await prisma.workspaceInvite.update({
        where: { id: inviteRes.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, invitee)
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(409);
    });

    it('an unknown token 404s', async () => {
      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, invitee)
        .post('/api/invites/redeem')
        .send({ token: 'not-a-real-token' })
        .expect(404);
    });

    it('a non-owner cannot create invites (403)', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const member = await createAuthedHttp(app, prisma, authService, {
        workspaceId: ws.body.id,
        workspaceRole: WorkspaceRole.member,
      });

      await member.post(`/api/workspaces/${ws.body.id}/invites`).send({}).expect(403);
    });
  });

  // =========================================================================
  // AC3 — removal / leave / last-owner protection
  // =========================================================================

  describe('AC3: removal / leave / last-owner protection', () => {
    async function makeOwnerWithMember(): Promise<{
      owner: AuthedHttp;
      member: AuthedHttp;
      memberId: string;
      workspaceId: string;
    }> {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const memberUser = await authService.upsertFromGoogleProfile(makeProfile());
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.body.id, userId: memberUser.id, role: WorkspaceRole.member },
      });
      return {
        owner,
        member: wrapWithCookie(app, authService, memberUser),
        memberId: memberUser.id,
        workspaceId: ws.body.id,
      };
    }

    it('owner removes a member; the removed member immediately loses access', async () => {
      const { owner, member, memberId, workspaceId } = await makeOwnerWithMember();
      await member.get('/api/items').expect(200); // has access before removal

      await owner.delete(`/api/workspaces/${workspaceId}/members/${memberId}`).expect(204);

      await member.get('/api/items').expect(403);
    });

    it('a member can leave', async () => {
      const { member, memberId, workspaceId } = await makeOwnerWithMember();

      await member.delete(`/api/workspaces/${workspaceId}/members/${memberId}`).expect(204);

      await member.get('/api/items').expect(403);
    });

    it('AC3: the last owner cannot leave', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const meRes = await owner.get('/api/auth/me').expect(200);

      await owner.delete(`/api/workspaces/${ws.body.id}/members/${meRes.body.id}`).expect(403);
    });

    it('AC3: the last owner cannot be demoted via role-change', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const meRes = await owner.get('/api/auth/me').expect(200);

      await owner
        .patch(`/api/workspaces/${ws.body.id}/members/${meRes.body.id}/role`)
        .send({ role: WorkspaceRole.member })
        .expect(403);
    });

    it('AC3: once a co-owner is promoted (transfer), the original owner CAN leave', async () => {
      const { owner, member, memberId, workspaceId } = await makeOwnerWithMember();

      await owner
        .post(`/api/workspaces/${workspaceId}/members/${memberId}/transfer-ownership`)
        .expect(201);

      const ownerMeRes = await owner.get('/api/auth/me').expect(200);
      await owner
        .delete(`/api/workspaces/${workspaceId}/members/${ownerMeRes.body.id}`)
        .expect(204);

      // The promoted co-owner still has full access.
      await member.get('/api/items').expect(200);
    });
  });

  // =========================================================================
  // AC4 — viewer role end-to-end + live role toggle
  // =========================================================================

  describe('AC4: viewer-granting invites + live role toggle', () => {
    it('a viewer-granting invite: redeemed viewer can read but not write', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner
        .post(`/api/workspaces/${ws.body.id}/invites`)
        .send({ role: WorkspaceRole.viewer })
        .expect(201);

      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      const inviteeHttp = wrapWithCookie(app, authService, invitee);
      const redeemRes = await inviteeHttp
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(201);
      expect(redeemRes.body.role).toBe(WorkspaceRole.viewer);

      await inviteeHttp.get('/api/items').expect(200);
      await inviteeHttp.post('/api/items').send({ name: 'Drill', quantity: 1 }).expect(403);
    });

    it('owner toggles member <-> viewer and the change takes effect on the very next request', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const memberUser = await authService.upsertFromGoogleProfile(makeProfile());
      await prisma.workspaceMember.create({
        data: { workspaceId: ws.body.id, userId: memberUser.id, role: WorkspaceRole.member },
      });
      const memberHttp = wrapWithCookie(app, authService, memberUser);

      await memberHttp.post('/api/items').send({ name: 'Drill', quantity: 1 }).expect(201);

      await owner
        .patch(`/api/workspaces/${ws.body.id}/members/${memberUser.id}/role`)
        .send({ role: WorkspaceRole.viewer })
        .expect(200);

      // No new cookie / re-login — the SAME session immediately reads as viewer.
      await memberHttp.post('/api/items').send({ name: 'Hammer', quantity: 1 }).expect(403);
      await memberHttp.get('/api/items').expect(200);

      await owner
        .patch(`/api/workspaces/${ws.body.id}/members/${memberUser.id}/role`)
        .send({ role: WorkspaceRole.member })
        .expect(200);

      await memberHttp.post('/api/items').send({ name: 'Wrench', quantity: 1 }).expect(201);
    });
  });

  // =========================================================================
  // AC5 — zero-membership users
  // =========================================================================

  describe('AC5: zero-membership users', () => {
    it('a zero-membership signed-in user can create a workspace', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      await http.post('/api/workspaces').send({ name: 'My New Workspace' }).expect(201);
    });

    it('a zero-membership signed-in user can redeem an invite', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner.post(`/api/workspaces/${ws.body.id}/invites`).send({});

      const invitee = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, invitee)
        .post('/api/invites/redeem')
        .send({ token: inviteRes.body.token })
        .expect(201);
    });

    it('a zero-membership user is blocked from inventory endpoints (403), not 401', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      await http.get('/api/items').expect(403);
    });

    // -------------------------------------------------------------------
    // EVT-42 round-2 security review, CRITICAL — the fail-closed
    // WorkspaceContextGuard fix must hold even for controllers that
    // declare ZERO `@CurrentWorkspace()` routes of their own
    // (LocationsController/CategoriesController/ProjectsController/
    // ShoppingListController — EVT-41's still-unlanded scoping work). Before
    // the fix, a zero-membership caller reached these handlers regardless
    // (`request.workspace = null` but the guard still returned `true`); the
    // concrete attack was a throwaway Google account dumping every
    // workspace's locations/categories/projects/shopping-list, reads AND
    // writes, with zero allowlisting required.
    // -------------------------------------------------------------------

    it('EVT-42 round-2 (CRITICAL): a zero-membership user is blocked (403) from locations, categories, projects, and shopping-list — reads AND writes', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      await http.get('/api/locations').expect(403);
      await http.post('/api/locations').send({ name: 'Garage' }).expect(403);

      await http.get('/api/categories').expect(403);
      await http.post('/api/categories').send({ name: 'Tools' }).expect(403);

      await http.get('/api/projects').expect(403);
      await http.post('/api/projects').send({ name: 'Deck build' }).expect(403);

      await http.get('/api/shopping-list').expect(403);
      await http.post('/api/shopping-list').send({}).expect(403);
    });

    it('EVT-42 round-2: workspace-create, invite-redeem, and /auth/me all still work for the SAME zero-membership user', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      await http.get('/api/auth/me').expect(200);

      const owner = await createAuthedHttp(app, prisma, authService, { workspaceId: null });
      const ws = await owner.post('/api/workspaces').send({ name: 'Garage' });
      const inviteRes = await owner.post(`/api/workspaces/${ws.body.id}/invites`).send({});

      await http.post('/api/invites/redeem').send({ token: inviteRes.body.token }).expect(201);

      // Also still able to create their OWN workspace independently.
      const secondUser = await authService.upsertFromGoogleProfile(makeProfile());
      await wrapWithCookie(app, authService, secondUser)
        .post('/api/workspaces')
        .send({ name: 'Second User Workspace' })
        .expect(201);
    });

    it('EVT-42 round-2: GET /api/items/by-qr/:qr stays neutral (404, not 403) for a zero-membership caller — @AllowMissingWorkspace()', async () => {
      const user = await authService.upsertFromGoogleProfile(makeProfile());
      const http = wrapWithCookie(app, authService, user);

      // A zero-membership caller must get the SAME neutral 404 an unknown
      // token gets — a 403 here would additionally reveal "you have no
      // workspace at all", a distinction the scan-landing route must not leak.
      await http.get('/api/items/by-qr/some-unknown-qr-token').expect(404);
    });
  });

  // =========================================================================
  // AC6 — fresh-deployment first-user path (zero env vars)
  // =========================================================================

  describe('AC6: fresh-deployment first-user path', () => {
    it('the first-ever sign-in (no env vars) can create a workspace and use it immediately', async () => {
      // Mirrors a genuinely fresh deployment: no EVENTORY_ADMIN_EMAILS, and
      // (via the beforeEach above) zero pre-existing users.
      const admin = await authService.upsertFromGoogleProfile(makeProfile(), {});
      const http = wrapWithCookie(app, authService, admin);

      // First-ever sign-in is instance-admin (unrelated to workspace access)...
      const meRes = await http.get('/api/auth/me').expect(200);
      expect(meRes.body.role).toBe('admin');

      // ...but starts with ZERO workspace memberships — must self-serve.
      await http.get('/api/items').expect(403);

      const ws = await http.post('/api/workspaces').send({ name: 'Home' }).expect(201);
      expect(ws.body.role).toBe(WorkspaceRole.owner);

      await http.post('/api/items').send({ name: 'Drill', quantity: 1 }).expect(201);
    });
  });
});
