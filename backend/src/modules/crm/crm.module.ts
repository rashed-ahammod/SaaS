import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { CrmAccess } from './crm-access.js';
import { CrmKeys } from './crm-keys.js';
import { CrmController } from './crm.controller.js';
import { CustomersService } from './customers.service.js';
import { LeadsService } from './leads.service.js';
import { OpportunitiesController } from './opportunities.controller.js';
import { OpportunitiesService } from './opportunities.service.js';
import { SalesPipelineService } from './sales-pipeline.service.js';
import { TerritoriesService } from './territories.service.js';

/**
 * CRM (Phase 3): WP23 customers and leads; WP24 opportunities, the pipeline and targets. Leads from outside (n8n) and from salespeople,
 * never duplicating a phone or e-mail, each with an owner at once (territory, then in turn);
 * activities and tasks; qualification into customers; the customer master with credit terms
 * set by Accounts. Scope: the Sales user's own records, the Sales head's department, the
 * company for the Admin.
 * Owns tables: sales_territories, sales_territory_members, crm_assignment_cursors, customers,
 * customer_contacts, leads, crm_contact_keys, crm_activities; opportunity_stages, opportunities,
 * opportunity_stage_history (written by a trigger), sales_targets.
 */
@Module({
  imports: [IdentityModule, OrgModule],
  controllers: [CrmController, OpportunitiesController],
  providers: [
    CrmAccess,
    CrmKeys,
    CustomersService,
    LeadsService,
    TerritoriesService,
    OpportunitiesService,
    SalesPipelineService,
  ],
  exports: [CrmAccess, CustomersService, LeadsService, OpportunitiesService],
})
export class CrmModule {}
