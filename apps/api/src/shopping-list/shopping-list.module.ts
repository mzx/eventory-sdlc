import { Module } from '@nestjs/common';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';

@Module({
  imports: [
    StockMovementsModule, // provides StockMovementsService: restock() records an `add` movement
  ],
  controllers: [ShoppingListController],
  providers: [ShoppingListService],
  exports: [ShoppingListService],
})
export class ShoppingListModule {}
