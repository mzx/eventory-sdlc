import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * All fields are optional for PATCH semantics.
 * When `itemId` is provided, `name` is re-copied from that item (overriding
 * any `name` also present in the same request body).
 */
export class UpdateBomLineDto {
  /** Re-link (or link) the line to an inventory item; its name is copied. */
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
