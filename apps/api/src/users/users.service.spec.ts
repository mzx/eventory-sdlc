import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_WORKSPACE_ID,
  __resetDefaultWorkspaceCacheForTests,
} from '../workspace/default-workspace';
import { UsersService } from './users.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_ID = 'admin-1';
const OTHER_ID = 'other-1';

function makePrismaMock() {
  return {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    // EVT-40 — approving a user grants Default Workspace membership.
    workspace: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: DEFAULT_WORKSPACE_ID }),
    },
    workspaceMember: {
      upsert: jest.fn(),
      // Defaults to zero memberships so existing "grants membership on
      // approval" tests still fire; the zero-membership gate test below
      // overrides this per-call.
      count: jest.fn().mockResolvedValue(0),
    },
  };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: OTHER_ID,
    email: 'other@example.com',
    role: UserRole.user,
    status: UserStatus.pending,
    ...overrides,
  };
}

function makeAdmin(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ADMIN_ID,
    email: 'admin@example.com',
    role: UserRole.admin,
    status: UserStatus.approved,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UsersService', () => {
  let service: UsersService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    __resetDefaultWorkspaceCacheForTests();
    prisma = makePrismaMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('lists users oldest-first', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await service.list();
      expect(prisma.user.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'asc' } });
    });
  });

  // =========================================================================
  // updateStatus
  // =========================================================================

  describe('updateStatus', () => {
    it('approves a pending user and stamps approvedBy/At', async () => {
      const target = makeUser();
      prisma.user.findUnique.mockResolvedValue(target);
      const updated = { ...target, status: UserStatus.approved, approvedById: ADMIN_ID };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.updateStatus(
        OTHER_ID,
        { status: UserStatus.approved },
        makeAdmin() as never,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: OTHER_ID },
        data: {
          status: UserStatus.approved,
          approvedById: ADMIN_ID,
          approvedAt: expect.any(Date),
        },
      });
      expect(result).toEqual(updated);
    });

    it('rejects a pending user', async () => {
      const target = makeUser();
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({ ...target, status: UserStatus.rejected });

      await service.updateStatus(OTHER_ID, { status: UserStatus.rejected }, makeAdmin() as never);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.rejected }) }),
      );
    });

    // -------------------------------------------------------------------------
    // EVT-40 — approving a user grants Default Workspace membership so they
    // aren't locked out of every tenant-scoped route (WorkspaceContextGuard
    // is global).
    // -------------------------------------------------------------------------

    it('EVT-40: grants Default Workspace membership (role: member) when approving a plain user', async () => {
      const target = makeUser({ role: UserRole.user });
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({ ...target, status: UserStatus.approved });

      await service.updateStatus(OTHER_ID, { status: UserStatus.approved }, makeAdmin() as never);

      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: DEFAULT_WORKSPACE_ID, userId: OTHER_ID } },
        update: {},
        create: { workspaceId: DEFAULT_WORKSPACE_ID, userId: OTHER_ID, role: WorkspaceRole.member },
      });
    });

    it('EVT-40: grants Default Workspace membership (role: owner) when approving an admin', async () => {
      const target = makeUser({ role: UserRole.admin });
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({ ...target, status: UserStatus.approved });

      await service.updateStatus(OTHER_ID, { status: UserStatus.approved }, makeAdmin() as never);

      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ role: WorkspaceRole.owner }) }),
      );
    });

    it('EVT-40: does NOT grant workspace membership when rejecting (or re-pending) a user', async () => {
      const target = makeUser();
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({ ...target, status: UserStatus.rejected });

      await service.updateStatus(OTHER_ID, { status: UserStatus.rejected }, makeAdmin() as never);

      expect(prisma.workspaceMember.upsert).not.toHaveBeenCalled();
    });

    // -------------------------------------------------------------------------
    // EVT-40 round-3 review, security finding — approving a user who already
    // belongs to SOME workspace must NOT also grant Default Workspace
    // membership (guards against resurrecting a deliberately-revoked
    // Default Workspace membership once EVT-42 adds revocation).
    // -------------------------------------------------------------------------

    it('EVT-40: does NOT grant Default Workspace membership on approval when the user already has a membership in ANY workspace', async () => {
      const target = makeUser({ role: UserRole.user });
      prisma.user.findUnique.mockResolvedValue(target);
      prisma.user.update.mockResolvedValue({ ...target, status: UserStatus.approved });
      prisma.workspaceMember.count.mockResolvedValueOnce(1); // already a member somewhere

      await service.updateStatus(OTHER_ID, { status: UserStatus.approved }, makeAdmin() as never);

      expect(prisma.workspaceMember.count).toHaveBeenCalledWith({ where: { userId: OTHER_ID } });
      expect(prisma.workspaceMember.upsert).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown target id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('unknown-id', { status: UserStatus.approved }, makeAdmin() as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('AC3: an admin cannot reject themself', async () => {
      const admin = makeAdmin();

      await expect(
        service.updateStatus(ADMIN_ID, { status: UserStatus.rejected }, admin as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('AC3: an admin cannot un-approve (set pending) themself', async () => {
      const admin = makeAdmin();

      await expect(
        service.updateStatus(ADMIN_ID, { status: UserStatus.pending }, admin as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an admin to set their OWN status to approved (no-op, not blocked)', async () => {
      const admin = makeAdmin();
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.update.mockResolvedValue(admin);

      await expect(
        service.updateStatus(ADMIN_ID, { status: UserStatus.approved }, admin as never),
      ).resolves.toEqual(admin);
    });
  });

  // =========================================================================
  // updateRole
  // =========================================================================

  describe('updateRole', () => {
    it('promotes a user to admin', async () => {
      const target = makeUser();
      prisma.user.findUnique.mockResolvedValue(target);
      const updated = { ...target, role: UserRole.admin };
      prisma.user.update.mockResolvedValue(updated);

      const result = await service.updateRole(
        OTHER_ID,
        { role: UserRole.admin },
        makeAdmin() as never,
      );

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: OTHER_ID },
        data: { role: UserRole.admin },
      });
      expect(result).toEqual(updated);
    });

    it('throws NotFoundException for an unknown target id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.updateRole('unknown-id', { role: UserRole.user }, makeAdmin() as never),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('AC3: an admin cannot demote themself', async () => {
      const admin = makeAdmin();

      await expect(
        service.updateRole(ADMIN_ID, { role: UserRole.user }, admin as never),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('allows an admin to set their OWN role to admin (no-op, not blocked)', async () => {
      const admin = makeAdmin();
      prisma.user.findUnique.mockResolvedValue(admin);
      prisma.user.update.mockResolvedValue(admin);

      await expect(
        service.updateRole(ADMIN_ID, { role: UserRole.admin }, admin as never),
      ).resolves.toEqual(admin);
    });
  });
});
