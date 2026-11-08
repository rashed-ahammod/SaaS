/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/probation-reviews?withinDays=30     probations ending soon (or ended), with the review
 *   POST  /employees/:employeeId/probation-recommendation          Dept Head / HR  { outcome: confirm|extend|end, months?, note }
 *   POST  /employees/:employeeId/probation-decision                HR  { outcome, months?, lastWorkingDay?, note }
 *   POST  /employees/:employeeId/notice                            HR  { kind?, noticeDate?, lastWorkingDay, reason }
 *   GET   /employees/:employeeId/separation                        the latest separation with its clearances
 *   GET   /companies/:companyId/separations?state=in_notice        leavers
 *   POST  /separations/:separationId/clearances/:item              it | admin_assets | accounts_advances | dept_handover  { note? }
 *   POST  /separations/:separationId/withdraw                      HR  { reason }
 *   GET   /employees/:employeeId/experience-certificate.pdf?lang=bn  HR, after the final settlement
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CertificateQueryDto,
  CLEARANCE_ITEMS,
  ClearanceDto,
  NoticeDto,
  ProbationDecisionDto,
  ProbationDueQueryDto,
  ProbationRecommendationDto,
  SeparationsQueryDto,
  WithdrawSeparationDto,
} from './dto/lifecycle.dto.js';
import { LifecycleService } from './lifecycle.service.js';

const CLEARERS = [
  'employee.manage',
  'employee.lifecycle.review',
  'users.manage',
  'org.structure.manage',
  'payroll.disburse',
] as const;

@Controller()
export class LifecycleController {
  constructor(private readonly lifecycleService: LifecycleService) {}

  // GET /companies/:companyId/probation-reviews?withinDays=30
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage', 'employee.lifecycle.review')
  @Get('companies/:companyId/probation-reviews')
  probationDue(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ProbationDueQueryDto,
  ) {
    return this.lifecycleService.probationDue(
      companyId,
      query.withinDays ?? 30,
    );
  }

  // POST /employees/:employeeId/probation-recommendation
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage', 'employee.lifecycle.review')
  @Post('employees/:employeeId/probation-recommendation')
  @HttpCode(200)
  recommend(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ProbationRecommendationDto,
  ) {
    return this.lifecycleService.recommend(employeeId, dto);
  }

  // POST /employees/:employeeId/probation-decision
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/probation-decision')
  @HttpCode(200)
  decide(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ProbationDecisionDto,
  ) {
    return this.lifecycleService.decide(employeeId, dto);
  }

  // POST /employees/:employeeId/notice
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('employees/:employeeId/notice')
  @HttpCode(200)
  recordNotice(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: NoticeDto,
  ) {
    return this.lifecycleService.recordNotice(employeeId, dto);
  }

  // GET /employees/:employeeId/separation
  @UseGuards(AuthGuard)
  @RequirePermission(...CLEARERS)
  @Get('employees/:employeeId/separation')
  separation(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.lifecycleService.separationOf(employeeId);
  }

  // GET /companies/:companyId/separations?state=in_notice
  @UseGuards(AuthGuard)
  @RequirePermission(...CLEARERS)
  @Get('companies/:companyId/separations')
  listSeparations(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: SeparationsQueryDto,
  ) {
    return this.lifecycleService.listSeparations(companyId, query.state);
  }

  // POST /separations/:separationId/clearances/:item
  @UseGuards(AuthGuard)
  @RequirePermission(...CLEARERS)
  @Post('separations/:separationId/clearances/:item')
  @HttpCode(200)
  clear(
    @Param('separationId', ParseUUIDPipe) separationId: string,
    @Param(
      'item',
      new ParseEnumPipe(Object.fromEntries(CLEARANCE_ITEMS.map((i) => [i, i]))),
    )
    item: (typeof CLEARANCE_ITEMS)[number],
    @Body() dto: ClearanceDto,
  ) {
    return this.lifecycleService.clear(separationId, item, dto.note);
  }

  // POST /separations/:separationId/withdraw
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Post('separations/:separationId/withdraw')
  @HttpCode(200)
  withdraw(
    @Param('separationId', ParseUUIDPipe) separationId: string,
    @Body() dto: WithdrawSeparationDto,
  ) {
    return this.lifecycleService.withdraw(separationId, dto.reason);
  }

  // GET /employees/:employeeId/experience-certificate.pdf?lang=bn
  @UseGuards(AuthGuard)
  @RequirePermission('employee.manage')
  @Get('employees/:employeeId/experience-certificate.pdf')
  async experienceCertificate(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: CertificateQueryDto,
  ) {
    const file = await this.lifecycleService.experienceCertificate(
      employeeId,
      query.lang ?? 'en',
    );
    return new StreamableFile(file.content, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}
