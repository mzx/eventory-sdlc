import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CategoriesModule } from './categories/categories.module';
import { globalThrottlerConfig } from './common/throttle.config';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { ItemsModule } from './items/items.module';
import { LocationsModule } from './locations/locations.module';
import { PhotosModule } from './photos/photos.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { QrModule } from './qr/qr.module';
import { TagsModule } from './tags/tags.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global per-IP rate limiting (EVT-7 review round 2, finding 1) — see
    // `common/throttle.config.ts` for the env-tunable defaults and the
    // stricter per-route override applied to `POST /api/photos/upload`.
    ThrottlerModule.forRoot(globalThrottlerConfig()),
    DbModule,
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    LocationsModule,
    TagsModule,
    CategoriesModule,
    ItemsModule,
    QrModule,
    AiModule,
    PhotosModule,
    ProjectsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global auth gate (EVT-14) — every route requires an approved user by
    // default; see `JwtAuthGuard`'s doc comment for the `@Public()` /
    // `@AllowPending()` carve-outs. Registered AFTER ThrottlerGuard so an
    // unauthenticated flood is throttled before it reaches the (cheap, but
    // non-zero) DB lookup this guard does per request.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
