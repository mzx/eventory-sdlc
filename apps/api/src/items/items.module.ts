import { Module } from '@nestjs/common';
import { TagsModule } from '../tags/tags.module';
import { ItemsController } from './items.controller';
import { ItemsService } from './items.service';

@Module({
  imports: [TagsModule], // provides TagsService for tag upsert
  controllers: [ItemsController],
  providers: [ItemsService],
  exports: [ItemsService],
})
export class ItemsModule {}
