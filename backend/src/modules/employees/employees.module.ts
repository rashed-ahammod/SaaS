import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { EmployeeAccess } from './employee-access.js';
import { EmployeeDirectory } from './employee-directory.service.js';
import { EmployeesController } from './employees.controller.js';
import { EmployeesService } from './employees.service.js';
import { JobHistoryController } from './job-history.controller.js';
import { JobHistoryService } from './job-history.service.js';
import { LifecycleController } from './lifecycle.controller.js';
import { LifecycleService } from './lifecycle.service.js';
import { MeController } from './me.controller.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

/**
 * Employees (WP1): profiles, job history (effective-dated placements),
 * documents, onboarding checklist; probation reviews, separations with clearance
 * and the experience certificate (employee audit 2026-10-21).
 * Owns tables: employees, employee_job_events, employee_assignments,
 *              employee_documents, onboarding_checklists, probation_reviews,
 *              separations, separation_clearances.
 */
@Module({
  imports: [IdentityModule, OrgModule],
  controllers: [
    EmployeesController,
    JobHistoryController,
    OnboardingController,
    DocumentsController,
    MeController,
    LifecycleController,
  ],
  providers: [
    EmployeesService,
    JobHistoryService,
    OnboardingService,
    DocumentsService,
    EmployeeAccess,
    EmployeeDirectory,
    LifecycleService,
  ],
  exports: [
    EmployeesService,
    JobHistoryService,
    EmployeeAccess,
    EmployeeDirectory,
    DocumentsService,
    LifecycleService,
  ],
})
export class EmployeesModule {}
