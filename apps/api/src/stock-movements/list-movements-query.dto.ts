import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Sane upper bound on `page` (EVT-25 review round 2, finding 3) — well
 * beyond any real pagination depth, but low enough that
 * `(page - 1) * pageSize` can never approach Prisma's Int32 `skip` limit.
 */
export const MAX_PAGE = 100_000;

/**
 * GET /api/items/:id/movements query params (EVT-25 AC 5).
 *
 * `@Type(() => Number)` is required for coercion here — the global
 * `ValidationPipe` sets `transform: true` but not `enableImplicitConversion`
 * (see main.ts), so without an explicit `@Type()` a query string like
 * `?page=2` would fail `@IsInt()` (it arrives as the string `"2"`).
 */
export class ListMovementsQueryDto {
  /**
   * 1-indexed page number. Defaults to 1. Capped at `MAX_PAGE` (EVT-25
   * review round 2, finding 3) so an absurd page number 400s here instead
   * of overflowing Prisma's Int32 `skip` (`(page - 1) * pageSize`) into a
   * 500 further down the stack.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;

  /** Rows per page. Defaults to 20, capped at 100. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
