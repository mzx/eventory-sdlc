import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { CategoriesModule } from './categories/categories.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { ItemsModule } from './items/items.module';
import { LocationsModule } from './locations/locations.module';
import { PhotosModule } from './photos/photos.module';
import { PrismaModule } from './prisma/prisma.module';
import { QrModule } from './qr/qr.module';
import { TagsModule } from './tags/tags.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    PrismaModule,
    HealthModule,
    LocationsModule,
    TagsModule,
    CategoriesModule,
    ItemsModule,
    QrModule,
    AiModule,
    PhotosModule,
  ],
})
export class AppModule {}
