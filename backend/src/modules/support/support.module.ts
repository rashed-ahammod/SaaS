import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { Customer360Service } from './customer-360.service.js';
import { SupportAccess } from './support-access.js';
import { SupportController } from './support.controller.js';
import { SupportSettingsService } from './support-settings.service.js';
import { TicketSlaService } from './ticket-sla.service.js';
import { TicketsService } from './tickets.service.js';

/**
 * Support (Phase 3 WP28): customer tickets with a priority, an SLA counted in working hours,
 * assignment, a thread of replies and internal notes, and the Customer 360 page.
 * Owns tables: support_categories, support_sla_policies, support_tickets,
 * support_ticket_messages. Publishes ticket.created, ticket.assigned and
 * ticket.sla_breached; the breach itself is raised by the ticket-sla job (src/jobs.ts).
 */
@Module({
  imports: [IdentityModule, OrgModule, CrmModule, CalendarModule, EmployeesModule],
  controllers: [SupportController],
  providers: [
    SupportAccess,
    SupportSettingsService,
    TicketSlaService,
    TicketsService,
    Customer360Service,
  ],
  exports: [TicketsService, TicketSlaService, SupportAccess],
})
export class SupportModule {}
