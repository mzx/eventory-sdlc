import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { User, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  defaultWorkspaceRoleForUserRole,
  ensureDefaultWorkspaceMembership,
} from '../workspace/default-workspace';
import { UpdateUserRoleDto } from './update-user-role.dto';
import { UpdateUserStatusDto } from './update-user-status.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // list — GET /api/users
  // -------------------------------------------------------------------------

  list(): Promise<User[]> {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
  }

  // -------------------------------------------------------------------------
  // updateStatus — PATCH /api/users/:id/status
  // -------------------------------------------------------------------------

  /**
   * Approves/rejects/re-pends a user. Stamps `approvedById`/`approvedAt` to
   * the acting admin regardless of the target status (keeps an audit trail
   * of who last touched the row, not just who approved it).
   *
   * An admin cannot reject (or otherwise un-approve) themself — AC3.
   *
   * EVT-40: approving a user also grants them Default Workspace membership
   * (idempotent) — see `ensureDefaultWorkspaceMembership`'s doc comment for
   * why. Role maps the same way the EVT-39 migration's backfill did:
   * `UserRole.admin` -> `owner`, everyone else -> `member`.
   */
  async updateStatus(id: string, dto: UpdateUserStatusDto, actingAdmin: User): Promise<User> {
    if (id === actingAdmin.id && dto.status !== UserStatus.approved) {
      throw new ForbiddenException('Admins cannot reject or un-approve themselves');
    }
    const target = await this.findOrThrow(id);

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        status: dto.status,
        approvedById: actingAdmin.id,
        approvedAt: new Date(),
      },
    });

    if (dto.status === UserStatus.approved) {
      await ensureDefaultWorkspaceMembership(
        this.prisma,
        id,
        defaultWorkspaceRoleForUserRole(target.role),
      );
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // updateRole — PATCH /api/users/:id/role
  // -------------------------------------------------------------------------

  /** An admin cannot demote themself away from `admin` — AC3. */
  async updateRole(id: string, dto: UpdateUserRoleDto, actingAdmin: User): Promise<User> {
    if (id === actingAdmin.id && dto.role !== UserRole.admin) {
      throw new ForbiddenException('Admins cannot demote themselves');
    }
    await this.findOrThrow(id);

    return this.prisma.user.update({ where: { id }, data: { role: dto.role } });
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  private async findOrThrow(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }
}
