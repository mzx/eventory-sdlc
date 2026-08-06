import { ProjectStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/** All fields are optional for PATCH semantics. */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /**
   * ISO-8601 date/time; pass an empty string to clear it.
   * `@ValidateIf` skips `@IsDateString` for the empty-string case — without
   * it, class-validator rejects `''` before ProjectsService.update() ever
   * gets a chance to convert it to `null`.
   */
  @IsOptional()
  @ValidateIf((o) => o.startedAt !== '')
  @IsDateString()
  startedAt?: string;

  /** ISO-8601 date/time; pass an empty string to clear it. */
  @IsOptional()
  @ValidateIf((o) => o.completedAt !== '')
  @IsDateString()
  completedAt?: string;
}
