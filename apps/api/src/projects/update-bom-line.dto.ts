import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/**
 * All fields are optional for PATCH semantics.
 * When `itemId` is provided, `name` is re-copied from that item (overriding
 * any `name` also present in the same request body).
 *
 * Pass `itemId: null` to unlink the line from its inventory item — the
 * denormalized `name` is left untouched (same shape as `onDelete: SetNull`
 * when the linked item itself is deleted). `@IsOptional()` skips all
 * subsequent validators (including `@IsUUID()`) for `null` as well as
 * `undefined`, so no extra `@ValidateIf` is needed here.
 */
export class UpdateBomLineDto {
  /** Re-link (or link) the line to an inventory item; its name is copied.
   *  Pass `null` to unlink. */
  @IsOptional()
  @IsUUID()
  itemId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
