import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { EventTokenGuard } from './event-token.guard.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Notifications (WP10): turns outbox events into messages (who, what, which
 * channel, which language), hands e-mail / SMS to n8n exactly once per message,
 * keeps the delivery log, and serves the in-app inbox.
 * Owns tables: notification_events, notifications.
 */
@Module({
  imports: [IdentityModule, OrgModule, PayrollModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, EventTokenGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
