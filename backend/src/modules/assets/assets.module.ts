import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { AssetsController } from './assets.controller.js';
import { AssetsService } from './assets.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

/**
 * Assets and stock (Phase 2 WP19): the fixed-asset register with tags, assignment to
 * employees (acknowledged in the app; an asset not returned blocks the final
 * settlement), maintenance, monthly depreciation posted to the ledger from a
 * reproducible schedule, disposal; consumables by quantity per store with issue
 * requests the Dept Head approves (stock never below zero).
 * Owns tables: asset_classes, assets, asset_assignments, asset_maintenance,
 * depreciation_runs, depreciation_lines, stores, stock_items, stock_moves,
 * stock_balances, stock_issue_requests, stock_issue_request_lines.
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    ApprovalsModule,
    LedgerModule,
  ],
  controllers: [AssetsController, StockController],
  providers: [AssetsService, StockService],
  exports: [AssetsService],
})
export class AssetsModule {}
