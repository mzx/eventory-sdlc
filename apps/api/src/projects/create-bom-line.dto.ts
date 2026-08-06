import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * Either `itemId` (link to an inventory item — its `name` is copied) or
 * `name` (free text) must be supplied. Enforced in ProjectsService, since
 * class-validator doesn't cleanly express "exactly one of" across fields.
 */
export class CreateBomLineDto {
  /** UUID of an inventory item to link. When provided, its name is copied. */
  @IsOptional()
  @IsUUID()
  itemId?: string;

  /** Free-text line name. Required when `itemId` is omitted. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  /** Quantity needed; defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  /** Unit of measure (e.g. "pcs", "m", "kg"). */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  /** Free-form notes. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
