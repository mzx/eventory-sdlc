import { Module } from '@nestjs/common';
import { StockMovementsService } from './stock-movements.service';

@Module({
  providers: [StockMovementsService],
  /**
   * Exported for ItemsModule (EVT-25): `ItemsService.create`/`update` call
   * `recordMovement`, and `ItemsController` calls `listForItem` directly for
   * `GET /api/items/:id/movements` — there's no separate top-level
   * controller since movements are always read/written item-scoped.
   */
  exports: [StockMovementsService],
})
export class StockMovementsModule {}
