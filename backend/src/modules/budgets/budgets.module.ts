import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { BudgetPositionService } from './budget-position.service.js';
import { BudgetsController } from './budgets.controller.js';
import { BudgetsService } from './budgets.service.js';

/**
 * Budgets (Phase 2 WP18): an annual budget per department and account, approved by
 * the Admin and changed through approved revisions; actuals from posted vouchers,
 * commitments from issued purchase orders; budget vs actual; alerts at 80 % / 100 %
 * (worker). Procurement asks BudgetPositionService before new spending.
 * Owns tables: budget_settings, budgets, budget_lines, budget_revisions,
 * budget_revision_lines, budget_alerts.
 */
@Module({
  imports: [IdentityModule, OrgModule, ApprovalsModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetPositionService],
  exports: [BudgetsService, BudgetPositionService],
})
export class BudgetsModule {}
