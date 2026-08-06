import { ProjectStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListProjectsQueryDto {
  /** Filter to projects with this exact status. */
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;
}
