import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * All fields are optional for PATCH semantics.
 * When `tags` is provided the tag list is fully replaced (not merged).
 */
export class UpdateItemDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity?: number;

  /**
   * Replenishment threshold (EVT-26). `undefined` (key omitted) leaves it
   * unchanged; explicit `null` clears it back to "no replenishment
   * tracking" — same undefined-vs-null convention as `locationId` below.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  minQuantity?: number | null;

  /**
   * Count cadence in days (EVT-27). `undefined` (key omitted) leaves it
   * unchanged; explicit `null` clears it back to "not on a count schedule"
   * — same undefined-vs-null convention as `minQuantity` above. Capped at
   * ~10 years (3650 days), well past any sane "count this every N days"
   * value, so a typo can't silently push an item off the queue forever.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  countIntervalDays?: number | null;

  /**
   * Manual override of the last-verified timestamp (EVT-27 AC 1). Most
   * verifications are stamped automatically by `ItemsService.count`/
   * `.consume`; this lets the item form correct a mistaken date. ISO date
   * string; `undefined` leaves it unchanged, explicit `null` clears it back
   * to "never verified".
   */
  @IsOptional()
  @IsDateString()
  lastVerifiedAt?: string | null;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  /**
   * `undefined` (key omitted) leaves the relation unchanged; explicit `null`
   * clears it (Prisma disconnect). `@IsOptional()` skips validation for both
   * `undefined` and `null`, so a `null` value bypasses `@IsUUID()` and reaches
   * the service, where it is forwarded to Prisma as `locationId: null`.
   */
  @IsOptional()
  @IsUUID()
  locationId?: string | null;

  /** See `locationId` above — same undefined-vs-null "leave unchanged" vs "clear" semantics. */
  @IsOptional()
  @IsUUID()
  categoryId?: string | null;

  /** When provided, replaces the item's tag list entirely. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * When provided, the first ID becomes the new primary photo.
   * Existing photo associations are preserved; this only updates `primaryPhotoId`.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  photoIds?: string[];
}
