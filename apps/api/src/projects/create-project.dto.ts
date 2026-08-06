import { ProjectStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateProjectDto {
  /** Human-readable project name. Required, must not be blank. */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Optional long-form description. */
  @IsOptional()
  @IsString()
  description?: string;

  /** Defaults to `planned` when omitted. */
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  /** Free-form notes. */
  @IsOptional()
  @IsString()
  notes?: string;

  /** ISO-8601 date/time the project was (or will be) started. */
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  /** ISO-8601 date/time the project was completed. */
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}
