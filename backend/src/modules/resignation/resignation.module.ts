import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { ResignationController } from './resignation.controller.js';
import { ResignationService } from './resignation.service.js';

/**
 * Resignation from the app (2026-10-30): the employee hands it in, the Dept Head and HR
 * approve, and the separation starts (LifecycleService). A module of its own because the
 * approvals module already depends on employees.
 * Owns table: resignation_requests.
 */
@Module({
  imports: [IdentityModule, OrgModule, EmployeesModule, ApprovalsModule],
  controllers: [ResignationController],
  providers: [ResignationService],
})
export class ResignationModule {}
