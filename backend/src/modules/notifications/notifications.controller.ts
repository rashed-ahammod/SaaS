/**
 * Routes
 *
 *   n8n, with the event callback token (Authorization: EventToken <X-Callback-Token>):
 *     POST /notifications/events/:eventId/claim      e-mail / SMS messages of the event still to send
 *     POST /notifications/:id/result                 { status: sent|failed, provider, providerMessageId?, error? }
 *     GET  /notifications/:id/attachment             payslip PDF for a payslip e-mail
 *
 *   Signed-in user (Bearer token):
 *     GET  /me/notifications?unread=true             in-app inbox (employee app bell)
 *     POST /me/notifications/:id/read
 *     POST /me/notifications/read-all
 *
 *   Integrations admin:
 *     GET  /notifications/deliveries?status=failed   e-mail / SMS delivery log
 *
 * claim and result need no Idempotency-Key: they are idempotent by design
 * (a repeated claim hands out nothing already sent; a repeated result changes nothing).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  AnyAuthenticated,
  RequirePermission,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import {
  DeliveriesQueryDto,
  InboxQueryDto,
  ReportResultDto,
} from './dto/notifications.dto.js';
import { EventTokenGuard } from './event-token.guard.js';
import { NotificationsService } from './notifications.service.js';

@Controller()
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // POST /notifications/events/:eventId/claim
  @UseGuards(EventTokenGuard)
  @RequirePermission('notifications.relay')
  @SkipIdempotency()
  @Post('notifications/events/:eventId/claim')
  @HttpCode(200)
  claim(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.notificationsService.claim(eventId);
  }

  // POST /notifications/:id/result
  @UseGuards(EventTokenGuard)
  @RequirePermission('notifications.relay')
  @SkipIdempotency()
  @Post('notifications/:id/result')
  @HttpCode(200)
  report(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportResultDto) {
    return this.notificationsService.report(id, dto);
  }

  // GET /notifications/:id/attachment
  @UseGuards(EventTokenGuard)
  @RequirePermission('notifications.relay')
  @Get('notifications/:id/attachment')
  async attachment(@Param('id', ParseUUIDPipe) id: string) {
    const file = await this.notificationsService.attachment(id);
    return new StreamableFile(file.content, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // GET /me/notifications?unread=true
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('me/notifications')
  inbox(@Query() query: InboxQueryDto) {
    return this.notificationsService.inbox(query.unread ?? false);
  }

  // POST /me/notifications/read-all
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('me/notifications/read-all')
  @HttpCode(200)
  markAllRead() {
    return this.notificationsService.markRead('all');
  }

  // POST /me/notifications/:id/read
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('me/notifications/:id/read')
  @HttpCode(200)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notificationsService.markRead(id);
  }

  // GET /notifications/deliveries?status=failed
  @UseGuards(AuthGuard)
  @RequirePermission('integrations.manage')
  @Get('notifications/deliveries')
  deliveries(@Query() query: DeliveriesQueryDto) {
    return this.notificationsService.deliveries(query.status);
  }
}
