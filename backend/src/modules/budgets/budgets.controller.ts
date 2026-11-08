/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/budget-settings
 *   PUT   /companies/:companyId/budget-settings           Accounts  { warningPercent?, noBudgetNeedsAdmin? }
 *   POST  /companies/:companyId/budgets                   Accounts  { fiscalYear, departmentId, note?, lines[] }
 *   GET   /companies/:companyId/budgets?fiscalYear=&departmentId=
 *   GET   /companies/:companyId/budget-vs-actual?fiscalYear=&departmentId=
 *   GET   /budgets/:budgetId                              lines with actual, committed, available; revisions
 *   PATCH /budgets/:budgetId                              drafts  { version, note?, lines? }
 *   POST  /budgets/:budgetId/submit                       -> Admin
 *   POST  /budgets/:budgetId/cancel                       drafts  { reason }
 *   POST  /budgets/:budgetId/revisions                    Accounts / Dept Head  { reason, lines[] }  -> Admin
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { BudgetsService } from './budgets.service.js';
import {
  BudgetQueryDto,
  BudgetRevisionDto,
  BudgetSettingsDto,
  CreateBudgetDto,
  ReasonDto,
  UpdateBudgetDto,
} from './dto/budgets.dto.js';

const READERS = ['budgets.view', 'budgets.manage'] as const;

@Controller()
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  // GET /companies/:companyId/budget-settings
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/budget-settings')
  settings(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.budgetsService.getSettings(companyId);
  }

  // PUT /companies/:companyId/budget-settings
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage')
  @Put('companies/:companyId/budget-settings')
  saveSettings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: BudgetSettingsDto,
  ) {
    return this.budgetsService.saveSettings(companyId, dto);
  }

  // POST /companies/:companyId/budgets
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage')
  @Post('companies/:companyId/budgets')
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateBudgetDto,
  ) {
    return this.budgetsService.create(companyId, dto);
  }

  // GET /companies/:companyId/budgets?fiscalYear=2026-27
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/budgets')
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: BudgetQueryDto,
  ) {
    return this.budgetsService.list(companyId, query);
  }

  // GET /companies/:companyId/budget-vs-actual?fiscalYear=2026-27
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/budget-vs-actual')
  budgetVsActual(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: BudgetQueryDto,
  ) {
    return this.budgetsService.budgetVsActual(companyId, query);
  }

  // GET /budgets/:budgetId
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('budgets/:budgetId')
  get(@Param('budgetId', ParseUUIDPipe) budgetId: string) {
    return this.budgetsService.get(budgetId);
  }

  // PATCH /budgets/:budgetId
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage')
  @Patch('budgets/:budgetId')
  update(
    @Param('budgetId', ParseUUIDPipe) budgetId: string,
    @Body() dto: UpdateBudgetDto,
  ) {
    return this.budgetsService.update(budgetId, dto);
  }

  // POST /budgets/:budgetId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage')
  @Post('budgets/:budgetId/submit')
  @HttpCode(200)
  submit(@Param('budgetId', ParseUUIDPipe) budgetId: string) {
    return this.budgetsService.submit(budgetId);
  }

  // POST /budgets/:budgetId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage')
  @Post('budgets/:budgetId/cancel')
  @HttpCode(200)
  cancel(
    @Param('budgetId', ParseUUIDPipe) budgetId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.budgetsService.cancel(budgetId, dto.reason);
  }

  // POST /budgets/:budgetId/revisions
  @UseGuards(AuthGuard)
  @RequirePermission('budgets.manage', 'budgets.request_change')
  @Post('budgets/:budgetId/revisions')
  requestRevision(
    @Param('budgetId', ParseUUIDPipe) budgetId: string,
    @Body() dto: BudgetRevisionDto,
  ) {
    return this.budgetsService.requestRevision(budgetId, dto);
  }
}
