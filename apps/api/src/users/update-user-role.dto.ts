import { UserRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateUserRoleDto {
  /** New role — `user` | `admin`. */
  @IsEnum(UserRole)
  role!: UserRole;
}
