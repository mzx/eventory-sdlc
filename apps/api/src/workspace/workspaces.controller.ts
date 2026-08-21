import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { AllowMissingWorkspace } from './workspace-context';
import {
  CreateInviteDto,
  CreateWorkspaceDto,
  RedeemInviteDto,
  RenameWorkspaceDto,
  UpdateMemberRoleDto,
} from './workspaces.dto';
import { InvitesService, WorkspacesService } from './workspaces.service';

/**
 * Workspace creation, rename, and membership management (EVT-42).
 *
 * Every route requires only the global `JwtAuthGuard` (a resolvable,
 * non-`rejected` user) — deliberately NOT `WorkspaceContextGuard`'s
 * `@CurrentWorkspace()`/`WorkspaceWriteGuard`, since those authorize against
 * the caller's DEFAULT/header-selected workspace, unrelated to the `:id`
 * path param here. See `WorkspacesService`'s doc comment for the
 * authorization model these handlers rely on instead.
 *
 * `create`/`listMine` are additionally `@AllowMissingWorkspace()` — every
 * OTHER route on this controller requires `WorkspaceContextGuard` to have
 * resolved SOME ambient workspace for the caller (EVT-42 round-2 security
 * review, CRITICAL fail-closed fix), which is trivially true for a caller
 * managing a workspace they already belong to, but NOT true for a
 * zero-membership caller creating their very first one — see
 * `AllowMissingWorkspace`'s doc comment for the exhaustive opt-out list.
 */
@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly invitesService: InvitesService,
  ) {}

  /** POST /api/workspaces — create a workspace; the caller becomes its owner. */
  @AllowMissingWorkspace()
  @Post()
  create(@Body() body: CreateWorkspaceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.create(body.name, user!.id);
  }

  /** GET /api/workspaces — every workspace the caller belongs to, with their role in each. */
  @AllowMissingWorkspace()
  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listMine(user!.id);
  }

  /** PATCH /api/workspaces/:id — rename. Owner-only. */
  @Patch(':id')
  rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RenameWorkspaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.rename(id, body.name, user!.id);
  }

  /**
   * DELETE /api/workspaces/:id — permanently deletes a workspace and ALL of
   * its domain data (EVT-47). Owner-only; the Default Workspace is refused
   * with 409 — see `WorkspacesService.remove`'s doc comment for the full
   * dependency-order deletion + RLS-pinning writeup.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.workspacesService.remove(id, user!.id);
  }

  /** GET /api/workspaces/:id/members — roster. Any member may view. */
  @Get(':id/members')
  listMembers(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.listMembers(id, user!.id);
  }

  /**
   * PATCH /api/workspaces/:id/members/:userId/role — change a member's role
   * between `member` and `viewer` (AC4). Owner-only.
   */
  @Patch(':id/members/:userId/role')
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: UpdateMemberRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.changeRole(id, userId, body.role, user!.id);
  }

  /**
   * POST /api/workspaces/:id/members/:userId/transfer-ownership — promotes
   * an existing member to `owner` (co-owner). Owner-only.
   */
  @Post(':id/members/:userId/transfer-ownership')
  transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.transferOwnership(id, userId, user!.id);
  }

  /**
   * DELETE /api/workspaces/:id/members/:userId — owner removes another
   * member, or a member removes themselves ("leave"). AC3 last-owner
   * protection applies to both.
   */
  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.workspacesService.removeMember(id, userId, user!.id);
  }

  /** POST /api/workspaces/:id/invites — create a single-use invite. Owner-only. */
  @Post(':id/invites')
  createInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CreateInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitesService.create(id, body.role, user!.id);
  }

  /** GET /api/workspaces/:id/invites — every invite (any status). Owner-only. */
  @Get(':id/invites')
  listInvites(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invitesService.list(id, user!.id);
  }

  /** DELETE /api/workspaces/:id/invites/:inviteId — revoke a pending invite. Owner-only. */
  @Delete(':id/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('inviteId', ParseUUIDPipe) inviteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.invitesService.revoke(id, inviteId, user!.id);
  }
}

/**
 * Invite redemption (EVT-42) — deliberately a top-level `/api/invites/...`
 * route, not nested under `/api/workspaces/:id`, since the raw token itself
 * (not a workspace id the invitee doesn't know yet) is the only thing the
 * invitee has. Requires only the global `JwtAuthGuard` — the invitee signs
 * in via Google FIRST (creating/resolving their `User` row), THEN redeems
 * while authenticated. `@AllowMissingWorkspace()` — a zero-membership
 * invitee must be able to reach this (AC5's "zero-membership users
 * can... redeem").
 */
@Controller('invites')
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  /**
   * POST /api/invites/redeem — token travels in the JSON body, not the URL
   * (EVT-42 round-2 review, minor: a path segment leaks a redeemable
   * credential into proxy/access logs and browser history the moment
   * request logging is enabled; a POST body does not).
   */
  @AllowMissingWorkspace()
  @Post('redeem')
  redeem(@Body() body: RedeemInviteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invitesService.redeem(body.token, user!.id);
  }
}
