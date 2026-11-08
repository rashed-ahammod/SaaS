import { Module } from '@nestjs/common';
import { BankModule } from '../bank/bank.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { VatModule } from '../vat/vat.module.js';
import { CloseController } from './close.controller.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { Gate2Service } from './gate2.service.js';
import { MonthCloseService } from './month-close.service.js';
import { OpeningBalancesService } from './opening-balances.service.js';
import { ReceivablesService } from './receivables.service.js';

/**
 * Finance close and Gate 2 (Phase 2 WP22): opening balances from the old system (with the
 * open items behind the control accounts and the old-to-new account map), the receivables
 * sub-ledger, cash flow and department cost reports, the month-end checklist and close, the
 * old system's trial balance compared with ours, and the Gate 2 report.
 * Owns tables: opening_balance_imports, account_map, receivable_items, receivable_receipts,
 * old_system_comparisons, month_close_items.
 */
@Module({
  imports: [IdentityModule, OrgModule, LedgerModule, BankModule, VatModule],
  controllers: [CloseController],
  providers: [
    OpeningBalancesService,
    ReceivablesService,
    FinanceReportsService,
    MonthCloseService,
    Gate2Service,
  ],
  exports: [Gate2Service],
})
export class CloseModule {}
