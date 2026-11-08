/**
 * GET /metrics is for the monitoring system only: Authorization: Bearer <METRICS_TOKEN>.
 * Without METRICS_TOKEN configured the route does not exist (404).
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';

@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.monitoring.metricsToken;
    if (!expected) throw new NotFoundException();
    const header =
      context.switchToHttp().getRequest<Request>().header('authorization') ??
      '';
    const given = Buffer.from(header.replace(/^Bearer\s+/i, ''));
    const want = Buffer.from(expected);
    if (given.length !== want.length || !timingSafeEqual(given, want))
      throw new UnauthorizedException();
    return true;
  }
}
