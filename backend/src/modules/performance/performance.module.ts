import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { AppraisalsService } from './appraisals.service.js';
import { KpiService } from './kpi.service.js';
import { PerformanceController } from './performance.controller.js';
import { ProposalsService } from './proposals.service.js';
import { ReviewDraftService } from './review-draft.service.js';

/**
 * Performance (Phase 3 WP30; spec §6.5): appraisal cycles, the KPI library, goals with
 * weights, the employee's self-review, the Dept Head's rating, HR's calibration across
 * departments, continuous feedback notes, and increment / promotion proposals — which, once
 * the Admin approves them, become an effective-dated salary change (so payroll pays the
 * arrears itself) and a job event. AI drafts the manager's comment from the year's feedback
 * and never rates anybody.
 *
 * Owns tables: kpi_library, appraisal_cycles, appraisals, appraisal_goals, feedback_notes,
 * increment_proposals. Request type: increment_proposal (Admin, with HR first for a
 * promotion).
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    EmployeesModule,
    PayrollModule,
    AiModule,
  ],
  controllers: [PerformanceController],
  providers: [
    AppraisalsService,
    KpiService,
    ProposalsService,
    ReviewDraftService,
  ],
  exports: [AppraisalsService, ProposalsService],
})
export class PerformanceModule {}
