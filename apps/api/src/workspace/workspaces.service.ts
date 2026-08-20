import { randomBytes, createHash } from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InviteStatus, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  createdAt: Date;
}

export interface MemberSummary {
  userId: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: WorkspaceRole;
  memberSince: Date;
}

export interface InviteWithToken {
  id: string;
  /** Raw, redeemable token — returned ONLY here, at creation. Never stored. */
  token: string;
  role: WorkspaceRole;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

export interface InviteSummary {
  id: string;
  role: WorkspaceRole;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
  redeemedAt: Date | null;
}

export interface RedeemResult {
  workspaceId: string;
  role: WorkspaceRole;
}

/** Single-use invite token lifetime (EVT-42) — 7 days. */
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

const MEMBER_USER_SELECT = { select: { id: true, email: true, name: true, picture: true } };

function toMemberSummary(member: {
  userId: string;
  role: WorkspaceRole;
  createdAt: Date;
  user: { id: string; email: string; name: string | null; picture: string | null };
}): MemberSummary {
  return {
    userId: member.userId,
    email: member.user.email,
    name: member.user.name,
    picture: member.user.picture,
    role: member.role,
    memberSince: member.createdAt,
  };
}

/** SHA-256 of a raw invite token — see `WorkspaceInvite.tokenHash`'s schema doc comment. */
function hashInviteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

// ---------------------------------------------------------------------------
// WorkspacesService — creation, listing, rename, member management
// ---------------------------------------------------------------------------

/**
 * Workspace CRUD + membership management (EVT-42 AC1/AC3/AC4).
 *
 * Deliberately does NOT use `WorkspaceContextGuard`/`@CurrentWorkspace()`
 * (the global per-request tenant-context mechanism, EVT-40) — that resolves
 * the caller's DEFAULT/header-selected workspace, which has no relationship
 * to the `:id` path param these routes target (a caller might be `owner` of
 * their default workspace but only a plain `member` of the workspace named
 * in the URL). Every method here instead does its own explicit
 * `(workspaceId, callerId)` membership/role lookup — see `requireMembership`/
 * `requireOwner`.
 *
 * Non-member of the target workspace -> `NotFoundException` (404), matching
 * the "foreign resource resolves as 404, don't confirm existence" convention
 * `ItemsService`/`PhotosService` established in EVT-40. Member-but-wrong-role
 * -> `ForbiddenException` (403).
 */
@Injectable()
export class WorkspacesService {
  constructor(private readonly prisma: PrismaService) {}

  // -------------------------------------------------------------------------
  // membership/role helpers — shared with InvitesService below
  // -------------------------------------------------------------------------

  async requireMembership(workspaceId: string, userId: string): Promise<WorkspaceMember> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }
    return membership;
  }

  async requireOwner(workspaceId: string, userId: string): Promise<WorkspaceMember> {
    const membership = await this.requireMembership(workspaceId, userId);
    if (membership.role !== WorkspaceRole.owner) {
      throw new ForbiddenException('Only a workspace owner can perform this action');
    }
    return membership;
  }

  /**
   * Guards against removing/demoting the LAST owner of a workspace (AC3) —
   * a workspace with zero owners can never again be administered.
   * `transferOwnership` (promoting a co-owner first) is the only way past
   * this once it applies. No-op when `currentRole` isn't `owner` — demoting
   * a plain member/viewer never reduces the owner count.
   */
  private async assertSafeToRemoveOwner(
    workspaceId: string,
    currentRole: WorkspaceRole,
  ): Promise<void> {
    if (currentRole !== WorkspaceRole.owner) {
      return;
    }
    const ownerCount = await this.prisma.workspaceMember.count({
      where: { workspaceId, role: WorkspaceRole.owner },
    });
    if (ownerCount <= 1) {
      throw new ForbiddenException(
        'Cannot remove or demote the last owner — transfer ownership to another member first',
      );
    }
  }

  // -------------------------------------------------------------------------
  // create / list / rename — AC1
  // -------------------------------------------------------------------------

  /** Creates a new Workspace; the creator becomes its `owner`. */
  async create(name: string, userId: string): Promise<WorkspaceSummary> {
    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({ data: { name } });
      await tx.workspaceMember.create({
        data: { workspaceId: created.id, userId, role: WorkspaceRole.owner },
      });
      return created;
    });
    return {
      id: workspace.id,
      name: workspace.name,
      role: WorkspaceRole.owner,
      createdAt: workspace.createdAt,
    };
  }

  /** Lists every workspace the caller belongs to, oldest membership first, with their role in each. */
  async listMine(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: { workspace: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.workspace.id,
      name: m.workspace.name,
      role: m.role,
      createdAt: m.workspace.createdAt,
    }));
  }

  /** Renames a workspace. Owner-only. */
  async rename(workspaceId: string, name: string, userId: string): Promise<WorkspaceSummary> {
    const membership = await this.requireOwner(workspaceId, userId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name },
    });
    return {
      id: workspace.id,
      name: workspace.name,
      role: membership.role,
      createdAt: workspace.createdAt,
    };
  }

  // -------------------------------------------------------------------------
  // members — AC1/AC3/AC4
  // -------------------------------------------------------------------------

  /** Lists a workspace's members + roles. Reachable by any member (not owner-only). */
  async listMembers(workspaceId: string, userId: string): Promise<MemberSummary[]> {
    await this.requireMembership(workspaceId, userId);
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      include: { user: MEMBER_USER_SELECT },
      orderBy: { createdAt: 'asc' },
    });
    return members.map(toMemberSummary);
  }

  /**
   * Changes an existing member's role between `member` and `viewer` (AC4) —
   * `UpdateMemberRoleDto` validation makes `owner` unreachable here, so this
   * ALSO covers demoting a co-owner down to member/viewer, subject to the
   * last-owner guard. Owner-only.
   */
  async changeRole(
    workspaceId: string,
    targetUserId: string,
    newRole: WorkspaceRole,
    actorId: string,
  ): Promise<MemberSummary> {
    await this.requireOwner(workspaceId, actorId);
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: MEMBER_USER_SELECT },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    await this.assertSafeToRemoveOwner(workspaceId, target.role);

    const updated = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: newRole },
      include: { user: MEMBER_USER_SELECT },
    });
    return toMemberSummary(updated);
  }

  /**
   * Promotes an EXISTING member to `owner` (co-owner — does not touch the
   * caller's own role). This is the ONLY way a workspace gains an owner
   * after creation ("transfer ownership" = promote a successor, then the
   * original owner may freely leave/demote themselves once they're no
   * longer the last owner). Owner-only; 409 if the target is already an
   * owner.
   */
  async transferOwnership(
    workspaceId: string,
    targetUserId: string,
    actorId: string,
  ): Promise<MemberSummary> {
    await this.requireOwner(workspaceId, actorId);
    const target = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      include: { user: MEMBER_USER_SELECT },
    });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    if (target.role === WorkspaceRole.owner) {
      throw new ConflictException('Member is already an owner');
    }

    const updated = await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: WorkspaceRole.owner },
      include: { user: MEMBER_USER_SELECT },
    });
    return toMemberSummary(updated);
  }

  /**
   * Removes a member from a workspace — an owner removing someone else, OR
   * a member/viewer/owner removing themselves ("leave"). Non-owner callers
   * may only target themselves (403 otherwise). Guarded against removing
   * the last owner (AC3), same rule as `changeRole`.
   */
  async removeMember(workspaceId: string, targetUserId: string, actorId: string): Promise<void> {
    const actorMembership = await this.requireMembership(workspaceId, actorId);
    const isSelf = targetUserId === actorId;
    if (!isSelf && actorMembership.role !== WorkspaceRole.owner) {
      throw new ForbiddenException('Only a workspace owner can remove another member');
    }

    const target = isSelf
      ? actorMembership
      : await this.prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        });
    if (!target) {
      throw new NotFoundException('Member not found');
    }
    await this.assertSafeToRemoveOwner(workspaceId, target.role);

    await this.prisma.workspaceMember.delete({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    });
  }
}

// ---------------------------------------------------------------------------
// InvitesService — single-use, expiring workspace invitations (AC2)
// ---------------------------------------------------------------------------

/**
 * Invitation lifecycle: create (owner) -> redeem (any signed-in user) ->
 * membership; revoke (owner) blocks redemption (EVT-42 AC2). No email
 * delivery (non-goal) — the raw token is returned once, at creation, and
 * shared out-of-band.
 *
 * Depends on `WorkspacesService` purely for its `requireOwner` helper — kept
 * as a separate class (rather than folded into `WorkspacesService`) because
 * invites are a distinct lifecycle (create/list/revoke/redeem) with their
 * own model and their own single-use/expiry invariants.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Creates a single-use invite. Owner-only. Role defaults to `member`. */
  async create(
    workspaceId: string,
    role: WorkspaceRole | undefined,
    actorId: string,
  ): Promise<InviteWithToken> {
    await this.workspaces.requireOwner(workspaceId, actorId);

    const rawToken = randomBytes(32).toString('hex');
    const invite = await this.prisma.workspaceInvite.create({
      data: {
        workspaceId,
        tokenHash: hashInviteToken(rawToken),
        role: role ?? WorkspaceRole.member,
        expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
        createdById: actorId,
      },
    });
    return {
      id: invite.id,
      token: rawToken,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };
  }

  /** Lists every invite (any status) for a workspace, newest first. Owner-only. */
  async list(workspaceId: string, actorId: string): Promise<InviteSummary[]> {
    await this.workspaces.requireOwner(workspaceId, actorId);
    const invites = await this.prisma.workspaceInvite.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return invites.map((invite) => ({
      id: invite.id,
      role: invite.role,
      status: invite.status,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
      redeemedAt: invite.redeemedAt,
    }));
  }

  /** Revokes a pending invite, permanently blocking redemption. Owner-only. */
  async revoke(workspaceId: string, inviteId: string, actorId: string): Promise<void> {
    await this.workspaces.requireOwner(workspaceId, actorId);
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.workspaceId !== workspaceId) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== InviteStatus.pending) {
      throw new ConflictException('Invite is not pending');
    }
    await this.prisma.workspaceInvite.update({
      where: { id: inviteId },
      data: { status: InviteStatus.revoked },
    });
  }

  /**
   * Redeems a raw invite token for `actorId`, granting them the invite's
   * `WorkspaceRole` — idempotent if `actorId` is already a member (their
   * existing role is left untouched, never silently changed by a second
   * redemption). The single-use + expiry checks are enforced ATOMICALLY by
   * the conditional `updateMany` inside the transaction (not by a
   * check-then-act read beforehand), so two concurrent redemptions of the
   * same token can never both succeed.
   *
   * 404 for an unknown token (never redeemable, no such credential ever
   * existed from the caller's point of view); 409 once the token is known
   * to exist but has already been claimed, revoked, or has expired.
   */
  async redeem(rawToken: string, actorId: string): Promise<RedeemResult> {
    const tokenHash = hashInviteToken(rawToken);
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { tokenHash } });
    if (!invite) {
      throw new NotFoundException('Invite not found');
    }

    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.workspaceInvite.updateMany({
        where: { id: invite.id, status: InviteStatus.pending, expiresAt: { gt: new Date() } },
        data: { status: InviteStatus.redeemed, redeemedAt: new Date(), redeemedById: actorId },
      });
      if (claim.count === 0) {
        throw new ConflictException('Invite has already been used, revoked, or expired');
      }

      await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: actorId } },
        update: {},
        create: { workspaceId: invite.workspaceId, userId: actorId, role: invite.role },
      });

      return { workspaceId: invite.workspaceId, role: invite.role };
    });
  }
}
