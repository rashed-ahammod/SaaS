import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { ApplicantsService } from './applicants.service.js';
import { CvScreeningService } from './cv-screening.service.js';
import { InterviewsService } from './interviews.service.js';
import { ManpowerService } from './manpower.service.js';
import { OffersService } from './offers.service.js';
import { OpeningsService } from './openings.service.js';
import { PositionsService } from './positions.service.js';
import { RecruitmentController } from './recruitment.controller.js';

/**
 * Recruitment (Phase 3 WP29): the manpower plan, new-position requests through the approval
 * engine, job openings and where they were advertised, applicants with their consent and
 * retention, applications with their stages, interviews with scorecards, offers with their
 * letter, and hiring — which turns the applicant's own data into an employee record with
 * nothing retyped. AI CV screening sees a CV with the person removed from it.
 *
 * Owns tables: manpower_plans, manpower_plan_lines, position_requests, job_openings,
 * job_postings, applicants, applications, application_events, interviews, interview_panel,
 * interview_scorecards, job_offers, cv_screenings.
 * Request types: new_position (HR -> Admin), job_offer (Admin, only outside the grade range).
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    ApprovalsModule,
    EmployeesModule,
    AiModule,
  ],
  controllers: [RecruitmentController],
  providers: [
    ManpowerService,
    PositionsService,
    OpeningsService,
    ApplicantsService,
    InterviewsService,
    OffersService,
    CvScreeningService,
  ],
  exports: [ApplicantsService, OffersService, CvScreeningService],
})
export class RecruitmentModule {}
