import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { allowedCorsOrigins, corsOriginValidator } from './common/cors.config';
import { resolveHttpsOptions } from './common/https-options';
import { configureTrustProxy } from './common/trust-proxy.config';

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
  app.setGlobalPrefix('api', {
    // GET /storage/:filename (EVT-40 StorageController) stays mounted
    // outside the /api prefix — the web app's STORAGE_URL_PREFIX constant
    // and the Vite dev proxy both assume this exact path shape. The route
    // itself is still a normal, fully-guarded Nest controller (unlike the
    // `express.static` middleware it replaces) — only the URL prefix is
    // excluded here, not the guard chain.
    exclude: [{ path: 'storage/:filename', method: RequestMethod.GET }],
  });
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
  // Uploaded photos are served by StorageController (EVT-40,
  // GET /storage/:filename) — see its doc comment for why this is no
  // longer plain `express.static` middleware.
  const port = process.env.PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
}

bootstrap();
