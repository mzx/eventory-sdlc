import { IsInt, Max, Min } from 'class-validator';

/**
 * POST /api/items/:id/count — a blind verification count entry (EVT-27 AC
 * 2). The client MUST NOT show the book quantity before submitting this —
 * see `ItemsService.count`'s doc comment for why the delta/book value are
 * only revealed in the response.
 */
export class CountItemDto {
  /**
   * How many the counter actually found. `@Max(2147483647)` mirrors the
   * bound every other integer field on `CreateItemDto`/`UpdateItemDto`
   * carries to match the Postgres INTEGER column — without it, a value like
   * 1e18 passes class-validator but fails as an unhandled 500 in Prisma
   * instead of a 400 (EVT-27 review round 2, finding 2).
   */
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;
}

/**
 * POST /api/items/:id/consume — records a `consume` movement for up to
 * `quantity` (race-safe, clamped to on-hand — see
 * `StockMovementsService.recordConsumption`). The response's
 * `offerVerification` flag is what drives the opportunistic "how many are
 * actually left?" prompt (EVT-27 AC 4).
 */
export class ConsumeItemDto {
  /**
   * The upper bound to consume; clamped down to current on-hand.
   * `@Max(2147483647)` — see `CountItemDto.quantity` above.
   */
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
