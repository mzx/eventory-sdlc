import { randomBytes, createHash } from 'crypto';
import { unlink } from 'fs/promises';
import * as path from 'path';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InviteStatus, Prisma, WorkspaceMember, WorkspaceRole } from '@prisma/client';
import { STORAGE_DIR } from '../photos/photos.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from './default-workspace';
import { workspaceDbContext } from './workspace-context';

/** Either the top-level `PrismaService` or a `$transaction` callback's `tx` — both expose the same model delegates. */
type PrismaOrTx = PrismaService | Prisma.TransactionClient;

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

/**
 * SHA-256 of a raw invite token — see `WorkspaceInvite.tokenHash`'s schema
 * doc comment. Exported (EVT-45) so `AuthService.upsertFromGoogleProfile`
 * can look up a `WorkspaceInvite` by its raw token — presented via the OAuth
 * `state` param — without duplicating the hashing scheme or redeeming the
 * invite itself (redemption still only happens through `InvitesService.redeem`,
 * called separately, after sign-in, by the authenticated invitee).
 */
export function hashInviteToken(rawToken: string): string {
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

  /** `client` defaults to `this.prisma`; pass a `$transaction` callback's `tx` to read within that transaction. */
  async requireMembership(
    workspaceId: string,
    userId: string,
    client: PrismaOrTx = this.prisma,
  ): Promise<WorkspaceMember> {
    const membership = await client.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) {
      throw new NotFoundException('Workspace not found');
    }
    return membership;
  }

  async requireOwner(
    workspaceId: string,
    userId: string,
    client: PrismaOrTx = this.prisma,
  ): Promise<WorkspaceMember> {
    const membership = await this.requireMembership(workspaceId, userId, client);
    if (membership.role !== WorkspaceRole.owner) {
      throw new ForbiddenException('Only a workspace owner can perform this action');
    }
    return membership;
  }

  /**
   * Row-locks every current `owner` membership for `workspaceId`
   * (`SELECT ... FOR UPDATE`) so two concurrent last-owner-affecting
   * operations against the SAME workspace properly serialize, rather than
   * each independently observing a stale owner count and both committing
   * (EVT-42 round-2 review, MAJOR — the previous non-transactional
   * check-then-act let two concurrent demote/remove requests against a
   * 2-owner workspace each read `ownerCount === 2` and both commit, leaving
   * zero owners; a plain re-count inside a transaction is NOT sufficient on
   * its own under Postgres's default READ COMMITTED isolation, because two
   * concurrent statements updating DIFFERENT rows don't conflict with each
   * other and each sees the other's write only after it commits — this is
   * the classic write-skew anomaly. Explicitly locking the `owner` rows
   * first forces the second transaction to block until the first commits,
   * then re-evaluate against the now-current state). MUST be called first,
   * inside the same `$transaction` `tx`, before computing `ownerCount`.
   */
  private async lockOwnerRows(tx: Prisma.TransactionClient, workspaceId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "WorkspaceMember" WHERE "workspaceId" = ${workspaceId}::uuid AND role = 'owner' FOR UPDATE`;
  }

  /**
   * Guards against removing/demoting the LAST owner of a workspace (AC3) —
   * a workspace with zero owners can never again be administered.
   * `transferOwnership` (promoting a co-owner first) is the only way past
   * this once it applies. No-op when `currentRole` isn't `owner` — demoting
   * a plain member/viewer never reduces the owner count. MUST be called
   * inside a `$transaction`, passing that transaction's `tx` — see
   * `lockOwnerRows`'s doc comment for why.
   */
  private async assertSafeToRemoveOwner(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    currentRole: WorkspaceRole,
  ): Promise<void> {
    if (currentRole !== WorkspaceRole.owner) {
      return;
    }
    await this.lockOwnerRows(tx, workspaceId);
    const ownerCount = await tx.workspaceMember.count({
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

  /**
   * Permanently deletes a workspace and ALL of its domain data (EVT-47) —
   * items, photos, stock movements, BOM lines, tags, categories, locations,
   * projects, shopping-list entries. Owner-only. No soft-delete/undo (a
   * deliberate non-goal for a household-scale tool with nightly backups).
   *
   * The Default Workspace (`DEFAULT_WORKSPACE_ID`) can NEVER be deleted —
   * every domain column's schema-level `@default(dbgenerated(...))` points
   * at it, and it holds prod's original pre-EVT-42 data (see
   * `schema.prisma`'s header note). 409, not 403/404 — the caller (an
   * owner) is fully authorized and the workspace fully exists; the refusal
   * is a structural invariant, not a permission or existence question.
   *
   * Domain tables FK the workspace with `onDelete: Restrict` (EVT-39,
   * deliberate — see `schema.prisma`'s header note), so every
   * workspace-scoped row must be explicitly removed, in FK-safe dependency
   * order, inside ONE `$transaction`, before the `Workspace` row itself can
   * be deleted: stock movements -> BOM lines -> photos -> items -> tags ->
   * categories -> locations -> projects -> shopping-list entries -> the
   * workspace row. `WorkspaceMember`/`WorkspaceInvite` need no explicit
   * deletion here — both cascade automatically via their own
   * `onDelete: Cascade` FK straight to `Workspace`. Several of the explicit
   * `deleteMany` calls below end up matching zero rows by the time they run
   * (e.g. an item's `ShoppingListEntry`/`StockMovement`/`ItemTag` rows are
   * already gone once that item itself is deleted, via THEIR OWN cascade
   * FKs) — harmless, and kept explicit anyway to match this exact order
   * even if the schema's cascade graph shifts later.
   *
   * **RLS trap (EVT-44).** Every domain table above carries a Postgres RLS
   * policy keyed to the `app.workspace_id` session setting, which
   * `PrismaService` normally drives from the AMBIENT `workspaceDbContext` —
   * populated, per-request, from the CALLER'S currently ACTIVE workspace
   * (`X-Workspace-Id` header / their default membership), which has no
   * necessary relationship to `workspaceId` here (an owner can delete a
   * workspace they aren't currently "in"). Left alone, every `tx.item`/
   * `tx.location`/... delete below would silently apply
   * `set_config('app.workspace_id', <ACTIVE workspace>, true)` instead —
   * FORCE ROW LEVEL SECURITY would then make every one of this workspace's
   * OWN rows invisible to the delete, so it would "succeed" (zero SQL
   * errors) while removing precisely nothing, and the final
   * `tx.workspace.delete` would then fail its `onDelete: Restrict` FK check
   * against rows that are still very much there. Explicitly wrapping the
   * whole transaction in `workspaceDbContext.run({ workspaceId }, ...)`
   * pins the session setting to the TARGET workspace for exactly this call,
   * overriding whatever the ambient request context is.
   *
   * Photo files on disk are unlinked best-effort AFTER the transaction
   * commits — same DB-first ordering rationale as `PhotosService.remove`
   * (a crash between the two can only ever leave a harmless orphaned file
   * on disk, never a row pointing at a file that's already gone).
   */
  async remove(workspaceId: string, userId: string): Promise<void> {
    await this.requireOwner(workspaceId, userId);
    if (workspaceId === DEFAULT_WORKSPACE_ID) {
      throw new ConflictException('The Default Workspace cannot be deleted');
    }

    const deletedPhotos = await workspaceDbContext.run({ workspaceId }, () =>
      this.prisma.$transaction(async (tx) => {
        const photos = await tx.photo.findMany({
          where: { workspaceId },
          select: { filename: true },
        });
        await tx.stockMovement.deleteMany({ where: { workspaceId } });
        await tx.bomLine.deleteMany({ where: { project: { workspaceId } } });
        await tx.photo.deleteMany({ where: { workspaceId } });
        await tx.item.deleteMany({ where: { workspaceId } });
        await tx.tag.deleteMany({ where: { workspaceId } });
        await tx.category.deleteMany({ where: { workspaceId } });
        await tx.location.deleteMany({ where: { workspaceId } });
        await tx.project.deleteMany({ where: { workspaceId } });
        await tx.shoppingListEntry.deleteMany({ where: { workspaceId } });
        await tx.workspace.delete({ where: { id: workspaceId } });
        return photos;
      }),
    );

    await Promise.all(
      deletedPhotos.map((photo) => this.unlinkPhotoQuietly(path.join(STORAGE_DIR, photo.filename))),
    );
  }

  /**
   * Best-effort disk cleanup for `remove()`, mirroring
   * `PhotosService`'s own `unlinkQuietly` — kept as a small local copy
   * rather than injecting `PhotosService` here, which would pull a
   * `PhotosModule` dependency into `WorkspaceModule` for one tiny helper.
   */
  private async unlinkPhotoQuietly(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch {
      // Don't let a missing/unwritable file turn an otherwise-successful
      // workspace deletion into an error — the DB is already the source of
      // truth by the time this runs.
    }
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
   * last-owner guard. Owner-only. Runs entirely inside one `$transaction` —
   * see `assertSafeToRemoveOwner`'s doc comment for why the owner-count
   * check and the mutation must share a transaction (EVT-42 round-2 review,
   * MAJOR).
   */
  async changeRole(
    workspaceId: string,
    targetUserId: string,
    newRole: WorkspaceRole,
    actorId: string,
  ): Promise<MemberSummary> {
    return this.prisma.$transaction(async (tx) => {
      await this.requireOwner(workspaceId, actorId, tx);
      const target = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        include: { user: MEMBER_USER_SELECT },
      });
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      await this.assertSafeToRemoveOwner(tx, workspaceId, target.role);

      const updated = await tx.workspaceMember.update({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
        data: { role: newRole },
        include: { user: MEMBER_USER_SELECT },
      });
      return toMemberSummary(updated);
    });
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
   * the last owner (AC3), same rule as `changeRole`. Runs entirely inside
   * one `$transaction` — see `assertSafeToRemoveOwner`'s doc comment
   * (EVT-42 round-2 review, MAJOR).
   */
  async removeMember(workspaceId: string, targetUserId: string, actorId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const actorMembership = await this.requireMembership(workspaceId, actorId, tx);
      const isSelf = targetUserId === actorId;
      if (!isSelf && actorMembership.role !== WorkspaceRole.owner) {
        throw new ForbiddenException('Only a workspace owner can remove another member');
      }

      const target = isSelf
        ? actorMembership
        : await tx.workspaceMember.findUnique({
            where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
          });
      if (!target) {
        throw new NotFoundException('Member not found');
      }
      await this.assertSafeToRemoveOwner(tx, workspaceId, target.role);

      await tx.workspaceMember.delete({
        where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      });
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

  /**
   * Revokes a pending invite, permanently blocking redemption. Owner-only.
   *
   * The actual state transition is a conditional `updateMany` scoped on
   * `status: pending` (not an unconditional `update` gated by an earlier
   * `findUnique` read) — a raced `InvitesService.redeem` that claims the
   * SAME invite between this method's existence check and its write must
   * not have its `redeemed` status clobbered back to `revoked` (EVT-42
   * clearance review / EVT-45): the pre-fix version read `status: pending`,
   * then unconditionally wrote `revoked` by id alone, so a concurrent
   * redemption that committed `redeemed` in between was silently
   * overwritten — an audit record that says "revoked" for an invite that
   * was actually successfully used. Throwing 409 here instead (whenever the
   * conditional write matches zero rows, whatever the reason) leaves
   * whatever the redemption committed untouched.
   */
  async revoke(workspaceId: string, inviteId: string, actorId: string): Promise<void> {
    await this.workspaces.requireOwner(workspaceId, actorId);
    // Existence/ownership check only — NOT the authority for the state
    // transition below, which re-validates `status: pending` atomically.
    const invite = await this.prisma.workspaceInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.workspaceId !== workspaceId) {
      throw new NotFoundException('Invite not found');
    }
    const claim = await this.prisma.workspaceInvite.updateMany({
      where: { id: inviteId, workspaceId, status: InviteStatus.pending },
      data: { status: InviteStatus.revoked },
    });
    if (claim.count === 0) {
      throw new ConflictException(
        'Invite has already been redeemed, revoked, or expired — nothing to revoke',
      );
    }
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
   * The returned `role` is the upserted membership row's ACTUAL role, read
   * back from the `upsert`'s result — NOT `invite.role` (EVT-42 clearance
   * review / EVT-45 fix). For a brand-new membership these are the same
   * value (the `create` branch stamps `invite.role`), but for an EXISTING
   * member redeeming an invite for a role other than their own, the
   * `update: {}` branch leaves their real role untouched — the response
   * must reflect that, not silently claim the invite's role was granted
   * when it wasn't.
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

      const membership = await tx.workspaceMember.upsert({
        where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: actorId } },
        update: {},
        create: { workspaceId: invite.workspaceId, userId: actorId, role: invite.role },
      });

      return { workspaceId: invite.workspaceId, role: membership.role };
    });
  }
}
