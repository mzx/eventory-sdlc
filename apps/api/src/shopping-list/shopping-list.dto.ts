import { IsInt, IsUUID, Max, Min } from 'class-validator';

/**
 * POST /api/shopping-list — the one-tap "Running low" action (EVT-26 AC 3),
 * fired from item detail and the scan-landing page.
 */
export class CreateShoppingListEntryDto {
  @IsUUID()
  itemId!: string;
}

/**
 * POST /api/shopping-list/:id/restock — EVT-26 AC 5. The new on-hand
 * quantity the user counted while restocking; the service computes the
 * `add` movement's delta from the item's current quantity.
 */
export class RestockShoppingListEntryDto {
  @IsInt()
  @Min(0)
  @Max(2147483647)
  quantity!: number;
}
