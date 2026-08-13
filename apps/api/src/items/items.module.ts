import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { TagsModule } from '../tags/tags.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [
    TagsModule, // provides TagsService for tag upsert
    AiModule, // provides AiService for search-by-photo (EVT-17)
    StockMovementsModule, // provides StockMovementsService (EVT-25): recordMovement + listForItem
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
