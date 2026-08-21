/**
 * Workspace deletion — end-to-end (EVT-47).
 *
 * `DELETE /api/workspaces/:id` (owner-only) must remove every domain row
 * scoped to that workspace, in one transaction, then the `Workspace` row
 * itself, and best-effort unlink its photo files from disk — see
 * `WorkspacesService.remove`'s doc comment for the full dependency-order +
 * RLS-pinning writeup this suite exercises.
 *
 * Bootstraps `AppModule` with `APP_DATABASE_URL` pointed at the restricted
 * `eventory_rls` role (same pattern as `rls-isolation.e2e-spec.ts`) so the
 * AC3 evidence below is genuine: it proves the deletion transaction's
 * explicit `workspaceDbContext.run({ workspaceId }, ...)` pin — NOT the
 * ambient per-request context a superuser/owner-role connection would make
 * irrelevant either way.
 *
 *   AC2 — every domain table (locations, categories, items, tags, photos,
 *          stock movements, projects, BOM lines, shopping-list entries) is
 *          empty for the deleted workspace afterwards; the photo file is
 *          gone from disk.
 *   AC3 — the deletion still succeeds, and still removes everything, when
 *          the caller's ACTIVE (ambient/header) workspace at request time is
 *          a DIFFERENT workspace than the one being deleted.
 *   AC4 — the Default Workspace can never be deleted (409), even by its own
 *          owner, and nothing about it is touched.
 *   (bonus) a non-owner member is refused (403) and nothing is deleted.
 */

import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { existsSync } from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { STORAGE_DIR } from '../src/photos/photos.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../src/workspace/default-workspace';
import { AuthedHttp, createAuthedHttp, wrapWithCookie } from './e2e-auth-helper';

// ---------------------------------------------------------------------------
// Test database URLs — same two roles as rls-isolation.e2e-spec.ts.
// ---------------------------------------------------------------------------

const OWNER_DB_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://eventory:eventory@localhost:5433/eventory_test?schema=public';

const RLS_DB_URL =
  process.env.TEST_APP_DATABASE_URL ??
  'postgresql://eventory_rls:eventory_rls_change_me@localhost:5433/eventory_test?schema=public';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('Workspace deletion (e2e, EVT-47)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;

  // See rls-isolation.e2e-spec.ts's own doc comment: `process.env` is a
  // plain global, and jest.e2e.config.js runs every `*.e2e-spec.ts` file
  // sequentially in one worker — this MUST be restored so later suites'
  // `PrismaService` doesn't silently inherit the restricted role.
  const previousAppDatabaseUrl = process.env.APP_DATABASE_URL;

  let counter = 0;

  beforeAll(async () => {
    process.env.DATABASE_URL = OWNER_DB_URL;
    process.env.APP_DATABASE_URL = RLS_DB_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.setGlobalPrefix('api', {
      exclude: [{ path: 'storage/:filename', method: RequestMethod.GET }],
    });
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
    process.env.APP_DATABASE_URL = previousAppDatabaseUrl;
  });

  async function makeWorkspace(name: string): Promise<string> {
    const unique = `${Date.now()}-${counter++}`;
    const workspace = await prisma.workspace.create({ data: { name: `${name}-${unique}` } });
    return workspace.id;
  }

  /** A user with an explicit set of `(workspaceId, role)` memberships — lets a single caller belong to TWO different workspaces at once (AC3 needs exactly this: owner of A, also a member of B). */
  async function makeUserWithMemberships(
    memberships: { workspaceId: string; role: WorkspaceRole }[],
  ): Promise<AuthedHttp> {
    const unique = `${Date.now()}-${counter++}`;
    const user = await prisma.user.create({
      data: {
        email: `evt47-${unique}@example.com`,
        googleId: `evt47-google-${unique}`,
        role: UserRole.user,
        status: UserStatus.approved,
      },
    });
    for (const membership of memberships) {
      await prisma.workspaceMember.create({
        data: { workspaceId: membership.workspaceId, userId: user.id, role: membership.role },
      });
    }
    return wrapWithCookie(app, authService, user);
  }

  function makeTestPng(): Promise<Buffer> {
    return sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } },
    })
      .png()
      .toBuffer();
  }

  /** Seeds one row in every domain table this workspace owns — location, category, item (+ tag via ItemTag, + a stock movement from its initial quantity), photo, project (+ BOM line), shopping-list entry. */
  async function seedFullWorkspace(
    http: AuthedHttp,
    workspaceId: string,
  ): Promise<{ photoFilename: string }> {
    const locationRes = await http
      .post('/api/locations')
      .set('X-Workspace-Id', workspaceId)
      .send({ name: 'Garage' })
      .expect(201);
    const categoryRes = await http
      .post('/api/categories')
      .set('X-Workspace-Id', workspaceId)
      .send({ name: 'Power Tools' })
      .expect(201);
    const itemRes = await http
      .post('/api/items')
      .set('X-Workspace-Id', workspaceId)
      .send({
        name: 'Cordless Drill',
        quantity: 3,
        locationId: locationRes.body.id,
        categoryId: categoryRes.body.id,
        tags: ['power-tool'],
      })
      .expect(201);

    const png = await makeTestPng();
    const uploadRes = await http
      .post('/api/photos/upload')
      .set('X-Workspace-Id', workspaceId)
      .field('itemId', itemRes.body.id)
      .attach('file', png, { filename: 'drill.png', contentType: 'image/png' })
      .expect(201);

    const projectRes = await http
      .post('/api/projects')
      .set('X-Workspace-Id', workspaceId)
      .send({ name: 'Shed build' })
      .expect(201);
    await http
      .post(`/api/projects/${projectRes.body.id}/bom`)
      .set('X-Workspace-Id', workspaceId)
      .send({ itemId: itemRes.body.id, quantity: 1 })
      .expect(201);

    // 200, not 201 (`ShoppingListController.createManual` is idempotent —
    // it returns the existing open entry on a repeat call, so it's not
    // modeled as a "created" response).
    await http
      .post('/api/shopping-list')
      .set('X-Workspace-Id', workspaceId)
      .send({ itemId: itemRes.body.id })
      .expect(200);

    return { photoFilename: uploadRes.body.filename as string };
  }

  async function assertWorkspaceFullyGone(workspaceId: string): Promise<void> {
    expect(await prisma.workspace.findUnique({ where: { id: workspaceId } })).toBeNull();
    expect(await prisma.item.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.location.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.category.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.tag.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.photo.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.stockMovement.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.project.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.shoppingListEntry.findMany({ where: { workspaceId } })).toHaveLength(0);
    expect(await prisma.bomLine.findMany({ where: { project: { workspaceId } } })).toHaveLength(0);
  }

  // =========================================================================
  // AC2 + AC3
  // =========================================================================

  it("AC2/AC3: deletes every domain row + unlinks photo files, even when the caller's ACTIVE workspace at request time is a DIFFERENT one", async () => {
    const workspaceA = await makeWorkspace('EVT-47 Workspace A');
    const workspaceB = await makeWorkspace('EVT-47 Workspace B');
    const owner = await makeUserWithMemberships([
      { workspaceId: workspaceA, role: WorkspaceRole.owner },
      { workspaceId: workspaceB, role: WorkspaceRole.member },
    ]);

    const { photoFilename } = await seedFullWorkspace(owner, workspaceA);
    const photoPath = path.join(STORAGE_DIR, photoFilename);
    expect(existsSync(photoPath)).toBe(true);

    // The RLS trap this task exists to close: ACTIVE (ambient) workspace is
    // B, target `:id` is A. `X-Workspace-Id: B` is a legitimate header (the
    // caller IS a member of B) — WorkspaceContextGuard resolves `request
    // .workspace` to B, but WorkspacesService.remove's own explicit
    // `requireOwner`/`workspaceDbContext.run` pin the deletion to A
    // regardless.
    await owner
      .delete(`/api/workspaces/${workspaceA}`)
      .set('X-Workspace-Id', workspaceB)
      .expect(204);

    await assertWorkspaceFullyGone(workspaceA);
    // Best-effort disk cleanup happened after commit.
    expect(existsSync(photoPath)).toBe(false);

    // B (the ambient-but-untargeted workspace) is completely untouched.
    expect(await prisma.workspace.findUnique({ where: { id: workspaceB } })).not.toBeNull();
  });

  it("AC2: also works with no X-Workspace-Id header at all (falls back to the caller's own membership, which happens to already be the target)", async () => {
    const workspaceA = await makeWorkspace('EVT-47 Workspace no-header');
    const owner = await makeUserWithMemberships([
      { workspaceId: workspaceA, role: WorkspaceRole.owner },
    ]);
    await seedFullWorkspace(owner, workspaceA);

    await owner.delete(`/api/workspaces/${workspaceA}`).expect(204);

    await assertWorkspaceFullyGone(workspaceA);
  });

  // =========================================================================
  // AC4
  // =========================================================================

  describe('AC4: the Default Workspace can never be deleted', () => {
    it('refuses with 409, even for its own owner, and touches nothing', async () => {
      const owner = await createAuthedHttp(app, prisma, authService, {
        workspaceRole: WorkspaceRole.owner,
      });

      const res = await owner.delete(`/api/workspaces/${DEFAULT_WORKSPACE_ID}`).expect(409);
      expect(typeof res.body.message).toBe('string');
      expect((res.body.message as string).toLowerCase()).toContain('default workspace');

      expect(
        await prisma.workspace.findUnique({ where: { id: DEFAULT_WORKSPACE_ID } }),
      ).not.toBeNull();
    });
  });

  // =========================================================================
  // Owner-only enforcement
  // =========================================================================

  it('a non-owner member is refused with 403, and nothing is deleted', async () => {
    const workspaceA = await makeWorkspace('EVT-47 non-owner refusal');
    const member = await makeUserWithMemberships([
      { workspaceId: workspaceA, role: WorkspaceRole.member },
    ]);

    await member.delete(`/api/workspaces/${workspaceA}`).expect(403);

    expect(await prisma.workspace.findUnique({ where: { id: workspaceA } })).not.toBeNull();
  });
});
