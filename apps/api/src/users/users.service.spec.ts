import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
