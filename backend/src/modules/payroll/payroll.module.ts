import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { AttendanceModule } from '../attendance/attendance.module.js';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LeaveModule } from '../leave/leave.module.js';
import { OrgModule } from '../org/org.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { PayrollInputService } from './payroll-input.service.js';
import { PayrollRunsController } from './payroll-runs.controller.js';
import { PayrollRunsService } from './payroll-runs.service.js';
import { PayrollSetupController } from './payroll-setup.controller.js';
import { PayrollStatementsController } from './payroll-statements.controller.js';
import { PayrollStatementsService } from './payroll-statements.service.js';
import { PayrollSetupService } from './payroll-setup.service.js';
import { PayrollVariablesController } from './payroll-variables.controller.js';
import { PayrollVariablesService } from './payroll-variables.service.js';

/**
 * Payroll (WP6): setup (settings, heads, structures, salaries, YTD openings),
 * monthly items and salary advances, and runs calculated by the pure engine in
 * src/payroll-engine, approved maker-checker through the approval engine.
 * Owns tables: payroll_settings, salary_heads, salary_structures, employee_salaries,
 * payroll_ytd_openings, payroll_variables, loans, loan_recoveries, payroll_runs,
 * payroll_run_employees, payroll_lines, payroll_flags, pf_openings, salary_tax_challans.
 * Statements (payroll audit 2026-10-21): PF ledger per member and the annual tax certificate.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    ApprovalsModule,
    AttendanceModule,
    LeaveModule,
    BankAccountsModule,
    RulesModule,
  ],
  controllers: [
    PayrollSetupController,
    PayrollVariablesController,
    PayrollRunsController,
    PayrollStatementsController,
  ],
  providers: [
    PayrollSetupService,
    PayrollVariablesService,
    PayrollInputService,
    PayrollRunsService,
    PayrollStatementsService,
  ],
  exports: [PayrollRunsService, PayrollSetupService, PayrollVariablesService],
})
export class PayrollModule {}
