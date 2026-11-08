/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/pf-interest          HR / Accounts  { fiscalYear, ratePercent }   the trustees' declared rate, posted at once
 *   POST  /employees/:employeeId/pf-withdrawals      Accounts  { amount, date, paidFromAccountId, reason }   own part only -> checker
 *   GET   /employees/:employeeId/pf-settlement?date= what a leaver is paid: own part, vested employer part, forfeited
 *   POST  /employees/:employeeId/pf-settlement       Accounts  { date, paidFromAccountId, note? }   -> checker
 *
 * The member's statement: GET /employees/:employeeId/pf-ledger, GET /me/pf-ledger (PayrollStatementsController).
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  PfInterestDto,
  PfSettlementDto,
  PfSettlementQueryDto,
  PfWithdrawalDto,
} from './dto/pf-fund.dto.js';
import { PfFundService } from './pf-fund.service.js';

@Controller()
export class PfFundController {
  constructor(private readonly pfFundService: PfFundService) {}

  // POST /companies/:companyId/pf-interest
  @UseGuards(AuthGuard)
  @RequirePermission('payroll.prepare', 'ledger.vouchers.prepare')
  @Post('companies/:companyId/pf-interest')
  creditInterest(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PfInterestDto,
  ) {
    return this.pfFundService.creditInterest(companyId, dto);
  }

  // POST /employees/:employeeId/pf-withdrawals
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('employees/:employeeId/pf-withdrawals')
  withdraw(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: PfWithdrawalDto,
  ) {
    return this.pfFundService.withdraw(employeeId, dto);
  }

  // GET /employees/:employeeId/pf-settlement
  @UseGuards(AuthGuard)
  @RequirePermission(
    'payroll.prepare',
    'payroll.verify',
    'payroll.approve',
    'ledger.vouchers.prepare',
  )
  @Get('employees/:employeeId/pf-settlement')
  settlementPreview(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: PfSettlementQueryDto,
  ) {
    return this.pfFundService.settlementPreview(employeeId, query.date);
  }

  // POST /employees/:employeeId/pf-settlement
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('employees/:employeeId/pf-settlement')
  settle(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: PfSettlementDto,
  ) {
    return this.pfFundService.settle(employeeId, dto);
  }
}
