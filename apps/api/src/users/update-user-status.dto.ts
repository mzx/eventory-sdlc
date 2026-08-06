import { UserStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateUserStatusDto {
  /** New approval status — `pending` | `approved` | `rejected`. */
  @IsEnum(UserStatus)
  status!: UserStatus;
}
