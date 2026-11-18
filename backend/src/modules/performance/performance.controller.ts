/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 * Cycles (HR)
 *   GET   /companies/:companyId/appraisal-cycles
 *   POST  /companies/:companyId/appraisal-cycles      { name, kind, periodFrom, periodTo, incrementFrom?, note? }
 *   GET   /appraisal-cycles/:cycleId
 *   POST  /appraisal-cycles/:cycleId/open             one appraisal per active employee
 *   POST  /appraisal-cycles/:cycleId/advance          the next phase, forward only
 *   GET   /appraisal-cycles/:cycleId/calibration      the spread of ratings per department
 *   GET   /appraisal-cycles/:cycleId/mine             my own appraisal
 *   GET   /appraisal-cycles/:cycleId/my-team          my team's appraisals (Dept Head)
 *
 * One appraisal
 *   GET   /appraisals/:appraisalId
 *   PUT   /appraisals/:appraisalId/goals              manager or HR  { goals: [ { title, weight, kpiId?, target? } ] }
 *   POST  /appraisals/:appraisalId/self-review        the employee  { review, scores? }
 *   POST  /appraisals/:appraisalId/rate               the manager  { rating, comment, scores? }
 *   POST  /appraisals/:appraisalId/calibrate          HR  { rating, note? }
 *   POST  /appraisals/:appraisalId/review-draft       AI: a draft for the manager to rewrite
 *
 * KPI library
 *   GET   /companies/:companyId/kpis?designationId=&all=1
 *   POST  /companies/:companyId/kpis                  HR  { code, title, measure?, designationId?, defaultWeight? }
 *   PUT   /kpis/:kpiId                                HR  { version, ... }
 *
 * Continuous feedback
 *   GET   /employees/:employeeId/feedback?since=
 *   POST  /employees/:employeeId/feedback             { body, kind?, sharedWithEmployee? }
 *
 * Increment and promotion proposals
 *   GET   /companies/:companyId/increment-proposals?state=
 *   POST  /appraisals/:appraisalId/proposal           HR  { kind, newGross?, structureId?, newDesignationId?, newGradeId?, effectiveFrom?, justification }
 *   GET   /increment-proposals/:proposalId
 *   POST  /increment-proposals/:proposalId/apply      HR, after the Admin approved it
 *   POST  /increment-proposals/:proposalId/withdraw   HR  { reason }
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { ShortTransactions } from '../../platform/tenancy/tenant-transaction.interceptor.js';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AppraisalsService } from './appraisals.service.js';
import {
  CalibrateDto,
  CycleDto,
  FeedbackDto,
  GoalsDto,
  KpiDto,
  ProposalDto,
  RateDto,
  ReasonDto,
  SelfReviewDto,
  UpdateKpiDto,
} from './dto/performance.dto.js';
import { KpiService } from './kpi.service.js';
import { ProposalsService } from './proposals.service.js';
import { ReviewDraftService } from './review-draft.service.js';

const SEE = [
  'performance.view',
  'performance.manage',
  'performance.rate',
  'performance.own',
] as const;
const RATE = ['performance.rate', 'performance.manage'] as const;

@Controller()
export class PerformanceController {
  constructor(
    private readonly appraisalsService: AppraisalsService,
    private readonly kpiService: KpiService,
    private readonly proposalsService: ProposalsService,
    private readonly reviewDraftService: ReviewDraftService,
  ) {}

  // ================================================================= cycles

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/appraisal-cycles')
  cycles(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.appraisalsService.cycles(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Post('companies/:companyId/appraisal-cycles')
  createCycle(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CycleDto,
  ) {
    return this.appraisalsService.createCycle(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('appraisal-cycles/:cycleId')
  cycle(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.cycle(cycleId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Post('appraisal-cycles/:cycleId/open')
  @HttpCode(200)
  openCycle(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.openAppraisals(cycleId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Post('appraisal-cycles/:cycleId/advance')
  @HttpCode(200)
  advanceCycle(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.advanceCycle(cycleId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Get('appraisal-cycles/:cycleId/calibration')
  calibration(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.calibrationView(cycleId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.own', ...SEE)
  @Get('appraisal-cycles/:cycleId/mine')
  mine(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.mine(cycleId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...RATE)
  @Get('appraisal-cycles/:cycleId/my-team')
  myTeam(@Param('cycleId', ParseUUIDPipe) cycleId: string) {
    return this.appraisalsService.myTeam(cycleId);
  }

  // ============================================================= appraisals

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('appraisals/:appraisalId')
  appraisal(@Param('appraisalId', ParseUUIDPipe) appraisalId: string) {
    return this.appraisalsService.get(appraisalId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...RATE)
  @Put('appraisals/:appraisalId/goals')
  setGoals(
    @Param('appraisalId', ParseUUIDPipe) appraisalId: string,
    @Body() dto: GoalsDto,
  ) {
    return this.appraisalsService.setGoals(appraisalId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.own')
  @Post('appraisals/:appraisalId/self-review')
  @HttpCode(200)
  selfReview(
    @Param('appraisalId', ParseUUIDPipe) appraisalId: string,
    @Body() dto: SelfReviewDto,
  ) {
    return this.appraisalsService.selfReview(appraisalId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...RATE)
  @Post('appraisals/:appraisalId/rate')
  @HttpCode(200)
  rate(
    @Param('appraisalId', ParseUUIDPipe) appraisalId: string,
    @Body() dto: RateDto,
  ) {
    return this.appraisalsService.rate(appraisalId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Post('appraisals/:appraisalId/calibrate')
  @HttpCode(200)
  calibrate(
    @Param('appraisalId', ParseUUIDPipe) appraisalId: string,
    @Body() dto: CalibrateDto,
  ) {
    return this.appraisalsService.calibrate(appraisalId, dto);
  }

  /**
   * A first draft of the manager's comment, from the goals and the year's feedback. Holds no
   * transaction while the model thinks, takes no Idempotency-Key, and saves nothing: the
   * manager rewrites it and submits their own comment with POST .../rate.
   */
  @UseGuards(AuthGuard)
  @RequirePermission(...RATE)
  @ShortTransactions()
  @SkipIdempotency()
  @Post('appraisals/:appraisalId/review-draft')
  @HttpCode(200)
  reviewDraft(@Param('appraisalId', ParseUUIDPipe) appraisalId: string) {
    return this.reviewDraftService.draft(appraisalId);
  }

  // =================================================================== KPIs

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/kpis')
  kpis(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('designationId') designationId?: string,
    @Query('all') all?: string,
  ) {
    return this.kpiService.list(companyId, {
      designationId,
      all: all === '1',
    });
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Post('companies/:companyId/kpis')
  createKpi(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: KpiDto,
  ) {
    return this.kpiService.create(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.manage')
  @Put('kpis/:kpiId')
  updateKpi(
    @Param('kpiId', ParseUUIDPipe) kpiId: string,
    @Body() dto: UpdateKpiDto,
  ) {
    return this.kpiService.update(kpiId, dto);
  }

  // =============================================================== feedback

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('employees/:employeeId/feedback')
  feedback(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query('since') since?: string,
  ) {
    return this.appraisalsService.feedback(employeeId, { since });
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.rate', 'performance.manage', 'performance.view')
  @Post('employees/:employeeId/feedback')
  addFeedback(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: FeedbackDto,
  ) {
    return this.appraisalsService.addFeedback(employeeId, dto);
  }

  // ============================================================== proposals

  @UseGuards(AuthGuard)
  @RequirePermission('performance.view', 'performance.manage', 'performance.propose')
  @Get('companies/:companyId/increment-proposals')
  proposals(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('state') state?: string,
  ) {
    return this.proposalsService.list(companyId, state);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.propose')
  @Post('appraisals/:appraisalId/proposal')
  propose(
    @Param('appraisalId', ParseUUIDPipe) appraisalId: string,
    @Body() dto: ProposalDto,
  ) {
    return this.proposalsService.propose(appraisalId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.view', 'performance.manage', 'performance.propose')
  @Get('increment-proposals/:proposalId')
  proposal(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.proposalsService.get(proposalId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.propose')
  @Post('increment-proposals/:proposalId/apply')
  @HttpCode(200)
  apply(@Param('proposalId', ParseUUIDPipe) proposalId: string) {
    return this.proposalsService.apply(proposalId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('performance.propose')
  @Post('increment-proposals/:proposalId/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.proposalsService.withdraw(proposalId, dto);
  }
}
