import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  const port = config.get<number>('app.port') ?? 3000;
  const apiPrefix = config.get<string>('app.apiPrefix') ?? 'api';
  const nodeEnv = config.get<string>('app.nodeEnv');
  const corsOrigin = config.get<string>('app.corsOrigin') ?? '';
  const corsOrigins = corsOrigin
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // Fail closed, not open. The old default was '*', which combined with
  // credentials: true meant that a missing or mistyped CORS_ORIGIN in
  // production would make the API answer ANY website and hand it the
  // caller's credentials. A misconfiguration should stop the server, not
  // silently widen it.
  if (
    nodeEnv === 'production' &&
    (corsOrigins.length === 0 || corsOrigins.includes('*'))
  ) {
    throw new Error(
      'CORS_ORIGIN must list explicit origins in production ' +
        '(e.g. https://mycongregation.org). Refusing to start with a wildcard.',
    );
  }

  // ---- Security headers (Phase L Phase 4A — data-protection.md) -----------
  //
  // This is a JSON API, not an HTML-rendering app. Configuration rationale:
  //
  // - contentSecurityPolicy: false
  //     CSP protects documents rendering subresources. An API returns JSON
  //     and never embeds scripts, so CSP adds no protection here. The SPA's
  //     own CSP (set by its hosting layer) handles the rendering side.
  //
  // - crossOriginEmbedderPolicy: false
  //     Applies to documents loading cross-origin subresources with COEP.
  //     Irrelevant for an API.
  //
  // - crossOriginResourcePolicy: 'cross-origin'
  //     The SPA at https://mycongregation.org needs to fetch from
  //     https://api.mycongregation.org. CORS already gates this with an
  //     allowlist; CORP stays permissive so the SPA can read responses.
  //     Setting 'same-site' would technically also work (both share the
  //     same eTLD+1) but explicit cross-origin is clearer.
  //
  // - strictTransportSecurity: 2 years, includeSubDomains, preload
  //     Once this has been stable in production for a few weeks without
  //     mixed-content issues, the apex mycongregation.org can be submitted
  //     to https://hstspreload.org. Cloudflare also sets HSTS at the edge;
  //     having both is defense-in-depth — they should announce identical
  //     values (Cloudflare's HSTS panel: 2y / include subdomains / preload).
  //
  // Other helmet defaults stay on, all sensible for an API:
  //   X-Content-Type-Options: nosniff
  //   Referrer-Policy: no-referrer
  //   X-DNS-Prefetch-Control: off
  //   X-Frame-Options: SAMEORIGIN
  //   X-Permitted-Cross-Domain-Policies: none
  //   Origin-Agent-Cluster: ?1
  //   X-XSS-Protection: 0   (clears the legacy header)
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      strictTransportSecurity: {
        maxAge: 63072000, // 2 years in seconds
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  // -------------------------------------------------------------------------

  // Needed so the auth endpoints can read the httpOnly refresh cookie.
  app.use(cookieParser());

  app.setGlobalPrefix(apiPrefix);

  // Outside production an empty or wildcard value stays permissive so that
  // local development and Expo's changing ports keep working.
  app.enableCors({
    origin:
      corsOrigins.length > 0 && !corsOrigins.includes('*') ? corsOrigins : true,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.listen(port);
  logger.log(
    `congmap server listening on http://localhost:${port}/${apiPrefix}`,
  );
}

bootstrap();
