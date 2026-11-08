/**
 * Routes for uptime checks and monitoring (guide §22). No tenant data.
 *
 *   GET /health          public liveness: the API answers and reaches the database
 *   GET /health/ready    public readiness: database ok and every migration applied (deploy gate)
 *   GET /metrics         Prometheus text, Authorization: Bearer <METRICS_TOKEN>
 */
import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../db/database.service.js';
import { MetricsTokenGuard } from '../monitoring/metrics-token.guard.js';
import { MonitoringService } from '../monitoring/monitoring.service.js';

@Controller()
export class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly monitoringService: MonitoringService,
  ) {}

  // GET /health  — public
  @Get('health')
  async check() {
    try {
      await sql`SELECT 1`.execute(this.db.kysely);
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ServiceUnavailableException('database unavailable');
    }
  }

  // GET /health/ready  — public
  @Get('health/ready')
  ready() {
    return this.monitoringService.ready();
  }

  // GET /metrics  — monitoring system only
  @UseGuards(MetricsTokenGuard)
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4')
  metrics() {
    return this.monitoringService.prometheus();
  }
}
