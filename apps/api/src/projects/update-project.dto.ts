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

  /**
   * NOTE: setting `status: 'completed'` via this PATCH is an intentional
   * bypass of the backflush confirmation flow (EVT-28 `POST
   * /:id/backflush`) — `ProjectsService.update` writes the status scalar
   * directly and records no `build` movements. The web app never sends
   * `completed` through this endpoint (it always routes a "Completed"
   * status change through the backflush preview/confirm dialog first, see
   * `ProjectDetailPage`'s `handleStatusChange`), but any other API caller
   * (scripts, future integrations) can mark a project completed without
   * consuming its BOM. This is deliberate, not an oversight: a project
   * with no item-linked BOM lines has nothing to consume, and forcing
   * every completion through backflush would make that trivial case
   * (and any external automation) unnecessarily heavier.
   */
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
