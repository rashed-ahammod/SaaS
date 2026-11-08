/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/payroll-runs          { runType: regular|bonus|final_settlement, period, ... }
 *   GET   /companies/:companyId/payroll-runs?period=2026-10
 *   GET   /payroll-runs/:runId                        totals, flags (+ per employee with salary access)
 *   POST  /payroll-runs/:runId/calculate              all-or-nothing; again after any change
 *   GET   /payroll-runs/:runId/employees/:employeeId  lines with explanation trace
 *   POST  /payroll-flags/:flagId/clear                { reason }
 *   POST  /payroll-runs/:runId/submit                 -> approval: Accounts verifies, Admin approves
 *   POST  /payroll-runs/:runId/cancel                 { reason }  (draft / calculated only)
 *   GET   /payroll-runs/:runId/reproduce              re-calculate from stored inputs and compare
 *   GET   /employees/:employeeId/payslips             approved payslips of an employee (HR / Accounts)
 *   GET   /me/payslips                                my approved payslips
 *   GET   /me/payslips/:runId                         one payslip
 *   GET   /me/payslips/:runId/pdf?lang=bn&protect=true                      my payslip PDF (Bangla / English)
 *   GET   /payroll-runs/:runId/employees/:employeeId/payslip.pdf?lang=en     an employee's payslip PDF
 *   GET   /payroll-runs/:runId/journal.csv            salary journal per cost centre (approved runs)
 *
 * Approve / reject a submitted run with the approval routes:
 *   POST /approvals/requests/:requestId/approve | /reject | /return
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CreateRunDto,
  ListRunsQueryDto,
  PayslipPdfQueryDto,
  ReasonDto,
} from './dto/payroll.dto.js';
import { PayrollRunsService } from './payroll-runs.service.js';

@Controller()
export class PayrollRunsController {
  constructor(private readonly payrollRunsService: PayrollRunsService) {}

  // POST /companies/:companyId/payroll-runs
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('companies/:companyId/payroll-runs')
  createRun(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateRunDto,
  ) {
    return this.payrollRunsService.createRun(companyId, dto);
  }

  // GET /companies/:companyId/payroll-runs?period=2026-10
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('companies/:companyId/payroll-runs')
  listRuns(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ListRunsQueryDto,
  ) {
    return this.payrollRunsService.listRuns(companyId, query);
  }

  // GET /payroll-runs/:runId
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('payroll-runs/:runId')
  getRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.payrollRunsService.getRun(runId);
  }

  // POST /payroll-runs/:runId/calculate
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('payroll-runs/:runId/calculate')
  @HttpCode(200)
  calculate(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.payrollRunsService.calculate(runId);
  }

  // GET /payroll-runs/:runId/employees/:employeeId
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('payroll-runs/:runId/employees/:employeeId')
  getRunEmployee(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ) {
    return this.payrollRunsService.getRunEmployee(runId, employeeId);
  }

  // POST /payroll-flags/:flagId/clear
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('payroll-flags/:flagId/clear')
  @HttpCode(200)
  clearFlag(
    @Param('flagId', ParseUUIDPipe) flagId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payrollRunsService.clearFlag(flagId, dto);
  }

  // POST /payroll-runs/:runId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('payroll-runs/:runId/submit')
  @HttpCode(200)
  submit(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.payrollRunsService.submit(runId);
  }

  // POST /payroll-runs/:runId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('payroll-runs/:runId/cancel')
  @HttpCode(200)
  cancelRun(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payrollRunsService.cancelRun(runId, dto);
  }

  // GET /payroll-runs/:runId/reproduce
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('payroll-runs/:runId/reproduce')
  reproduce(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.payrollRunsService.reproduce(runId);
  }

  // GET /employees/:employeeId/payslips
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('employees/:employeeId/payslips')
  employeePayslips(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollRunsService.employeePayslips(employeeId);
  }

  // GET /me/payslips
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/payslips')
  myPayslips() {
    return this.payrollRunsService.myPayslips();
  }

  // GET /me/payslips/:runId
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/payslips/:runId')
  myPayslip(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.payrollRunsService.myPayslip(runId);
  }

  // GET /me/payslips/:runId/pdf?lang=bn&protect=true
  @UseGuards(AuthGuard)
  @RequirePermission('payslip.view_own')
  @Get('me/payslips/:runId/pdf')
  async myPayslipPdf(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query() query: PayslipPdfQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.payrollRunsService.myPayslipPdf(
      runId,
      query.lang ?? 'en',
      query.protect ?? false,
    );
    return pdfResponse(file, res);
  }

  // GET /payroll-runs/:runId/employees/:employeeId/payslip.pdf?lang=en&protect=false
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('payroll-runs/:runId/employees/:employeeId/payslip.pdf')
  async employeePayslipPdf(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: PayslipPdfQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.payrollRunsService.employeePayslipPdf(
      runId,
      employeeId,
      query.lang ?? 'en',
      query.protect ?? false,
    );
    return pdfResponse(file, res);
  }

  // GET /payroll-runs/:runId/journal.csv
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.disburse')
  @Get('payroll-runs/:runId/journal.csv')
  async salaryJournal(@Param('runId', ParseUUIDPipe) runId: string) {
    const file = await this.payrollRunsService.salaryJournal(runId);
    return new StreamableFile(file.content, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }
}

/** A PDF download; a protected file tells the user which password opens it. */
function pdfResponse(
  file: { fileName: string; content: Buffer; passwordHint: string | null },
  res: Response,
) {
  if (file.passwordHint) res.setHeader('X-Payslip-Password', file.passwordHint);
  return new StreamableFile(file.content, {
    type: 'application/pdf',
    disposition: `attachment; filename="${file.fileName}"`,
  });
}
