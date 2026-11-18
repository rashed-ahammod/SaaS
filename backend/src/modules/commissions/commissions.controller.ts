/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 * Commission (WP31)
 *   GET   /companies/:companyId/commission-scheme
 *   PUT   /companies/:companyId/commission-scheme     HR  { code, name, basis?, ratePercent, minAttainment?, bonusAttainment?, bonusRatePercent?, clawback?, note? }
 *   GET   /companies/:companyId/commission-runs
 *   POST  /companies/:companyId/commission-runs       HR  { period }
 *   GET   /commission-runs/:runId
 *   POST  /commission-runs/:runId/post                HR: one payroll variable per line
 *   POST  /commission-runs/:runId/cancel              HR  { reason }
 *   GET   /companies/:companyId/my-commission?period= what I earned
 *
 * Sales assistant (WP31, AI)
 *   POST  /leads/:leadId/assist                       { ask: score|next_step|follow_up|quotation_text|call_note, note? }
 *   POST  /customers/:customerId/assist               the same, for a customer
 *
 * Gate 3
 *   GET   /companies/:companyId/gate-3?days=90
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
import { CommissionsService } from './commissions.service.js';
import {
  AssistDto,
  CalculateRunDto,
  CancelRunDto,
  CommissionRuleDto,
} from './dto/commissions.dto.js';
import { Gate3Service } from './gate3.service.js';
import { SalesAssistService } from './sales-assist.service.js';

const SEE = ['commission.view', 'commission.manage'] as const;

@Controller()
export class CommissionsController {
  constructor(
    private readonly commissionsService: CommissionsService,
    private readonly assistService: SalesAssistService,
    private readonly gate3Service: Gate3Service,
  ) {}

  // ============================================================= commission

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/commission-scheme')
  scheme(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.commissionsService.scheme(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('commission.manage')
  @Put('companies/:companyId/commission-scheme')
  setScheme(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CommissionRuleDto,
  ) {
    return this.commissionsService.setScheme(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('companies/:companyId/commission-runs')
  runs(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.commissionsService.runs(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('commission.manage')
  @Post('companies/:companyId/commission-runs')
  calculate(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CalculateRunDto,
  ) {
    return this.commissionsService.calculate(companyId, dto.period);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SEE)
  @Get('commission-runs/:runId')
  run(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.commissionsService.run(runId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('commission.manage')
  @Post('commission-runs/:runId/post')
  @HttpCode(200)
  post(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.commissionsService.post(runId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('commission.manage')
  @Post('commission-runs/:runId/cancel')
  @HttpCode(200)
  cancel(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: CancelRunDto,
  ) {
    return this.commissionsService.cancel(runId, dto);
  }

  /** What I earned: a salesperson's own figures, whatever their other permissions are. */
  @UseGuards(AuthGuard)
  @RequirePermission('crm.own', ...SEE)
  @Get('companies/:companyId/my-commission')
  mine(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('period') period?: string,
  ) {
    return this.commissionsService.mine(companyId, period);
  }

  // ======================================================== sales assistant

  /**
   * The assistant holds no transaction while the model thinks and takes no Idempotency-Key:
   * it changes nothing. It answers with a score and reasons, or with text to edit and send.
   */
  @UseGuards(AuthGuard)
  @RequirePermission('ai.sales_assist.use', 'crm.own', 'crm.view', 'crm.manage')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('leads/:leadId/assist')
  @HttpCode(200)
  assistLead(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: AssistDto,
  ) {
    return this.assistService.assistLead(leadId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('ai.sales_assist.use', 'crm.own', 'crm.view', 'crm.manage')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('customers/:customerId/assist')
  @HttpCode(200)
  assistCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AssistDto,
  ) {
    return this.assistService.assistCustomer(customerId, dto);
  }

  // ================================================================= Gate 3

  @UseGuards(AuthGuard)
  @RequirePermission('gate3.view')
  @Get('companies/:companyId/gate-3')
  gate3(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('days') days?: string,
  ) {
    return this.gate3Service.report(
      companyId,
      days ? Number(days) : undefined,
    );
  }
}
