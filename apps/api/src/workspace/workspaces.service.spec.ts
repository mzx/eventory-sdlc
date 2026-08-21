import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InviteStatus, WorkspaceRole } from '@prisma/client';
import { createHash } from 'crypto';
import * as path from 'path';
import { STORAGE_DIR } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from './default-workspace';
import { InvitesService, WorkspacesService } from './workspaces.service';

const unlinkMock = jest.fn();
jest.mock('fs/promises', () => ({
  unlink: (...args: unknown[]) => unlinkMock(...args),
}));

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

/** Bare `{ deleteMany: jest.fn() }` shape shared by every `remove()` domain-table delegate below. */
function makeDeleteManyModel() {
  return { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) };
}

function makePrismaMock() {
  const workspace = { create: jest.fn(), update: jest.fn(), delete: jest.fn() };
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
  // `remove()`'s domain-table deleteMany calls (EVT-47) — `photo` also needs
  // `findMany` (reads filenames to unlink after commit).
  const stockMovement = makeDeleteManyModel();
  const bomLine = makeDeleteManyModel();
  const photo = { ...makeDeleteManyModel(), findMany: jest.fn().mockResolvedValue([]) };
  const item = makeDeleteManyModel();
  const tag = makeDeleteManyModel();
  const category = makeDeleteManyModel();
  const location = makeDeleteManyModel();
  const project = makeDeleteManyModel();
  const shoppingListEntry = makeDeleteManyModel();
  const mock: {
    workspace: typeof workspace;
    workspaceMember: typeof workspaceMember;
    workspaceInvite: typeof workspaceInvite;
    stockMovement: typeof stockMovement;
    bomLine: typeof bomLine;
    photo: typeof photo;
    item: typeof item;
    tag: typeof tag;
    category: typeof category;
    location: typeof location;
    project: typeof project;
    shoppingListEntry: typeof shoppingListEntry;
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  } = {
    workspace,
    workspaceMember,
    workspaceInvite,
    stockMovement,
    bomLine,
    photo,
    item,
    tag,
    category,
    location,
    project,
    shoppingListEntry,
    // `lockOwnerRows` (SELECT ... FOR UPDATE) — a no-op in this mock; tests
    // that care about lock ORDERING assert on `$queryRaw`'s call order
    // relative to `workspaceMember.count`, not its return value.
    $queryRaw: jest.fn().mockResolvedValue([]),
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
    unlinkMock.mockReset();
    unlinkMock.mockResolvedValue(undefined);
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
  // remove (EVT-47)
  // =========================================================================

  describe('remove', () => {
    it('AC2: deletes every domain table in FK-safe dependency order, then the workspace row, inside one $transaction', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(makeMembership());
      prisma.photo.findMany.mockResolvedValue([{ filename: 'a.jpg' }, { filename: 'b.png' }]);

      await service.remove(WORKSPACE_ID, OWNER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.photo.findMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
        select: { filename: true },
      });
      expect(prisma.stockMovement.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.bomLine.deleteMany).toHaveBeenCalledWith({
        where: { project: { workspaceId: WORKSPACE_ID } },
      });
      expect(prisma.photo.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.item.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
      expect(prisma.tag.deleteMany).toHaveBeenCalledWith({ where: { workspaceId: WORKSPACE_ID } });
      expect(prisma.category.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.location.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.project.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.shoppingListEntry.deleteMany).toHaveBeenCalledWith({
        where: { workspaceId: WORKSPACE_ID },
      });
      expect(prisma.workspace.delete).toHaveBeenCalledWith({ where: { id: WORKSPACE_ID } });

      // Dependency order: stock movements/BOM lines/photos/items before
      // tags/categories/locations/projects/shopping-list rows, before the
      // workspace row itself.
      const orderOf = (mockFn: jest.Mock) => mockFn.mock.invocationCallOrder[0];
      expect(orderOf(prisma.stockMovement.deleteMany)).toBeLessThan(
        orderOf(prisma.item.deleteMany),
      );
      expect(orderOf(prisma.bomLine.deleteMany)).toBeLessThan(orderOf(prisma.item.deleteMany));
      expect(orderOf(prisma.photo.deleteMany)).toBeLessThan(orderOf(prisma.item.deleteMany));
      expect(orderOf(prisma.item.deleteMany)).toBeLessThan(orderOf(prisma.tag.deleteMany));
      expect(orderOf(prisma.tag.deleteMany)).toBeLessThan(orderOf(prisma.category.deleteMany));
      expect(orderOf(prisma.category.deleteMany)).toBeLessThan(orderOf(prisma.location.deleteMany));
      expect(orderOf(prisma.location.deleteMany)).toBeLessThan(orderOf(prisma.project.deleteMany));
      expect(orderOf(prisma.project.deleteMany)).toBeLessThan(
        orderOf(prisma.shoppingListEntry.deleteMany),
      );
      expect(orderOf(prisma.shoppingListEntry.deleteMany)).toBeLessThan(
        orderOf(prisma.workspace.delete),
      );
    });

    it("unlinks every deleted workspace's photo file, best-effort, AFTER the transaction commits", async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(makeMembership());
      prisma.photo.findMany.mockResolvedValue([{ filename: 'keep-me.jpg' }]);

      await service.remove(WORKSPACE_ID, OWNER_ID);

      expect(unlinkMock).toHaveBeenCalledWith(path.join(STORAGE_DIR, 'keep-me.jpg'));
      // Commit (workspace.delete, inside $transaction) happens strictly
      // before the disk unlink — DB-first ordering, same as PhotosService.
      const transactionOrder = prisma.$transaction.mock.invocationCallOrder[0];
      const unlinkOrder = unlinkMock.mock.invocationCallOrder[0];
      expect(transactionOrder).toBeLessThan(unlinkOrder);
    });

    it('swallows a failed unlink rather than rejecting the whole delete', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(makeMembership());
      prisma.photo.findMany.mockResolvedValue([{ filename: 'gone-already.jpg' }]);
      unlinkMock.mockRejectedValue(new Error('ENOENT'));

      await expect(service.remove(WORKSPACE_ID, OWNER_ID)).resolves.toBeUndefined();
    });

    it('AC1: rejects a non-owner member with 403, and deletes nothing', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        makeMembership({ userId: MEMBER_ID, role: WorkspaceRole.member }),
      );

      await expect(service.remove(WORKSPACE_ID, MEMBER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a non-member with 404 (does not confirm the workspace exists)', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(null);

      await expect(service.remove(WORKSPACE_ID, OTHER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('AC4: refuses to delete the Default Workspace with 409, even for its owner, and deletes nothing', async () => {
      prisma.workspaceMember.findUnique.mockResolvedValue(
        makeMembership({ workspaceId: DEFAULT_WORKSPACE_ID }),
      );

      await expect(service.remove(DEFAULT_WORKSPACE_ID, OWNER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
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

    // -------------------------------------------------------------------
    // EVT-42 round-2 review, MAJOR — race simulation. `lockOwnerRows`
    // (SELECT ... FOR UPDATE) forces a concurrent transaction targeting the
    // SAME workspace to block, then re-read the owner count fresh once it
    // resumes. Here we simulate "resumed after a concurrently-committed
    // demotion already happened": the lock is acquired, but the re-read
    // count is already down to 1 — the operation must reject, not proceed
    // on a stale read.
    // -------------------------------------------------------------------

    it('EVT-42 round-2 (MAJOR): rejects when the post-lock owner count is already down to 1 (concurrent demote won the race)', async () => {
      const callOrder: string[] = [];
      prisma.workspaceMember.findUnique
        .mockResolvedValueOnce(makeMembership({ userId: OTHER_ID })) // actor is a different owner
        .mockResolvedValueOnce(makeMembership()); // target is OWNER_ID, currently owner
      prisma.$queryRaw.mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve([]);
      });
      prisma.workspaceMember.count.mockImplementation(() => {
        callOrder.push('count');
        // Simulates: by the time this transaction acquired the lock, a
        // concurrent transaction already committed a demotion, leaving
        // only 1 owner — the pre-fix code would have read `2` here (a
        // stale, non-locked count) and incorrectly allowed this to proceed.
        return Promise.resolve(1);
      });

      await expect(
        service.changeRole(WORKSPACE_ID, OWNER_ID, WorkspaceRole.member, OTHER_ID),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.workspaceMember.update).not.toHaveBeenCalled();
      // The lock is acquired BEFORE the count is re-read — ordering matters,
      // see `lockOwnerRows`'s doc comment for why.
      expect(callOrder).toEqual(['lock', 'count']);
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

    // EVT-42 round-2 review, MAJOR — same race simulation as `changeRole`
    // above, applied to removal.
    it('EVT-42 round-2 (MAJOR): rejects when the post-lock owner count is already down to 1 (concurrent removal won the race)', async () => {
      const callOrder: string[] = [];
      prisma.workspaceMember.findUnique.mockResolvedValueOnce(makeMembership()); // actor === target, owner
      prisma.$queryRaw.mockImplementation(() => {
        callOrder.push('lock');
        return Promise.resolve([]);
      });
      prisma.workspaceMember.count.mockImplementation(() => {
        callOrder.push('count');
        return Promise.resolve(1);
      });

      await expect(service.removeMember(WORKSPACE_ID, OWNER_ID, OWNER_ID)).rejects.toBeInstanceOf(
        ForbiddenException,
      );

      expect(prisma.workspaceMember.delete).not.toHaveBeenCalled();
      expect(callOrder).toEqual(['lock', 'count']);
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
    it('revokes a pending invite via a CONDITIONAL updateMany (status: pending in the where clause)', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: WORKSPACE_ID,
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });

      await service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID);

      expect(prisma.workspaceInvite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', workspaceId: WORKSPACE_ID, status: InviteStatus.pending },
        data: { status: InviteStatus.revoked },
      });
      expect(prisma.workspaceInvite.update).not.toHaveBeenCalled();
    });

    it('404s for an unknown invite id', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue(null);

      await expect(service.revoke(WORKSPACE_ID, 'unknown', OWNER_ID)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.workspaceInvite.updateMany).not.toHaveBeenCalled();
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
      expect(prisma.workspaceInvite.updateMany).not.toHaveBeenCalled();
    });

    it('409s when the invite is not pending (already redeemed/revoked)', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: WORKSPACE_ID,
        status: InviteStatus.redeemed,
      });
      // The conditional updateMany matches zero rows because `status` isn't
      // `pending` anymore — this is what actually drives the 409, not the
      // find's `status` field.
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    // EVT-42 clearance review / EVT-45: a raced redemption that commits
    // BETWEEN this method's existence-check read and its conditional write
    // must not have its `redeemed` status clobbered back to `revoked` — the
    // conditional `updateMany` (not an unconditional `update` keyed by id
    // alone) is what prevents that. This test simulates exactly that race:
    // the read still shows `pending` (that's the state at read time), but
    // the conditional write matches zero rows because `redeem()` won the
    // race and already flipped the status in between.
    it('409s (does NOT clobber) when a concurrent redemption wins the race between the read and the conditional write', async () => {
      jest.spyOn(workspacesService, 'requireOwner').mockResolvedValue(makeMembership());
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        workspaceId: WORKSPACE_ID,
        status: InviteStatus.pending, // still pending as of the read
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 0 }); // but redeem() won the race

      await expect(service.revoke(WORKSPACE_ID, 'invite-1', OWNER_ID)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.workspaceInvite.updateMany).toHaveBeenCalledWith({
        where: { id: 'invite-1', workspaceId: WORKSPACE_ID, status: InviteStatus.pending },
        data: { status: InviteStatus.revoked },
      });
    });
  });

  describe('redeem', () => {
    const RAW_TOKEN = 'a'.repeat(64);
    const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

    it('claims the invite atomically and grants membership — a NEW member gets the invite role', async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        tokenHash: TOKEN_HASH,
        workspaceId: WORKSPACE_ID,
        role: WorkspaceRole.viewer,
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });
      // A brand-new membership: the upsert's `create` branch stamps
      // `invite.role`, so the row Prisma hands back carries that same role.
      prisma.workspaceMember.upsert.mockResolvedValue(
        makeMembership({ userId: OTHER_ID, role: WorkspaceRole.viewer }),
      );

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

    // EVT-42 clearance review / EVT-45 fix: the response must reflect the
    // upserted row's ACTUAL role, not blindly echo back `invite.role`.
    it("EVT-45: returns the EXISTING member's ACTUAL role, not the invite's role, when they already belong", async () => {
      prisma.workspaceInvite.findUnique.mockResolvedValue({
        id: 'invite-1',
        tokenHash: TOKEN_HASH,
        workspaceId: WORKSPACE_ID,
        role: WorkspaceRole.viewer, // the invite grants viewer...
        status: InviteStatus.pending,
      });
      prisma.workspaceInvite.updateMany.mockResolvedValue({ count: 1 });
      // ...but OWNER_ID is ALREADY a member with a DIFFERENT role (owner) —
      // the idempotent `update: {}` branch leaves that untouched, so the
      // row Prisma hands back still carries `owner`.
      prisma.workspaceMember.upsert.mockResolvedValue(
        makeMembership({ userId: OWNER_ID, role: WorkspaceRole.owner }),
      );

      const result = await service.redeem(RAW_TOKEN, OWNER_ID);

      expect(result).toEqual({ workspaceId: WORKSPACE_ID, role: WorkspaceRole.owner });
      expect(result.role).not.toBe(WorkspaceRole.viewer);
    });
  });
});
