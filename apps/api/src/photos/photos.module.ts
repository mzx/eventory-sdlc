import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PhotosController } from './photos.controller';
import { PhotosService } from './photos.service';

@Module({
  imports: [AiModule], // provides AiService for ?analyze=true (EVT-7)
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService],
})
export class PhotosModule {}
