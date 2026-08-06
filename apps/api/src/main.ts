import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { STORAGE_DIR, STORAGE_URL_PREFIX } from './photos/photos.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: false, // don't error on extra props (lenient for now)
      transform: true, // coerce primitives
    }),
  );
  // Serve uploaded photos at GET /storage/<filename>, outside the /api
  // prefix — this is Express-level static middleware, not a Nest
  // controller route, so setGlobalPrefix does not affect it.
  app.useStaticAssets(STORAGE_DIR, { prefix: STORAGE_URL_PREFIX });
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
