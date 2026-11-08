/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET  /audit-log?entity=&entityId=&action=&actorUserId=&from=&to=&page=&pageSize=
 *   GET  /integrations/outbox?status=dead              failed outgoing events (default: dead)
 *   POST /integrations/outbox/:eventId/replay          send a dead event again
 */
import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AuditLogQueryDto, OutboxQueryDto } from './dto/system.dto.js';
import { SystemService } from './system.service.js';

@Controller()
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  // GET /audit-log
  @UseGuards(AuthGuard)
  @RequirePermission('audit.view', 'audit.view_finance')
  @Get('audit-log')
  auditLog(@Query() query: AuditLogQueryDto) {
    return this.systemService.auditLog(query);
  }

  // GET /integrations/outbox
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @Get('integrations/outbox')
  outboxEvents(@Query() query: OutboxQueryDto) {
    return this.systemService.outboxEvents(query);
  }

  // POST /integrations/outbox/:eventId/replay
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @Post('integrations/outbox/:eventId/replay')
  @HttpCode(200)
  replayOutboxEvent(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.systemService.replayOutboxEvent(eventId);
  }
}
