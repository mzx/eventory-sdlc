import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DEFAULT_WEB_BASE } from './auth/auth.service';
import { STORAGE_DIR, STORAGE_URL_PREFIX } from './photos/photos.service';

/**
 * Origins allowed to make credentialed (cookie-bearing) requests.
 *
 * `origin: true` reflects ANY request's `Origin` header back with
 * `Access-Control-Allow-Credentials: true` — any site the browser loads can
 * ride the visitor's session cookie. Restricted to the configured
 * `WEB_BASE` plus the dev-default Vite origins instead (EVT-14 review
 * round 2, finding 4).
 */
function allowedCorsOrigins(): Set<string> {
  return new Set(
    [
      process.env.WEB_BASE,
      DEFAULT_WEB_BASE,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ].filter((origin): origin is string => Boolean(origin)),
  );
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');
  // Global JwtAuthGuard (EVT-14) reads the session cookie off `req.cookies`,
  // which only exists once this middleware has parsed the raw `Cookie`
  // header — must run before any route handler / guard sees a request.
  app.use(cookieParser());
  const allowedOrigins = allowedCorsOrigins();
  app.enableCors({
    origin(origin, callback) {
      // No `Origin` header (curl, server-to-server, same-origin requests) —
      // nothing for CORS to police, and there's no browser enforcing
      // same-origin policy to bypass.
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not allowed by CORS`), false);
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
