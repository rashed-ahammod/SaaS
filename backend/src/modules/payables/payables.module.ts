import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { RulesModule } from '../rules/rules.module.js';
import { PayablesReportsService } from './payables-reports.service.js';
import { PayablesController } from './payables.controller.js';
import { TaxAtSourceService } from './tax-at-source.service.js';
import { VendorBillsService } from './vendor-bills.service.js';
import { VendorPaymentsService } from './vendor-payments.service.js';
import { VendorsService } from './vendors.service.js';

/**
 * Vendors, bills and tax at source (Phase 2 WP15): vendors and their bank accounts,
 * vendor bills posted on approval, vendor payments and tax challans through the
 * voucher maker-checker, withholding certificates, aged payables, and the nightly
 * check that the payables account equals the open bills.
 * Owns tables: payables_settings, vendors, vendor_bank_accounts, vendor_bills,
 * vendor_bill_lines, vendor_payments, vendor_payment_allocations, tax_withholdings,
 * tax_challans, tax_certificates, payables_sequences.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    RulesModule,
    LedgerModule,
  ],
  controllers: [PayablesController],
  providers: [
    VendorsService,
    VendorBillsService,
    VendorPaymentsService,
    TaxAtSourceService,
    PayablesReportsService,
  ],
  exports: [VendorsService, VendorBillsService],
})
export class PayablesModule {}
