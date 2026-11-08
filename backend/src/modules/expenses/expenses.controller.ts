/**
 * Routes (Phase 2 WP16, expense claims and employee advances; writes need Idempotency-Key):
 *
 *   Categories (reading: employees of the company and expenses.view; changing: expenses.pay)
 *     GET   /companies/:companyId/expense-categories
 *     POST  /companies/:companyId/expense-categories/defaults     Bangladesh defaults (books set up first)
 *     POST  /companies/:companyId/expense-categories              { code, nameEn, nameBn?, accountId, receiptRequiredAbove? }
 *     PATCH /expense-categories/:categoryId                       { ..., version }
 *
 *   The employee (expenses.claim_own)
 *     GET   /me/expense-claims
 *     POST  /me/expense-claims                                    { title, advanceId?, lines?[] }  -> draft, numbered
 *     PATCH /expense-claims/:claimId                              draft only: { title?, advanceId?, lines?, version }
 *     POST  /expense-claims/:claimId/receipts                     multipart "file" (photo / PDF, 5 MB) -> receipt id for a line
 *     POST  /expense-claims/:claimId/submit                       -> Dept Head -> Accounts (-> Admin from Tk 50,000)
 *     POST  /expense-claims/:claimId/cancel                       draft only
 *     GET   /me/expense-advances
 *     POST  /me/expense-advances                                  { purpose, amount, neededBy? }  -> approval
 *
 *   Reading (the owner, or expenses.view)
 *     GET   /expense-claims/:claimId
 *     GET   /expense-claims/:claimId/receipts/:receiptId/file
 *     GET   /expense-advances/:advanceId
 *
 *   Accounts (expenses.view to read; expenses.pay to act; the vouchers go to the checker)
 *     GET   /companies/:companyId/expense-claims?state=&employeeId=
 *     POST  /expense-claims/:claimId/payment                      { method, paidFromAccountId, paymentDate, reference? }
 *     GET   /companies/:companyId/expense-advances?state=&employeeId=
 *     POST  /expense-advances/:advanceId/payout                   { method, paidFromAccountId, paymentDate, reference? }
 *     POST  /expense-advances/:advanceId/refund                   { amount, receivedIntoAccountId, date, reference? }
 *     POST  /expense-advances/:advanceId/recover-from-salary      { installment, firstPeriod }
 *     POST  /loans/:loanId/payout                                 pay out an approved salary advance
 *     GET   /companies/:companyId/employee-advances/balances      the sub-ledger per employee vs the books
 *     POST  /companies/:companyId/employee-advances/opening-posting  { date }  migrated advances into the books
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
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AdvanceQueryDto,
  AdvancesOpeningDto,
  ClaimQueryDto,
  CreateCategoryDto,
  CreateClaimDto,
  PayEmployeeDto,
  RecoverFromSalaryDto,
  RefundAdvanceDto,
  RequestAdvanceDto,
  UpdateCategoryDto,
  UpdateClaimDto,
} from './dto/expenses.dto.js';
import { EmployeeAdvancesService } from './employee-advances.service.js';
import {
  ExpenseClaimsService,
  MAX_RECEIPT_BYTES,
} from './expense-claims.service.js';

@Controller()
export class ExpensesController {
  constructor(
    private readonly expenseClaimsService: ExpenseClaimsService,
    private readonly employeeAdvancesService: EmployeeAdvancesService,
  ) {}

  // ------------------------------------------------------------- categories

  // GET /companies/:companyId/expense-categories
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own', 'expenses.view')
  @Get('companies/:companyId/expense-categories')
  categories(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.expenseClaimsService.categories(companyId);
  }

  // POST /companies/:companyId/expense-categories/defaults
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('companies/:companyId/expense-categories/defaults')
  defaultCategories(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.expenseClaimsService.createDefaultCategories(companyId);
  }

  // POST /companies/:companyId/expense-categories
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('companies/:companyId/expense-categories')
  createCategory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.expenseClaimsService.createCategory(companyId, dto);
  }

  // PATCH /expense-categories/:categoryId
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Patch('expense-categories/:categoryId')
  updateCategory(
    @Param('categoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.expenseClaimsService.updateCategory(categoryId, dto);
  }

  // ----------------------------------------------------------- own claims

  // GET /me/expense-claims
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Get('me/expense-claims')
  ownClaims() {
    return this.expenseClaimsService.listOwn();
  }

  // POST /me/expense-claims
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Post('me/expense-claims')
  createClaim(@Body() dto: CreateClaimDto) {
    return this.expenseClaimsService.create(dto);
  }

  // PATCH /expense-claims/:claimId
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Patch('expense-claims/:claimId')
  updateClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: UpdateClaimDto,
  ) {
    return this.expenseClaimsService.update(claimId, dto);
  }

  // POST /expense-claims/:claimId/receipts
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_RECEIPT_BYTES, files: 1 },
    }),
  )
  @Post('expense-claims/:claimId/receipts')
  uploadReceipt(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.expenseClaimsService.uploadReceipt(claimId, file);
  }

  // POST /expense-claims/:claimId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Post('expense-claims/:claimId/submit')
  @HttpCode(200)
  submitClaim(@Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.expenseClaimsService.submit(claimId);
  }

  // POST /expense-claims/:claimId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Post('expense-claims/:claimId/cancel')
  @HttpCode(200)
  cancelClaim(@Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.expenseClaimsService.cancel(claimId);
  }

  // GET /expense-claims/:claimId
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own', 'expenses.view')
  @Get('expense-claims/:claimId')
  getClaim(@Param('claimId', ParseUUIDPipe) claimId: string) {
    return this.expenseClaimsService.get(claimId);
  }

  // GET /expense-claims/:claimId/receipts/:receiptId/file
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own', 'expenses.view')
  @Get('expense-claims/:claimId/receipts/:receiptId/file')
  async receiptFile(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
  ) {
    const file = await this.expenseClaimsService.receiptFile(
      claimId,
      receiptId,
    );
    return new StreamableFile(file.content, {
      type: file.contentType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  // --------------------------------------------------------- own advances

  // GET /me/expense-advances
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Get('me/expense-advances')
  ownAdvances() {
    return this.employeeAdvancesService.listOwn();
  }

  // POST /me/expense-advances
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own')
  @Post('me/expense-advances')
  requestAdvance(@Body() dto: RequestAdvanceDto) {
    return this.employeeAdvancesService.request(dto);
  }

  // GET /expense-advances/:advanceId
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.claim_own', 'expenses.view')
  @Get('expense-advances/:advanceId')
  getAdvance(@Param('advanceId', ParseUUIDPipe) advanceId: string) {
    return this.employeeAdvancesService.get(advanceId);
  }

  // --------------------------------------------------------------- Accounts

  // GET /companies/:companyId/expense-claims?state=&employeeId=
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.view')
  @Get('companies/:companyId/expense-claims')
  listClaims(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ClaimQueryDto,
  ) {
    return this.expenseClaimsService.list(companyId, query);
  }

  // POST /expense-claims/:claimId/payment
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('expense-claims/:claimId/payment')
  payClaim(
    @Param('claimId', ParseUUIDPipe) claimId: string,
    @Body() dto: PayEmployeeDto,
  ) {
    return this.expenseClaimsService.pay(claimId, dto);
  }

  // GET /companies/:companyId/expense-advances?state=&employeeId=
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.view')
  @Get('companies/:companyId/expense-advances')
  listAdvances(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: AdvanceQueryDto,
  ) {
    return this.employeeAdvancesService.list(companyId, query);
  }

  // POST /expense-advances/:advanceId/payout
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('expense-advances/:advanceId/payout')
  payoutAdvance(
    @Param('advanceId', ParseUUIDPipe) advanceId: string,
    @Body() dto: PayEmployeeDto,
  ) {
    return this.employeeAdvancesService.payout(advanceId, dto);
  }

  // POST /expense-advances/:advanceId/refund
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('expense-advances/:advanceId/refund')
  refundAdvance(
    @Param('advanceId', ParseUUIDPipe) advanceId: string,
    @Body() dto: RefundAdvanceDto,
  ) {
    return this.employeeAdvancesService.refund(advanceId, dto);
  }

  // POST /expense-advances/:advanceId/recover-from-salary
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('expense-advances/:advanceId/recover-from-salary')
  recoverFromSalary(
    @Param('advanceId', ParseUUIDPipe) advanceId: string,
    @Body() dto: RecoverFromSalaryDto,
  ) {
    return this.employeeAdvancesService.recoverFromSalary(advanceId, dto);
  }

  // POST /loans/:loanId/payout
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('loans/:loanId/payout')
  payoutLoan(
    @Param('loanId', ParseUUIDPipe) loanId: string,
    @Body() dto: PayEmployeeDto,
  ) {
    return this.employeeAdvancesService.payoutLoan(loanId, dto);
  }

  // GET /companies/:companyId/employee-advances/balances
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.view')
  @Get('companies/:companyId/employee-advances/balances')
  balances(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.employeeAdvancesService.balances(companyId);
  }

  // POST /companies/:companyId/employee-advances/opening-posting
  @UseGuards(AuthGuard)
  @RequirePermission('expenses.pay')
  @Post('companies/:companyId/employee-advances/opening-posting')
  openingPosting(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AdvancesOpeningDto,
  ) {
    return this.employeeAdvancesService.postOpening(companyId, dto);
  }
}
