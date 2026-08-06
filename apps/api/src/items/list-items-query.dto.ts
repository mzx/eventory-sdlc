import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListItemsQueryDto {
  /**
   * Full-text style search: matches item name, description, and any value
   * inside the `properties` JSONB column (case-insensitive ILIKE).
   */
  @IsOptional()
  @IsString()
  search?: string;

  /** Filter to items that carry a tag with this exact name. */
  @IsOptional()
  @IsString()
  tag?: string;

  /**
   * Filter to items whose location is the given location or any of its
   * descendants (materialized-path prefix match).
   */
  @IsOptional()
  @IsUUID()
  locationId?: string;
}
