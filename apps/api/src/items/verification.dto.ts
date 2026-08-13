import { IsInt, Min } from 'class-validator';

/**
 * POST /api/items/:id/count — a blind verification count entry (EVT-27 AC
 * 2). The client MUST NOT show the book quantity before submitting this —
 * see `ItemsService.count`'s doc comment for why the delta/book value are
 * only revealed in the response.
 */
export class CountItemDto {
  /** How many the counter actually found. */
  @IsInt()
  @Min(0)
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
  /** The upper bound to consume; clamped down to current on-hand. */
  @IsInt()
  @Min(1)
  quantity!: number;
}
