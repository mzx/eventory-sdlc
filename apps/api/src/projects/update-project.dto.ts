import { ProjectStatus } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** All fields are optional for PATCH semantics. */
export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  /** ISO-8601 date/time; pass an empty string to clear it. */
  @IsOptional()
  @IsDateString()
  startedAt?: string;

  /** ISO-8601 date/time; pass an empty string to clear it. */
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}
