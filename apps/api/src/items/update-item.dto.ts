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
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

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
