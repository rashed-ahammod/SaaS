import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { ParallelRunController } from './parallel-run.controller.js';
import { ParallelRunService } from './parallel-run.service.js';

/**
 * Gate 1 parallel payroll (WP12, spec §12): the old system's register compared
 * with the ERP's run, differences explained by HR, accepted by Accounts.
 * Reads payroll runs and lines read-only. Owns tables: parallel_run_comparisons,
 * parallel_run_lines.
 */
@Module({
  imports: [IdentityModule, OrgModule],
  controllers: [ParallelRunController],
  providers: [ParallelRunService],
})
export class ParallelRunModule {}
