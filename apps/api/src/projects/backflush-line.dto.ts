import { IsInt, IsUUID, Min } from 'class-validator';

/**
 * One line's consumption decision within a `POST /:id/backflush` request
 * (EVT-28). `lineId` must reference an item-linked BOM line on the target
 * project — free-text lines and unknown ids are rejected/ignored by
 * `ProjectsService.backflush` (see its doc comment).
 */
export class BackflushLineDto {
  /** BOM line id to consume against. */
  @IsUUID()
  lineId!: string;

  /**
   * Quantity to consume for this line, 0..line.quantity (per-line override —
   * AC 2). Clamped again server-side against current on-hand before the
   * movement is written (AC 4, shortage handling), so an over-large or
   * stale value here never drives `Item.quantity` negative.
   */
  @IsInt()
  @Min(0)
  consumeQuantity!: number;
}
