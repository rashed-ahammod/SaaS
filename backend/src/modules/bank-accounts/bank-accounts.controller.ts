/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST /employees/:employeeId/bank-accounts   step-up (X-OTP-Code; an employee without 2FA may skip it)
 *                                               request a new salary account
 *                                               -> pending + approval request (HR approves)
 *   GET  /employees/:employeeId/bank-accounts   all accounts (number masked without bank-field access)
 *
 * HR uses it for anyone in scope; an employee can use it for their own record.
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  RequirePermission,
  RequireStepUp,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { BankAccountsService } from './bank-accounts.service.js';
import { RequestBankAccountDto } from './dto/bank-account.dto.js';

@Controller()
export class BankAccountsController {
  constructor(private readonly bankAccountsService: BankAccountsService) {}

  // POST /employees/:employeeId/bank-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('employee.bank.manage', 'employee.bank.request_own')
  @RequireStepUp({ employeesWithout2fa: 'allow' })
  @Post('employees/:employeeId/bank-accounts')
  requestChange(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: RequestBankAccountDto,
  ) {
    return this.bankAccountsService.requestChange(employeeId, dto);
  }

  // GET /employees/:employeeId/bank-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/bank-accounts')
  listAccounts(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.bankAccountsService.listAccounts(employeeId);
  }
}
