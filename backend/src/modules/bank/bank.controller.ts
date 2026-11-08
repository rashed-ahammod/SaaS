/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/bank-accounts                      with ledger balance, last statement, unmatched lines
 *   POST  /companies/:companyId/bank-accounts                      Accounts  { accountId, bankName, accountNo, statementFormat, reconcileFrom, openingBankBalance, ... }
 *   GET   /bank-accounts/:bankAccountId
 *   PATCH /bank-accounts/:bankAccountId                            Accounts  { version, ... }  (start and opening only before the first statement)
 *   POST  /bank-accounts/:bankAccountId/statements                 Accounts  multipart "file" (CSV); then auto-match
 *   GET   /bank-accounts/:bankAccountId/statements
 *   GET   /bank-accounts/:bankAccountId/statement-lines?state=unmatched|matched|all&from=&to=
 *   GET   /bank-accounts/:bankAccountId/ledger-lines?state=&from=&to=
 *   POST  /bank-accounts/:bankAccountId/auto-match                 Accounts  match what the rules call safe
 *   POST  /bank-accounts/:bankAccountId/matches                    Accounts  { statementLineIds[], ledgerLineIds[], note?, fromSuggestion? }
 *   GET   /bank-matches/:matchId
 *   POST  /bank-matches/:matchId/undo                              Accounts  { reason }
 *   GET   /bank-statement-lines/:lineId/options                    what the line could be (rules)
 *   POST  /bank-statement-lines/:lineId/ai-suggestion              the AI chooses among the options (no Idempotency-Key)
 *   POST  /bank-statement-lines/:lineId/voucher                    Accounts  a draft voucher for a charge / interest  { accountId, narration, departmentId? }
 *   GET   /bank-accounts/:bankAccountId/reconciliation?asOf=2026-10-31
 *
 * n8n (Authorization: ServiceKey <id>.<secret>, permission bank.import):
 *   POST  /bank-accounts/:bankAccountId/statements/n8n             { fileName, content }
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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ServiceKeyGuard } from '../identity/service-key.guard.js';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { ShortTransactions } from '../../platform/tenancy/tenant-transaction.interceptor.js';
import { BankAiService } from './bank-ai.service.js';
import { BankService, MAX_STATEMENT_BYTES } from './bank.service.js';
import {
  BankAccountDto,
  LinesQueryDto,
  MatchDto,
  ReconciliationQueryDto,
  RecordLineDto,
  StatementTextDto,
  UndoMatchDto,
  UpdateBankAccountDto,
} from './dto/bank.dto.js';

@Controller()
export class BankController {
  constructor(
    private readonly bankService: BankService,
    private readonly bankAiService: BankAiService,
  ) {}

  // GET /companies/:companyId/bank-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('companies/:companyId/bank-accounts')
  accounts(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.bankService.listAccounts(companyId);
  }

  // POST /companies/:companyId/bank-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Post('companies/:companyId/bank-accounts')
  createAccount(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: BankAccountDto,
  ) {
    return this.bankService.createAccount(companyId, dto);
  }

  // GET /bank-accounts/:bankAccountId
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-accounts/:bankAccountId')
  account(@Param('bankAccountId', ParseUUIDPipe) bankAccountId: string) {
    return this.bankService.getAccount(bankAccountId);
  }

  // PATCH /bank-accounts/:bankAccountId
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Patch('bank-accounts/:bankAccountId')
  updateAccount(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    return this.bankService.updateAccount(bankAccountId, dto);
  }

  // POST /bank-accounts/:bankAccountId/statements
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_STATEMENT_BYTES, files: 1 },
    }),
  )
  @Post('bank-accounts/:bankAccountId/statements')
  upload(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.bankService.importUpload(bankAccountId, file);
  }

  // POST /bank-accounts/:bankAccountId/statements/n8n   (service key, not a user)
  @UseGuards(ServiceKeyGuard)
  @RequirePermission('bank.import')
  @Post('bank-accounts/:bankAccountId/statements/n8n')
  fromN8n(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() dto: StatementTextDto,
  ) {
    return this.bankService.importStatement(
      bankAccountId,
      { name: dto.fileName, content: dto.content },
      'n8n',
    );
  }

  // GET /bank-accounts/:bankAccountId/statements
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-accounts/:bankAccountId/statements')
  statements(@Param('bankAccountId', ParseUUIDPipe) bankAccountId: string) {
    return this.bankService.listStatements(bankAccountId);
  }

  // GET /bank-accounts/:bankAccountId/statement-lines
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-accounts/:bankAccountId/statement-lines')
  statementLines(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query() query: LinesQueryDto,
  ) {
    return this.bankService.statementLines(bankAccountId, query);
  }

  // GET /bank-accounts/:bankAccountId/ledger-lines
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-accounts/:bankAccountId/ledger-lines')
  ledgerLines(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query() query: LinesQueryDto,
  ) {
    return this.bankService.ledgerLines(bankAccountId, query);
  }

  // POST /bank-accounts/:bankAccountId/auto-match
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Post('bank-accounts/:bankAccountId/auto-match')
  @HttpCode(200)
  autoMatch(@Param('bankAccountId', ParseUUIDPipe) bankAccountId: string) {
    return this.bankService.autoMatch(bankAccountId);
  }

  // POST /bank-accounts/:bankAccountId/matches
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Post('bank-accounts/:bankAccountId/matches')
  match(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Body() dto: MatchDto,
  ) {
    return this.bankService.match(bankAccountId, dto);
  }

  // GET /bank-matches/:matchId
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-matches/:matchId')
  getMatch(@Param('matchId', ParseUUIDPipe) matchId: string) {
    return this.bankService.getMatch(matchId);
  }

  // POST /bank-matches/:matchId/undo
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Post('bank-matches/:matchId/undo')
  @HttpCode(200)
  undo(
    @Param('matchId', ParseUUIDPipe) matchId: string,
    @Body() dto: UndoMatchDto,
  ) {
    return this.bankService.undo(matchId, dto.reason);
  }

  // GET /bank-statement-lines/:lineId/options
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-statement-lines/:lineId/options')
  options(@Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.bankService.options(lineId);
  }

  // POST /bank-statement-lines/:lineId/ai-suggestion
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @ShortTransactions()
  @SkipIdempotency()
  @Post('bank-statement-lines/:lineId/ai-suggestion')
  @HttpCode(200)
  aiSuggestion(@Param('lineId', ParseUUIDPipe) lineId: string) {
    return this.bankAiService.suggest(lineId);
  }

  // POST /bank-statement-lines/:lineId/voucher
  @UseGuards(AuthGuard)
  @RequirePermission('bank.reconcile')
  @Post('bank-statement-lines/:lineId/voucher')
  recordLine(
    @Param('lineId', ParseUUIDPipe) lineId: string,
    @Body() dto: RecordLineDto,
  ) {
    return this.bankService.recordLine(lineId, dto);
  }

  // GET /bank-accounts/:bankAccountId/reconciliation
  @UseGuards(AuthGuard)
  @RequirePermission('bank.view')
  @Get('bank-accounts/:bankAccountId/reconciliation')
  reconciliation(
    @Param('bankAccountId', ParseUUIDPipe) bankAccountId: string,
    @Query() query: ReconciliationQueryDto,
  ) {
    return this.bankService.reconciliation(bankAccountId, query.asOf);
  }
}
