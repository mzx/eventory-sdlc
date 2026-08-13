import { LocationKind } from '@prisma/client';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * POST /api/locations body.
 *
 * Converted from a plain interface to a class-validator class (EVT-30 review
 * round 2, finding 3) — as a plain interface the global `ValidationPipe`
 * (whitelist-only, no shape validation of its own) let an invalid `kind`
 * (e.g. `"box"`) straight through to Prisma, which surfaced it as a raw 500
 * from the Postgres enum constraint instead of a 400.
 */
export class CreateLocationDto {
  /** Human-readable location name. Required, must not be blank. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  /** Parent location id. Omitted (or absent) creates a root location. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  /** Free-form notes. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Defaults to `area` (matches the Prisma column default) when omitted. */
  @IsOptional()
  @IsEnum(LocationKind)
  kind?: LocationKind;
}
