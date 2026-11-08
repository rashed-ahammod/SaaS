import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OrgModule } from '../org/org.module.js';
import { BankAiService } from './bank-ai.service.js';
import { BankController } from './bank.controller.js';
import { BankService } from './bank.service.js';

/**
 * Bank reconciliation (Phase 2 WP20): the company's bank accounts (ledger accounts of
 * role bank), statement import (CSV per bank, upload or n8n), matching statement lines to
 * posted ledger lines (rules automatically, a person by hand, AI suggestions to accept),
 * and the reconciliation that must come out at the ledger balance.
 * Not the employees' salary accounts (bank-accounts module).
 * Owns tables: company_bank_accounts, bank_statements, bank_statement_lines,
 * bank_matches, bank_match_items.
 */
@Module({
  imports: [IdentityModule, OrgModule, LedgerModule, AiModule],
  controllers: [BankController],
  providers: [BankService, BankAiService],
  exports: [BankService],
})
export class BankModule {}
