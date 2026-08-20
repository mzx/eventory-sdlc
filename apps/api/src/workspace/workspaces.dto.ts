import { WorkspaceRole } from '@prisma/client';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * The only roles an invite/role-change can ever GRANT (EVT-42). `owner` is
 * deliberately excluded — it can only be granted via
 * `WorkspacesService.transferOwnership`, a separate, explicit action on an
 * EXISTING member (see that method's doc comment for why "promote a
 * co-owner, then leave" is the transfer flow rather than a direct
 * owner-via-role-change path).
 */
export const INVITABLE_ROLES = [WorkspaceRole.member, WorkspaceRole.viewer] as const;

/** POST /api/workspaces body. */
export class CreateWorkspaceDto {
  /** Workspace display name. Required, must not be blank. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

/** PATCH /api/workspaces/:id body. */
export class RenameWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

/** POST /api/workspaces/:id/invites body. */
export class CreateInviteDto {
  /** Role the redeemed invite grants. Defaults to `member` when omitted. */
  @IsOptional()
  @IsIn(INVITABLE_ROLES)
  role?: WorkspaceRole;
}

/** PATCH /api/workspaces/:id/members/:userId/role body. */
export class UpdateMemberRoleDto {
  @IsIn(INVITABLE_ROLES)
  role!: WorkspaceRole;
}
