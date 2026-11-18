import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { CrmModule } from '../crm/crm.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { PayrollModule } from '../payroll/payroll.module.js';
import { CommissionsController } from './commissions.controller.js';
import { CommissionsService } from './commissions.service.js';
import { Gate3Service } from './gate3.service.js';
import { SalesAssistService } from './sales-assist.service.js';

/**
 * Commissions, the sales assistant and Gate 3 (Phase 3 WP31).
 *
 * Commission is worked out from the source documents (invoices, or the money actually
 * collected against them) against each salesperson's monthly target, and posted into payroll
 * as payroll variables on the COMMISSION head — the same route HR uses by hand, so there is
 * one path to a payslip line. The AI sales assistant scores a lead, suggests the next step
 * and drafts follow-up text within the asker's own access, and acts on nothing. The Gate 3
 * report says whether the pilot actually ran its sales pipeline and one appraisal cycle.
 *
 * Owns tables: commission_rules, commission_runs, commission_lines.
 */
@Module({
  imports: [IdentityModule, OrgModule, CrmModule, PayrollModule, AiModule],
  controllers: [CommissionsController],
  providers: [CommissionsService, SalesAssistService, Gate3Service],
  exports: [CommissionsService, Gate3Service],
})
export class CommissionsModule {}
