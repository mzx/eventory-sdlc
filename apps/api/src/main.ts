import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { allowedCorsOrigins, corsOriginValidator } from './common/cors.config';
import { resolveHttpsOptions } from './common/https-options';
import { configureTrustProxy } from './common/trust-proxy.config';
import { STORAGE_DIR, STORAGE_URL_PREFIX } from './photos/photos.service';

async function bootstrap(): Promise<void> {
  // HTTPS via mkcert when apps/api/certs/{cert,key}.pem exist (EVT-18) —
  // phone cameras and the Google OAuth redirect (EVT-14) need a secure
  // origin. Falls back to plain HTTP when the certs are absent, so CI and
  // fresh clones without mkcert still boot. See README.md.
  const httpsOptions = resolveHttpsOptions();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    httpsOptions,
  });
  // Must run before enableCors/ValidationPipe/etc — @nestjs/throttler reads
  // req.ip on every guarded request, and behind Caddy that's meaningless
  // without this (EVT-19 review round 2, finding 2; see trust-proxy.config.ts).
  configureTrustProxy(app);
  app.setGlobalPrefix('api');
  // Global JwtAuthGuard (EVT-14) reads the session cookie off `req.cookies`,
  // which only exists once this middleware has parsed the raw `Cookie`
  // header — must run before any route handler / guard sees a request.
  app.use(cookieParser());
  const allowedOrigins = allowedCorsOrigins();
  app.enableCors({
    origin(origin, callback) {
      corsOriginValidator(allowedOrigins, origin, callback);
    },
    credentials: true,
  });
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
  //
  // `X-Content-Type-Options: nosniff` prevents browsers from MIME-sniffing
  // uploaded files (e.g. content declared image/png that a browser decides
  // to render/execute as HTML/script based on sniffed bytes) — user-supplied
  // static content is exactly the case this header exists for.
  app.useStaticAssets(STORAGE_DIR, {
    prefix: STORAGE_URL_PREFIX,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
