import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { VatModule } from '../vat/vat.module.js';
import { CatalogueService } from './catalogue.service.js';
import { InvoicesService } from './invoices.service.js';
import { OrdersService } from './orders.service.js';
import { QuotationsService } from './quotations.service.js';
import { ReceiptsService } from './receipts.service.js';
import { SalesController } from './sales.controller.js';

/**
 * Sales (Phase 3 WP25-WP27): products, price lists and discount limits; quotations with the
 * discount chain; orders with the credit check; invoices (Mushak 6.3) and credit notes (6.7)
 * posted to the ledger and the VAT register; receipts allocated to invoices, money on account,
 * VAT deducted by customers; statements and collection reminders.
 * Owns tables: products, price_lists, price_list_items, discount_limits, sales_quotations,
 * sales_quotation_lines, sales_orders, sales_order_lines, sales_invoices, sales_invoice_lines,
 * credit_notes, credit_note_lines, customer_receipts, customer_receipt_allocations,
 * advance_applications, collection_reminders. Writes receivable_items (WP22) for its invoices.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    CrmModule,
    LedgerModule,
    VatModule,
  ],
  controllers: [SalesController],
  providers: [
    CatalogueService,
    QuotationsService,
    OrdersService,
    InvoicesService,
    ReceiptsService,
  ],
  exports: [ReceiptsService],
})
export class SalesModule {}
