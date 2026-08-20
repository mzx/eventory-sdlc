import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InviteStatus, WorkspaceRole } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService, WorkspacesService } from './workspaces.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACE_ID = '11111111-1111-1111-1111-111111111111';
const OWNER_ID = '22222222-2222-2222-2222-222222222222';
const MEMBER_ID = '33333333-3333-3333-3333-333333333333';
const OTHER_ID = '44444444-4444-4444-4444-444444444444';

function makeUserRow(id: string) {
  return { id, email: `${id}@example.com`, name: 'Name', picture: null };
}

function makeMembership(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'member-row-id',
    workspaceId: WORKSPACE_ID,
    userId: OWNER_ID,
    role: WorkspaceRole.owner,
    createdAt: new Date('2026-01-01'),
    user: makeUserRow(OWNER_ID),
    ...overrides,
  };
}

function makePrismaMock() {
  const workspace = { create: jest.fn(), update: jest.fn() };
  const workspaceMember = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
  };
  const workspaceInvite = {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const mock: {
    workspace: typeof workspace;
    workspaceMember: typeof workspaceMember;
    workspaceInvite: typeof workspaceInvite;
    $transaction: jest.Mock;
  } = {
    workspace,
    workspaceMember,
    workspaceInvite,
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(mock)),
  };
  return mock;
}

// ---------------------------------------------------------------------------
// WorkspacesService
// ---------------------------------------------------------------------------

describe('WorkspacesService', () => {
  let service: WorkspacesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspacesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<WorkspacesService>(WorkspacesService);
  });

  // =========================================================================
  // requireMembership / requireOwner
  // =========================================================================

  describe('requireMembership / requireOwner', () => {
    it('requireMembership throws NotFoundException for a non-member (AC1: foreign workspace 404s)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.requireMembership(WORKSPACE_ID, OTHER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('requireOwner throws ForbiddenException for a member who is not owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(service.requireOwner(WORKSPACE_ID, MEMBER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('requireOwner resolves for an owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(makeMembership());

      await expect(service.requireOwner(WORKSPACE_ID, OWNER_ID)).resolves.toMatchObject({
        role: WorkspaceRole.owner,
      });
    });
  });

  // =========================================================================
  // create / listMine / rename
  // =========================================================================

  describe('create', () => {
    it('creates a Workspace and grants the creator `owner` in the same transaction', async () => {
      const created = { id: WORKSPACE_ID, name: 'Garage', createdAt: new Date('2026-01-01') };
      prisma.workspace.create.mockResolvedValue(created);
      prisma.workspaceMember.create.mockResolvedValue(makeMembership());

      const result = await service.create('Garage', OWNER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.workspace.create).toHaveBeenCalledWith({ data: { name: 'Garage' } });
      expect(prisma.workspaceMember.create).toHaveBeenCalledWith({
        data: { workspaceId: WORKSPACE_ID, userId: OWNER_ID, role: WorkspaceRole.owner },
      });
      expect(result).toEqual({
        id: WORKSPACE_ID,
        name: 'Garage',
        role: WorkspaceRole.owner,
        createdAt: created.createdAt,
      });
    });
  });

  describe('listMine', () => {
    it('lists every workspace the caller belongs to, with their role in each', async () => {
      prisma.workspaceMember.findMany.mockResolvedValue([
        {
          role: WorkspaceRole.owner,
          workspace: { id: WORKSPACE_ID, name: 'Garage', createdAt: new Date('2026-01-01') },
        },
        {
          role: WorkspaceRole.viewer,
          workspace: { id: OTHER_ID, name: 'Shed', createdAt: new Date('2026-01-02') },
        },
      ]);

      const result = await service.listMine(OWNER_ID);

      expect(prisma.workspaceMember.findMany).toHaveBeenCalledWith({
        where: { userId: OWNER_ID },
        include: { workspace: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([
        {
          id: WORKSPACE_ID,
          name: 'Garage',
          role: WorkspaceRole.owner,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: OTHER_ID,
          name: 'Shed',
          role: WorkspaceRole.viewer,
          createdAt: new Date('2026-01-02'),
        },
      ]);
    });
  });

  describe('rename', () => {
    it('renames when the caller is owner', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(makeMembership());
      prisma.workspace.update.mockResolvedValue({
        id: WORKSPACE_ID,
        name: 'New Name',
        createdAt: new Date('2026-01-01'),
      });

      const result = await service.rename(WORKSPACE_ID, 'New Name', OWNER_ID);

      expect(prisma.workspace.update).toHaveBeenCalledWith({
        where: { id: WORKSPACE_ID },
        data: { name: 'New Name' },
      });
      expect(result.name).toBe('New Name');
    });

    it('AC1: rejects a non-owner member with 403', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(service.rename(WORKSPACE_ID, 'New Name', MEMBER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.workspace.update).not.toHaveBeenCalled();
    });

    it('rejects a non-member with 404 (does not confirm the workspace exists)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.rename(WORKSPACE_ID, 'New Name', OTHER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // listMembers
  // =========================================================================

  describe('listMembers', () => {
    it('any member (not just owner) may list the roster', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );
      prisma.workspaceMember.findMany.mockResolvedValue([makeMembership()]);

      const result = await service.listMembers(WORKSPACE_ID, MEMBER_ID);

      expect(result).toEqual([
        {
          userId: OWNER_ID,
          email: `${OWNER_ID}@example.com`,
          name: 'Name',
          picture: null,
          role: WorkspaceRole.owner,
          memberSince: new Date('2026-01-01'),
        },
      ]);
    });

    it('rejects a non-member with 404', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.listMembers(WORKSPACE_ID, OTHER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  // =========================================================================
  // changeRole — AC4 (member<->viewer), last-owner guard
  // =========================================================================

  describe('changeRole', () => {
    it('owner demotes a member to viewer', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership()) // requireOwner(actor)
        .mockResolvedValueOnce(makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member })); // target lookup
      prisma.workspaceMember.update.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.viewer }),
      );

      const result = await service.changeRole(
        WORKSPACE_ID,
        MEMBER_ID,
        WorkspaceRole.viewer,
        OWNER_ID,
      );

      expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: MEMBER_ID } },
        data: { role: WorkspaceRole.viewer },
        include: { user: { select: { id: true, email: true, name: true, picture: true } } },
      });
      expect(result.role).toBe(WorkspaceRole.viewer);
    });

    it('rejects a non-owner actor with 403', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(
        service.changeRole(WORKSPACE_ID, OTHER_ID, WorkspaceRole.viewer, MEMBER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s when the target is not a member', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership()) // owner
        .mockResolvedValueOnce(null); // target not found

      await expect(
        service.changeRole(WORKSPACE_ID, OTHER_ID, WorkspaceRole.viewer, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('AC3: blocks demoting the LAST owner', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership()) // requireOwner(actor) — actor IS the target here
        .mockResolvedValueOnce(makeMembership()); // target lookup — same owner row
      prisma.workspaceMember.count.mockResolvedValue(1); // only one owner

      await expect(
        service.changeRole(WORKSPACE_ID, OWNER_ID, WorkspaceRole.member, OWNER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
    });

    it('allows demoting an owner when another owner still remains', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership({ userId: OTHER_ID })) // actor is the OTHER owner
        .mockResolvedValueOnce(makeMembership()); // target is OWNER_ID, currently owner
      prisma.workspaceMember.count.mockResolvedValue(2); // two owners
      prisma.workspaceMember.update.mockResolvedValue(
        makeMembership({ role: WorkspaceRole.member }),
      );

      await expect(
        service.changeRole(WORKSPACE_ID, OWNER_ID, WorkspaceRole.member, OTHER_ID),
      ).resolves.toMatchObject({ role: WorkspaceRole.member });
    });
  });

  // =========================================================================
  // transferOwnership
  // =========================================================================

  describe('transferOwnership', () => {
    it('promotes an existing member to owner', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership()) // requireOwner(actor)
        .mockResolvedValueOnce(makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }));
      prisma.workspaceMember.update.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.owner }),
      );

      const result = await service.transferOwnership(WORKSPACE_ID, MEMBER_ID, OWNER_ID);

      expect(prisma.workspaceMember.update).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: MEMBER_ID } },
        data: { role: WorkspaceRole.owner },
        include: { user: { select: { id: true, email: true, name: true, picture: true } } },
      });
      expect(result.role).toBe(WorkspaceRole.owner);
    });

    it('409s when the target is already an owner', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership())
        .mockResolvedValueOnce(makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.owner }));

      await expect(
        service.transferOwnership(WORKSPACE_ID, MEMBER_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('404s when the target is not a member', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership())
        .mockResolvedValueOnce(null);

      await expect(
        service.transferOwnership(WORKSPACE_ID, OTHER_ID, OWNER_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a non-owner actor with 403', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(
        service.transferOwnership(WORKSPACE_ID, OTHER_ID, MEMBER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  // =========================================================================
  // removeMember — owner removes / self-leave, AC3 last-owner guard
  // =========================================================================

  describe('removeMember', () => {
    it('owner removes another member', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership()) // actor membership (owner)
        .mockResolvedValueOnce(makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member })); // target

      await service.removeMember(WORKSPACE_ID, MEMBER_ID, OWNER_ID);

      expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: MEMBER_ID } },
      });
    });

    it('a member can leave (remove themselves)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await service.removeMember(WORKSPACE_ID, MEMBER_ID, MEMBER_ID);

      expect(prisma.workspaceMember.delete).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: MEMBER_ID } },
      });
    });

    it('rejects a non-owner removing someone else (403)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(service.removeMember(WORKSPACE_ID, OTHER_ID, MEMBER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it('AC3: the last owner cannot leave', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(makeMembership()); // actor === target, owner
      prisma.workspaceMember.count.mockResolvedValue(1);

      await expect(service.removeMember(WORKSPACE_ID, OWNER_ID, OWNER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
    });

    it('AC3: an owner CAN leave once a co-owner exists', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(makeMembership());
      prisma.workspaceMember.count.mockResolvedValue(2);

      await service.removeMember(WORKSPACE_ID, OWNER_ID, OWNER_ID);

      expect(prisma.workspaceMember.delete).toHaveBeenCalled();
    });

    it('404s when the target is not a member', async () => {
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership())
        .mockResolvedValueOnce(null);

      await expect(service.removeMember(WORKSPACE_ID, OTHER_ID, OWNER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// InvitesService
// ---------------------------------------------------------------------------

describe('InvitesService', () => {
  let service: InvitesService;
  let workspacesService: WorkspacesService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [InvitesService, WorkspacesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<InvitesService>(InvitesService);
    workspacesService = module.get<WorkspacesService>(WorkspacesService);
  });

  describe('create', () => {
    it('creates a pending invite (role defaults to member) and returns the RAW token', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'invite-1',
          ...data,
          status: InviteStatus.pending,
          createdAt: new Date('2026-01-01'),
        }),
      );

      const result = await service.create(WORKSPACE_ID, undefined, OWNER_ID);

      expect(result.role).toBe(WorkspaceRole.member);
      expect(result.status).toBe(InviteStatus.pending);
      expect(result.token).toHaveLength(64); // 32 random bytes, hex-encoded

      const createArg = prisma.workspaceInvite.create.mock.calls[0][0];
      // The stored hash matches SHA-256 of the raw token handed back to the caller.
      expect(createArg.data.tokenHash).toBe(
        createHash('sha256').update(result.token).digest('hex'),
      );
      expect(createArg.data.workspaceId).toBe(WORKSPACE_ID);
      expect(createArg.data.createdById).toBe(OWNER_ID);
    });

    it('honors an explicit `viewer` role (AC4)', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'invite-1', ...data, status: InviteStatus.pending }),
      );

      const result = await service.create(WORKSPACE_ID, WorkspaceRole.viewer, OWNER_ID);

      expect(result.role).toBe(WorkspaceRole.viewer);
    });

    it('rejects a non-owner with 403 (delegates to WorkspacesService.requireOwner)', async () => {
      jest
        .spyOn(workspacesService, 'requireOwner')
        .mockRejectedValue(
          new ForbiddenException('Only a workspace owner can perform this action'),
        );

      await expect(service.create(WORKSPACE_ID, undefined, MEMBER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.workspaceInvite.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists invites, owner-only', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findMany.mockResolvedValue([
        {
          id: 'invite-1',
          role: WorkspaceRole.member,
          status: InviteStatus.pending,
          expiresAt: new Date('2026-02-01'),
          createdAt: new Date('2026-01-01'),
          redeemedAt: null,
        },
      ]);

      const result = await service.list(WORKSPACE_ID, OWNER_ID);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe(InviteStatus.pending);
    });
  });

  describe('revoke', () => {
    it('revokes a pending invite', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: WORKSPACE_ID,
        status: InviteStatus.pending,
      });

      await service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID);

      expect(prisma.workspaceInvite.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { status: InviteStatus.revoked },
      });
    });

    it('404s for an unknown invite id', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue(null);

      await expect(service.revoke(WORKSPACE_ID, 'unknown', OWNER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404s when the invite belongs to a DIFFERENT workspace', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: OTHER_ID,
        status: InviteStatus.pending,
      });

      await expect(service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('409s when the invite is not pending (already redeemed/revoked)', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: WORKSPACE_ID,
        status: InviteStatus.redeemed,
      });

      await expect(service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('redeem', () => {
    const RAW_TOKEN = 'a'.repeat(64);
    const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

    it('claims the invite atomically and grants membership', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        tokenHash: TOKEN_HASH,
        workspaceId: WORKSPACE_ID,
        role: WorkspaceRole.viewer,
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });
      prisma.workspaceMember.upsert.mockResolvedValue(makeMembership());

      const result = await service.redeem(RAW_TOKEN, OTHER_ID);

      expect(prisma.workspaceInvite.findUnique).toHaveBeenCalledWith({
        where: { tokenHash: TOKEN_HASH },
      });
      expect(prisma.workspaceInvite.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'invite-1',
          status: InviteStatus.pending,
          expiresAt: { gt: expect.any(Date) },
        },
        data: {
          status: InviteStatus.redeemed,
          redeemedAt: expect.any(Date),
          redeemedById: OTHER_ID,
        },
      });
      expect(prisma.workspaceMember.upsert).toHaveBeenCalledWith({
        where: { workspaceId_userId: { workspaceId: WORKSPACE_ID, userId: OTHER_ID } },
        update: {},
        create: { workspaceId: WORKSPACE_ID, userId: OTHER_ID, role: WorkspaceRole.viewer },
      });
      expect(result).toEqual({ workspaceId: WORKSPACE_ID, role: WorkspaceRole.viewer });
    });

    it('404s for a token that does not resolve to any invite', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue(null);

      await expect(service.redeem('unknown-token', OTHER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('409s (single-use) when the atomic claim loses the race — already redeemed/revoked/expired', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        tokenHash: TOKEN_HASH,
        workspaceId: WORKSPACE_ID,
        role: WorkspaceRole.member,
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.redeem(RAW_TOKEN, OTHER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.workspaceMember.upsert).not.toHaveBeenCalled();
    });

    it('is idempotent for a caller who is already a member — role is left untouched (upsert update: {})', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        tokenHash: TOKEN_HASH,
        workspaceId: WORKSPACE_ID,
        role: WorkspaceRole.member,
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });
      prisma.workspaceMember.upsert.mockResolvedValue(makeMembership());

      await service.redeem(RAW_TOKEN, OWNER_ID);

      const upsertArg = prisma.workspaceMember.upsert.mock.calls[0][0];
      expect(upsertArg.update).toEqual({});
    });
  });
});
