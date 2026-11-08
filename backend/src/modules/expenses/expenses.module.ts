import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { EmployeeAdvancesService } from './employee-advances.service.js';
import { ExpenseClaimsService } from './expense-claims.service.js';
import { ExpensesCommon } from './expenses-common.js';
import { ExpensesController } from './expenses.controller.js';

/**
 * Expense claims and employee advances (Phase 2 WP16): claims with receipts from the
 * employee app, cash advances, salary-advance payout, the advances sub-ledger and its
 * nightly check against the staff advances account.
 * Owns tables: expense_categories, expense_claims, expense_claim_lines, expense_receipts,
 * expense_advances, advance_settlements; writes loans (payout, origin) and loans from advances.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    ApprovalsModule,
    LedgerModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesCommon, ExpenseClaimsService, EmployeeAdvancesService],
})
export class ExpensesModule {}
