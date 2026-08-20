import { WorkspaceRole } from '@prisma/client';
import { Transform } from 'class-transformer';
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

/**
 * Trims a string field before `@IsNotEmpty()`/`@MaxLength()` validate it
 * (EVT-42 round-2 review, minor) — without this, `"   "` passes
 * `@IsNotEmpty()` (it's a non-empty string) and creates/renames a workspace
 * with a whitespace-only, effectively blank name.
 */
const TrimString = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/** POST /api/workspaces body. */
export class CreateWorkspaceDto {
  /** Workspace display name. Required, must not be blank (whitespace-only rejected). */
  @TrimString()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;
}

/** PATCH /api/workspaces/:id body. */
export class RenameWorkspaceDto {
  @TrimString()
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

/**
 * POST /api/invites/redeem body (EVT-42 round-2 review, minor) — the raw
 * token travels in the JSON body, not the URL path. A path segment
 * (`POST /api/invites/:token/redeem`, the original shape) leaks into proxy/
 * access logs and browser history the moment request logging is enabled;
 * a POST body does not.
 */
export class RedeemInviteDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
