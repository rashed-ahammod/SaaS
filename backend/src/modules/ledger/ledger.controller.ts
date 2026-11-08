/**
 * Routes (Phase 2 WP14, general ledger; writes need Idempotency-Key):
 *
 *   Setup (Accounts: ledger.setup; reading: ledger.view)
 *     GET   /companies/:companyId/ledger                        set up? accounts, fiscal years, missing posting accounts
 *     POST  /companies/:companyId/ledger/setup                  { asOf? }  chart from the Bangladesh template + fiscal year
 *     GET   /companies/:companyId/accounts                      chart of accounts (tree order)
 *     POST  /companies/:companyId/accounts                      { code, nameEn, nameBn?, type, parentId?, postable?, role? }
 *     PATCH /accounts/:accountId                                { nameEn?, nameBn?, isActive?, role?, version }
 *     GET   /companies/:companyId/posting-accounts              which account each automatic posting uses
 *     PUT   /companies/:companyId/posting-accounts              { key, accountId }
 *     GET   /companies/:companyId/fiscal-years
 *     POST  /companies/:companyId/fiscal-years                  { forDate }  open the fiscal year of a date (12 periods)
 *     GET   /companies/:companyId/periods?fiscalYearId=
 *     POST  /companies/:companyId/periods/:period/close         (ledger.periods.close) for good
 *
 *   Vouchers (maker: ledger.vouchers.prepare; checker: the approval inbox)
 *     GET   /companies/:companyId/vouchers?from=&to=&type=&state=
 *     POST  /companies/:companyId/vouchers                      { voucherType, voucherDate, narration, lines[] }  -> draft, numbered
 *     GET   /vouchers/:voucherId
 *     PATCH /vouchers/:voucherId                                draft only: { voucherDate?, narration?, lines?, version }
 *     POST  /vouchers/:voucherId/submit                         -> approval (Accounts checker; Admin from Tk 10 lakh)
 *     POST  /vouchers/:voucherId/cancel                         { reason }  draft only; the number stays
 *     POST  /vouchers/:voucherId/reverse                        { reason, voucherDate? }  -> reversal voucher in approval
 *     POST  /payroll-runs/:runId/ledger-posting                 post an approved run that was skipped
 *     POST  /disbursement-files/:fileId/ledger-posting          post a settled salary file that was skipped
 *
 *   Reports (ledger.view)
 *     GET   /companies/:companyId/trial-balance?to=&from=
 *     GET   /accounts/:accountId/ledger?to=&from=
 *     GET   /companies/:companyId/profit-and-loss?to=&from=&departmentId=
 *     GET   /companies/:companyId/balance-sheet?asOf=
 *     GET   /companies/:companyId/ledger/checks                 integrity checks (also nightly)
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
import {
  AsOfQueryDto,
  CreateAccountDto,
  CreateVoucherDto,
  LedgerReasonDto,
  OpenFiscalYearDto,
  PeriodsQueryDto,
  RangeQueryDto,
  ReverseVoucherDto,
  SetPostingAccountDto,
  SetUpLedgerDto,
  UpdateAccountDto,
  UpdateVoucherDto,
  VoucherQueryDto,
} from './dto/ledger.dto.js';
import { LedgerPostingService } from './ledger-posting.service.js';
import { LedgerReportsService } from './ledger-reports.service.js';
import { LedgerSetupService } from './ledger-setup.service.js';
import { VouchersService } from './vouchers.service.js';

@Controller()
export class LedgerController {
  constructor(
    private readonly ledgerSetupService: LedgerSetupService,
    private readonly vouchersService: VouchersService,
    private readonly ledgerPostingService: LedgerPostingService,
    private readonly ledgerReportsService: LedgerReportsService,
  ) {}

  // ------------------------------------------------------------------ setup

  // GET /companies/:companyId/ledger
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/ledger')
  status(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledgerSetupService.status(companyId);
  }

  // POST /companies/:companyId/ledger/setup
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Post('companies/:companyId/ledger/setup')
  @HttpCode(200)
  setUp(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetUpLedgerDto,
  ) {
    return this.ledgerSetupService.setUp(companyId, dto.asOf);
  }

  // GET /companies/:companyId/accounts
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/accounts')
  listAccounts(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledgerSetupService.listAccounts(companyId);
  }

  // POST /companies/:companyId/accounts
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Post('companies/:companyId/accounts')
  createAccount(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.ledgerSetupService.createAccount(companyId, dto);
  }

  // PATCH /accounts/:accountId
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Patch('accounts/:accountId')
  updateAccount(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.ledgerSetupService.updateAccount(accountId, dto);
  }

  // GET /companies/:companyId/posting-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/posting-accounts')
  postingAccounts(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledgerSetupService.postingAccounts(companyId);
  }

  // PUT /companies/:companyId/posting-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Put('companies/:companyId/posting-accounts')
  setPostingAccount(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetPostingAccountDto,
  ) {
    return this.ledgerSetupService.setPostingAccount(companyId, dto);
  }

  // GET /companies/:companyId/fiscal-years
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/fiscal-years')
  fiscalYears(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledgerSetupService.listFiscalYears(companyId);
  }

  // POST /companies/:companyId/fiscal-years
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Post('companies/:companyId/fiscal-years')
  openFiscalYear(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: OpenFiscalYearDto,
  ) {
    return this.ledgerSetupService.openFiscalYear(companyId, dto.forDate);
  }

  // GET /companies/:companyId/periods?fiscalYearId=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/periods')
  periods(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PeriodsQueryDto,
  ) {
    return this.ledgerSetupService.listPeriods(companyId, query.fiscalYearId);
  }

  // POST /companies/:companyId/periods/:period/close
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.periods.close')
  @Post('companies/:companyId/periods/:period/close')
  @HttpCode(200)
  closePeriod(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('period') period: string,
  ) {
    return this.ledgerSetupService.closePeriod(companyId, period);
  }

  // --------------------------------------------------------------- vouchers

  // GET /companies/:companyId/vouchers?from=&to=&type=&state=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/vouchers')
  listVouchers(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: VoucherQueryDto,
  ) {
    return this.vouchersService.list(companyId, query);
  }

  // POST /companies/:companyId/vouchers
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('companies/:companyId/vouchers')
  createVoucher(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateVoucherDto,
  ) {
    return this.vouchersService.create(companyId, dto);
  }

  // GET /vouchers/:voucherId
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('vouchers/:voucherId')
  getVoucher(@Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.vouchersService.get(voucherId);
  }

  // PATCH /vouchers/:voucherId
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Patch('vouchers/:voucherId')
  updateVoucher(
    @Param('voucherId', ParseUUIDPipe) voucherId: string,
    @Body() dto: UpdateVoucherDto,
  ) {
    return this.vouchersService.update(voucherId, dto);
  }

  // POST /vouchers/:voucherId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('vouchers/:voucherId/submit')
  @HttpCode(200)
  submitVoucher(@Param('voucherId', ParseUUIDPipe) voucherId: string) {
    return this.vouchersService.submit(voucherId);
  }

  // POST /vouchers/:voucherId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('vouchers/:voucherId/cancel')
  @HttpCode(200)
  cancelVoucher(
    @Param('voucherId', ParseUUIDPipe) voucherId: string,
    @Body() dto: LedgerReasonDto,
  ) {
    return this.vouchersService.cancel(voucherId, dto.reason);
  }

  // POST /vouchers/:voucherId/reverse
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('vouchers/:voucherId/reverse')
  reverseVoucher(
    @Param('voucherId', ParseUUIDPipe) voucherId: string,
    @Body() dto: ReverseVoucherDto,
  ) {
    return this.vouchersService.reverse(voucherId, dto);
  }

  // POST /payroll-runs/:runId/ledger-posting
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('payroll-runs/:runId/ledger-posting')
  postPayrollRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.ledgerPostingService.postPayrollRun(runId);
  }

  // POST /disbursement-files/:fileId/ledger-posting
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.vouchers.prepare')
  @Post('disbursement-files/:fileId/ledger-posting')
  postDisbursementFile(@Param('fileId', ParseUUIDPipe) fileId: string) {
    return this.ledgerPostingService.postDisbursementFile(fileId);
  }

  // ---------------------------------------------------------------- reports

  // GET /companies/:companyId/trial-balance?to=&from=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/trial-balance')
  trialBalance(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: RangeQueryDto,
  ) {
    return this.ledgerReportsService.trialBalance(
      companyId,
      query.to,
      query.from,
    );
  }

  // GET /accounts/:accountId/ledger?to=&from=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('accounts/:accountId/ledger')
  generalLedger(
    @Param('accountId', ParseUUIDPipe) accountId: string,
    @Query() query: RangeQueryDto,
  ) {
    return this.ledgerReportsService.generalLedger(
      accountId,
      query.from,
      query.to,
    );
  }

  // GET /companies/:companyId/profit-and-loss?to=&from=&departmentId=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/profit-and-loss')
  profitAndLoss(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: RangeQueryDto,
  ) {
    return this.ledgerReportsService.profitAndLoss(
      companyId,
      query.from,
      query.to,
      query.departmentId,
    );
  }

  // GET /companies/:companyId/balance-sheet?asOf=
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/balance-sheet')
  balanceSheet(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: AsOfQueryDto,
  ) {
    return this.ledgerReportsService.balanceSheet(companyId, query.asOf);
  }

  // GET /companies/:companyId/ledger/checks
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/ledger/checks')
  checks(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ledgerReportsService.checks(companyId);
  }
}
