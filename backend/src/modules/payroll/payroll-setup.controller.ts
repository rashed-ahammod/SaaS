/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/payroll-settings
 *   PUT   /companies/:companyId/payroll-settings          { roundingIncrement?, unpaidDayBasis?, otHoursBasis?, pfEmployeePercent?, ... }
 *   GET   /companies/:companyId/salary-heads
 *   POST  /companies/:companyId/salary-heads              { code, nameEn, nameBn?, kind, taxable?, sortOrder? }
 *   POST  /companies/:companyId/salary-heads/defaults     Bangladesh heads + standard structure (Basic 60%)
 *   GET   /companies/:companyId/salary-structures
 *   POST  /companies/:companyId/salary-structures         { code, name, rules: [{ head, of, percent } | { head, fixed } | { head, remainder }] }
 *   GET   /employees/:employeeId/salaries                 salary history (salary field access)
 *   POST  /employees/:employeeId/salaries                 { effectiveFrom, gross, structureId, reason }
 *   POST  /salaries/:salaryId/cancel                      { reason }
 *   GET   /employees/:employeeId/ytd-openings
 *   PUT   /employees/:employeeId/ytd-openings             { fiscalYear, kind: opening|prior_employer, taxableIncome, taxWithheld, note? }
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
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AddSalaryDto,
  CreateSalaryHeadDto,
  CreateStructureDto,
  PayrollSettingsDto,
  ReasonDto,
  YtdOpeningDto,
} from './dto/payroll.dto.js';
import { PayrollSetupService } from './payroll-setup.service.js';

@Controller()
export class PayrollSetupController {
  constructor(private readonly payrollSetupService: PayrollSetupService) {}

  // GET /companies/:companyId/payroll-settings
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Get('companies/:companyId/payroll-settings')
  getSettings(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.payrollSetupService.getSettings(companyId);
  }

  // PUT /companies/:companyId/payroll-settings
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Put('companies/:companyId/payroll-settings')
  saveSettings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PayrollSettingsDto,
  ) {
    return this.payrollSetupService.saveSettings(companyId, dto);
  }

  // GET /companies/:companyId/salary-heads
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('companies/:companyId/salary-heads')
  listHeads(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.payrollSetupService.listHeads(companyId);
  }

  // POST /companies/:companyId/salary-heads
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('companies/:companyId/salary-heads')
  createHead(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateSalaryHeadDto,
  ) {
    return this.payrollSetupService.createHead(companyId, dto);
  }

  // POST /companies/:companyId/salary-heads/defaults
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('companies/:companyId/salary-heads/defaults')
  createDefaults(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.payrollSetupService.createDefaults(companyId);
  }

  // GET /companies/:companyId/salary-structures
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('companies/:companyId/salary-structures')
  listStructures(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.payrollSetupService.listStructures(companyId);
  }

  // POST /companies/:companyId/salary-structures
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('companies/:companyId/salary-structures')
  createStructure(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateStructureDto,
  ) {
    return this.payrollSetupService.createStructure(companyId, dto);
  }

  // GET /employees/:employeeId/salaries
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.verify', 'payroll.approve')
  @Get('employees/:employeeId/salaries')
  listSalaries(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollSetupService.listSalaries(employeeId);
  }

  // POST /employees/:employeeId/salaries
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('employees/:employeeId/salaries')
  addSalary(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: AddSalaryDto,
  ) {
    return this.payrollSetupService.addSalary(employeeId, dto);
  }

  // POST /salaries/:salaryId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('salaries/:salaryId/cancel')
  @HttpCode(200)
  cancelSalary(
    @Param('salaryId', ParseUUIDPipe) salaryId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payrollSetupService.cancelSalary(salaryId, dto);
  }

  // GET /employees/:employeeId/ytd-openings
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Get('employees/:employeeId/ytd-openings')
  listYtdOpenings(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollSetupService.listYtdOpenings(employeeId);
  }

  // PUT /employees/:employeeId/ytd-openings
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Put('employees/:employeeId/ytd-openings')
  saveYtdOpening(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: YtdOpeningDto,
  ) {
    return this.payrollSetupService.saveYtdOpening(employeeId, dto);
  }
}
