import { ValidationPipe, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { httpMetrics } from './platform/monitoring/http-metrics.js';

/**
 * Response headers for a JSON-only API (guide §20, WP12 security review). The API
 * serves no HTML, so it may never be framed, sniffed or cached by a shared proxy.
 * HSTS is added by production config (TLS ends at the load balancer).
 */
export function securityHeaders(hsts: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // personal data must not sit in shared caches
    res.setHeader('Cache-Control', 'no-store');
    if (hsts)
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    next();
  };
}

/** Settings shared by the real server (main.ts) and the integration tests. */
export function configureApp(
  app: INestApplication,
  options: { hsts?: boolean } = {},
) {
  const express = app as NestExpressApplication;
  // Check every @Body() DTO; reject unknown fields so nothing unexpected reaches a service.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Behind a load balancer, read the client IP from X-Forwarded-For (for audit and rate limits).
  express.set('trust proxy', 1);
  // do not advertise the framework
  express.disable('x-powered-by');
  express.use(securityHeaders(options.hsts ?? false));
  // request counts and latency for the error-rate and latency alerts (GET /metrics)
  express.use(httpMetrics.middleware());
  // JSON bodies up to 1 MB (a Bangla policy document is ~3 bytes a character); uploads use multipart limits
  express.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
}
