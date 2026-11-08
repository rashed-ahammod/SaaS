import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayablesModule } from '../payables/payables.module.js';
import { ComplianceController } from './compliance.controller.js';
import { ComplianceService } from './compliance.service.js';
import { VatReturnsService } from './vat-returns.service.js';
import { VatController } from './vat.controller.js';
import { VatService } from './vat.service.js';

/**
 * VAT and compliance (Phase 2 WP21): VAT items and their rates per fiscal year, the sales
 * register (VAT invoices with their receipt vouchers) and purchase register (vendor
 * bills), the monthly return (Mushak 9.1 data) tied to the ledger, filed with its
 * settlement journal and VAT challan; the compliance calendar with reminders (outbox ->
 * notifications -> n8n).
 * Owns tables: vat_items, vat_item_rates, vat_sales, vat_sale_lines, vat_returns,
 * compliance_items (VAT challans live in tax_challans with the payables module's).
 */
@Module({
  imports: [IdentityModule, OrgModule, LedgerModule, PayablesModule],
  controllers: [VatController, ComplianceController],
  providers: [VatService, VatReturnsService, ComplianceService],
  exports: [VatService, VatReturnsService, ComplianceService],
})
export class VatModule {}
