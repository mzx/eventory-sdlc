import { Module } from '@nestjs/common';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  controllers: [TagsController],
  providers: [TagsService],
  /** Export TagsService so ItemsModule (EVT-3) can inject it for upsert-by-name. */
  exports: [TagsService],
})
export class TagsModule {}
