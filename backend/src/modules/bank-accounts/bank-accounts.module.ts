import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { BankAccountsController } from './bank-accounts.controller.js';
import { BankAccountsService } from './bank-accounts.service.js';

/**
 * Salary bank / mobile-wallet accounts (WP2): changes go through the approval engine.
 * Owns table: employee_bank_accounts.
 */
@Module({
  imports: [IdentityModule, EmployeesModule, ApprovalsModule],
  controllers: [BankAccountsController],
  providers: [BankAccountsService],
  exports: [BankAccountsService],
})
export class BankAccountsModule {}
