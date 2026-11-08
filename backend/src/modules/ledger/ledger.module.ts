import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { DisbursementModule } from '../disbursement/disbursement.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { LedgerPostingService } from './ledger-posting.service.js';
import { LedgerReportsService } from './ledger-reports.service.js';
import { LedgerSetupService } from './ledger-setup.service.js';
import { PfFundController } from './pf-fund.controller.js';
import { PfFundService } from './pf-fund.service.js';
import { LedgerController } from './ledger.controller.js';
import { VouchersService } from './vouchers.service.js';

/**
 * General ledger (Phase 2 WP14): chart of accounts, fiscal years and periods,
 * vouchers with maker-checker, automatic postings from payroll, reports.
 * Owns tables: fiscal_years, accounting_periods, accounts, posting_accounts,
 * voucher_sequences, vouchers, voucher_lines.
 * Reads payroll runs, payroll lines and disbursement files (read-only).
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    PayrollModule,
    DisbursementModule,
  ],
  controllers: [LedgerController, PfFundController],
  providers: [
    LedgerSetupService,
    VouchersService,
    LedgerPostingService,
    LedgerReportsService,
    PfFundService,
  ],
  exports: [VouchersService, LedgerSetupService, LedgerReportsService],
})
export class LedgerModule {}
