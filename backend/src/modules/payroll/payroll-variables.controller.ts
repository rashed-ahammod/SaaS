/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/payroll-variables?period=2026-10
 *   POST  /companies/:companyId/payroll-variables     { employeeId, period, headCode, amount, note? }
 *   POST  /payroll-variables/:variableId/cancel       { reason }
 *   GET   /companies/:companyId/loans?state=&unpaid=true   HR, and Accounts who pay advances out
 *   GET   /employees/:employeeId/loans                 HR, or the employee for their own
 *   POST  /employees/:employeeId/loans                { principal, installment, firstPeriod, reason }  -> approval (HR, or the employee for themselves)
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
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AddVariableDto,
  LoansQueryDto,
  PeriodQueryDto,
  ReasonDto,
  RequestLoanDto,
} from './dto/payroll.dto.js';
import { PayrollVariablesService } from './payroll-variables.service.js';

@Controller()
export class PayrollVariablesController {
  constructor(
    private readonly payrollVariablesService: PayrollVariablesService,
  ) {}

  // GET /companies/:companyId/payroll-variables?period=2026-10
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Get('companies/:companyId/payroll-variables')
  listVariables(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.payrollVariablesService.listVariables(companyId, query.period);
  }

  // POST /companies/:companyId/payroll-variables
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('companies/:companyId/payroll-variables')
  addVariable(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AddVariableDto,
  ) {
    return this.payrollVariablesService.addVariable(companyId, dto);
  }

  // POST /payroll-variables/:variableId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare')
  @Post('payroll-variables/:variableId/cancel')
  @HttpCode(200)
  cancelVariable(
    @Param('variableId', ParseUUIDPipe) variableId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.payrollVariablesService.cancelVariable(variableId, dto);
  }

  // GET /companies/:companyId/loans?state=approved&unpaid=true
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'expenses.pay')
  @Get('companies/:companyId/loans')
  listCompanyLoans(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: LoansQueryDto,
  ) {
    return this.payrollVariablesService.listCompanyLoans(companyId, query);
  }

  // GET /employees/:employeeId/loans
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.loan.request_own')
  @Get('employees/:employeeId/loans')
  listLoans(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.payrollVariablesService.listLoans(employeeId);
  }

  // POST /employees/:employeeId/loans
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'payroll.loan.request_own')
  @Post('employees/:employeeId/loans')
  requestLoan(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: RequestLoanDto,
  ) {
    return this.payrollVariablesService.requestLoan(employeeId, dto);
  }
}
