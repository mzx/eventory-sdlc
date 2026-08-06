import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard';
import { AuthenticatedUser, CurrentUser } from '../auth/decorators';
import { UpdateUserRoleDto } from './update-user-role.dto';
import { UpdateUserStatusDto } from './update-user-status.dto';
import { UsersService } from './users.service';

/**
 * Admin-only user management: list household members and approve/reject/
 * promote them. Every route here additionally requires the global
 * `JwtAuthGuard` (approved user) plus `AdminGuard` (role === admin) — see
 * `AdminGuard`'s doc comment for why only the role check is needed here.
 */
@Controller('users')
@UseGuards(AdminGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** GET /api/users — list every household member, oldest first. */
  @Get()
  list() {
    return this.usersService.list();
  }

  /**
   * PATCH /api/users/:id/status
   *
   * Approve/reject/re-pend a user. 403 when an admin targets themself with
   * anything other than `approved`.
   */
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() actingAdmin: AuthenticatedUser,
  ) {
    return this.usersService.updateStatus(id, dto, actingAdmin!);
  }

  /**
   * PATCH /api/users/:id/role
   *
   * Promote/demote a user. 403 when an admin targets themself with anything
   * other than `admin` (i.e. self-demotion is rejected).
   */
  @Patch(':id/role')
  updateRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserRoleDto,
    @CurrentUser() actingAdmin: AuthenticatedUser,
  ) {
    return this.usersService.updateRole(id, dto, actingAdmin!);
  }
}
