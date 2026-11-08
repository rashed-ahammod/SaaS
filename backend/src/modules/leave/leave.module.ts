import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { LeaveLedgerService } from './leave-ledger.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';
import { LeaveTypesController } from './leave-types.controller.js';
import { LeaveTypesService } from './leave-types.service.js';
import { LeaveController } from './leave.controller.js';

/**
 * Leave (WP5): policy, leave types (Bangladesh defaults from the rule pack),
 * ledger-based balances, requests through the approval engine, accrual and
 * year-end jobs. Tells attendance which days are "On leave".
 * Owns tables: leave_policies, leave_types, leave_ledger, leave_requests, leave_encashments.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    CalendarModule,
    ApprovalsModule,
    AttendanceModule,
    RulesModule,
  ],
  controllers: [LeaveTypesController, LeaveController],
  providers: [LeaveTypesService, LeaveLedgerService, LeaveRequestsService],
  exports: [LeaveLedgerService],
})
export class LeaveModule {}
