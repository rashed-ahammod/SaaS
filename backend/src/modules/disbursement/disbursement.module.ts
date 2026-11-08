import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { BankAccountsModule } from '../bank-accounts/bank-accounts.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { DisbursementController } from './disbursement.controller.js';
import { DisbursementService } from './disbursement.service.js';

/**
 * Disbursement (WP7): payments of approved payroll runs, bank / wallet / cash
 * files (adapters.ts), settlement, return files, re-issue, cancel with approval.
 * Payslip PDFs and the salary journal live in the payroll module.
 * Owns tables: payments, disbursement_files.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    BankAccountsModule,
    PayrollModule,
  ],
  controllers: [DisbursementController],
  providers: [DisbursementService],
  exports: [DisbursementService],
})
export class DisbursementModule {}
