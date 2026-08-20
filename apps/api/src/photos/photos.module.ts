import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';
import { StorageController } from './storage.controller';

@Module({
  imports: [AiModule], // provides AiService for ?analyze=true (EVT-7)
  // StorageController (EVT-40) replaces the old express.static wiring for
  // GET /storage/:filename — see its doc comment.
  controllers: [PhotosController, StorageController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
