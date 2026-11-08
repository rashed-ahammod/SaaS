import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { BudgetsModule } from '../budgets/budgets.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayablesModule } from '../payables/payables.module.js';
import { ProcurementCommon } from './procurement-common.js';
import { ProcurementController } from './procurement.controller.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { RequisitionsService } from './requisitions.service.js';

/**
 * Procurement (Phase 2 WP17): purchase requisitions approved by the Dept Head and
 * Accounts (Admin above a threshold), quotations and the comparative statement,
 * purchase orders, goods / service received notes, and the three-way match of
 * vendor bills (a mismatched bill cannot be paid).
 * Owns tables: procurement_settings, purchase_requisitions, purchase_requisition_lines,
 * quotations, quotation_lines, purchase_orders, purchase_order_lines, goods_receipts,
 * goods_receipt_lines (and the match columns of vendor_bills).
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    ApprovalsModule,
    PayablesModule,
    BudgetsModule,
  ],
  controllers: [ProcurementController],
  providers: [ProcurementCommon, RequisitionsService, PurchaseOrdersService],
})
export class ProcurementModule {}
