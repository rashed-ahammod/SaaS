import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';
import { CompaniesController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';
import { DepartmentsController } from './departments.controller.js';
import { DepartmentsService } from './departments.service.js';
import { DesignationsController } from './designations.controller.js';
import { DesignationsService } from './designations.service.js';
import { GradesController } from './grades.controller.js';
import { GradesService } from './grades.service.js';
import { OrgLookupService } from './org-lookup.service.js';

/**
 * Organization (WP1): companies, branches, departments, designations, grades.
 * Owns tables: companies, branches, departments, department_paths, designations, grades.
 * Other modules use OrgLookupService only.
 */
@Module({
  imports: [IdentityModule],
  controllers: [
    CompaniesController,
    BranchesController,
    DepartmentsController,
    DesignationsController,
    GradesController,
  ],
  providers: [
    CompaniesService,
    BranchesService,
    DepartmentsService,
    DesignationsService,
    GradesService,
    OrgLookupService,
  ],
  exports: [OrgLookupService],
})
export class OrgModule {}
