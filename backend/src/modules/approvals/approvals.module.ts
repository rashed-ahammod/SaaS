import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { ApprovalChainsService } from './approval-chains.service.js';
import { ApprovalHandlers } from './approval-handlers.js';
import { ApprovalSlaService } from './approval-sla.service.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsService } from './approvals.service.js';
import { ApproverResolver } from './approver-resolver.service.js';

/**
 * Approval workflow engine (WP2). Other modules:
 *   - register a handler for their request type (ApprovalHandlers.register)
 *   - submit requests (ApprovalsService.submit)
 * Owns tables: approval_chains, approval_chain_steps, approval_requests,
 *              approval_step_assignments, approval_actions.
 */
@Module({
  imports: [IdentityModule, OrgModule, EmployeesModule, CalendarModule],
  controllers: [ApprovalsController],
  providers: [
    ApprovalsService,
    ApprovalChainsService,
    ApprovalHandlers,
    ApproverResolver,
    ApprovalSlaService,
  ],
  exports: [ApprovalsService, ApprovalHandlers, ApprovalSlaService],
})
export class ApprovalsModule {}
