import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateItemDto {
  /** Human-readable display name. Required, must not be blank. */
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** Optional long-form description. */
  @IsOptional()
  @IsString()
  description?: string;

  /** Quantity on hand; defaults to 1. */
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity?: number;

  /** Unit of measure (e.g. "pcs", "m", "kg"). */
  @IsOptional()
  @IsString()
  unit?: string;

  /**
   * Free-form JSONB attributes (e.g. { "voltage": "12V", "brand": "Bosch" }).
   * Defaults to `{}` when omitted.
   */
  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  /** UUID of the storage location (must exist). */
  @IsOptional()
  @IsUUID()
  locationId?: string;

  /** UUID of the classification category (must exist). */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /**
   * Tag names to attach. Tags are upserted by name, so new names are created
   * and existing ones are reused.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  /**
   * IDs of existing Photo records to attach to this item. The first ID in the
   * array becomes the primary photo.
   */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  photoIds?: string[];
}
