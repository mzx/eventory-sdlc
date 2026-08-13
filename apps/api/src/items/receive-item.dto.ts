import { IsInt, Max, Min } from 'class-validator';

/**
 * POST /api/items/:id/receive — EVT-31 AC 4 ("add to existing"). The
 * quantity to add to the matched item's on-hand count; the service records
 * it as an `add` movement (see `ShoppingListService.restock`'s
 * `RestockShoppingListEntryDto` for the same bound-integer shape, used for
 * the analogous `POST /api/shopping-list/:id/restock` write).
 */
export class ReceiveItemDto {
  @IsInt()
  @Min(1)
  @Max(2147483647)
  quantity!: number;
}
