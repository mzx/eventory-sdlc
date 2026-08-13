import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * GET /api/items/:id/movements query params (EVT-25 AC 5).
 *
 * `@Type(() => Number)` is required for coercion here — the global
 * `ValidationPipe` sets `transform: true` but not `enableImplicitConversion`
 * (see main.ts), so without an explicit `@Type()` a query string like
 * `?page=2` would fail `@IsInt()` (it arrives as the string `"2"`).
 */
export class ListMovementsQueryDto {
  /** 1-indexed page number. Defaults to 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  /** Rows per page. Defaults to 20, capped at 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
