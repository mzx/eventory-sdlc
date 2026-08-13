import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /api/locations/:id/move body (EVT-30 AC 2).
 *
 * `toParentId` omitted or `null` moves the container to root (no parent).
 * `@IsOptional()` covers both "key absent" and, combined with the property
 * being typed `string | null`, lets `null` through the global
 * `ValidationPipe` (see main.ts) without a separate `@IsUUID()` failure on a
 * literal `null` body value.
 */
export class MoveLocationDto {
  @IsOptional()
  @IsUUID()
  toParentId?: string | null;
}
