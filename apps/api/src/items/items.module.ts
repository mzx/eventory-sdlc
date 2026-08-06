import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { TagsModule } from '../tags/tags.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [
    TagsModule, // provides TagsService for tag upsert
    AiModule, // provides AiService for search-by-photo (EVT-17)
  ],
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
