/**
 * Routes (Phase 2 WP15, vendors, bills and tax at source; writes need Idempotency-Key):
 *
 *   Settings (reading: payables.view; changing: payables.tax)
 *     GET   /companies/:companyId/payables-settings
 *     PUT   /companies/:companyId/payables-settings            { vatWithholdingEntity, defaultPaymentTermsDays? }
 *     GET   /companies/:companyId/withholding-categories?date= payment categories and rates (rule pack)
 *
 *   Vendors (payables.manage)
 *     GET   /companies/:companyId/vendors?search=&active=
 *     POST  /companies/:companyId/vendors                      { name, nameBn?, vendorType?, tin?, bin?, phone?, withholdingCategory?, ... }
 *     GET   /vendors/:vendorId
 *     PATCH /vendors/:vendorId                                 { ..., version }
 *     POST  /vendors/:vendorId/bank-accounts                   step-up (X-OTP-Code)  -> pending; another Accounts user approves
 *     GET   /vendors/:vendorId/statement?to=&from=             the vendor's account in the books
 *
 *   Bills (maker: payables.manage; checker: the approval inbox)
 *     GET   /companies/:companyId/vendor-bills?vendorId=&state=&open=&from=&to=
 *     POST  /companies/:companyId/vendor-bills                 { vendorId, billNo, billDate, dueDate?, narration, withholdingCategory?, lines[] }
 *     GET   /vendor-bills/:billId
 *     PATCH /vendor-bills/:billId                              draft only: { ..., version }
 *     POST  /vendor-bills/:billId/submit                       -> approval; once approved: posted, tax withheld
 *     POST  /vendor-bills/:billId/cancel                       { reason }  draft only
 *
 *   Payments (payables.manage; the payment voucher goes to the checker)
 *     GET   /companies/:companyId/vendor-payments?vendorId=&state=
 *     POST  /companies/:companyId/vendor-payments              { vendorId, paymentDate, method, reference?, paidFromAccountId, allocations[] }
 *     GET   /vendor-payments/:vendorPaymentId
 *
 *   Tax at source (reading: payables.view; challans and certificates: payables.tax)
 *     GET   /companies/:companyId/tax-withholdings?taxType=&period=&deposited=
 *     GET   /companies/:companyId/tax-challans
 *     POST  /companies/:companyId/tax-challans                 { taxType, period, challanNo, challanDate, paidFromAccountId }
 *     GET   /tax-challans/:challanId
 *     POST  /vendors/:vendorId/tax-certificates                { taxType, from, to }
 *     GET   /companies/:companyId/tax-certificates
 *     GET   /tax-certificates/:certificateId
 *
 *   Reports (payables.view)
 *     GET   /companies/:companyId/payables/aging?asOf=
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
import {
  RequirePermission,
  RequireStepUp,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AgingQueryDto,
  BillQueryDto,
  CategoriesQueryDto,
  CreateBillDto,
  CreateCertificateDto,
  CreateChallanDto,
  CreateVendorDto,
  CreateVendorPaymentDto,
  PayablesReasonDto,
  PayablesSettingsDto,
  PaymentQueryDto,
  StatementQueryDto,
  UpdateBillDto,
  UpdateVendorDto,
  VendorBankAccountDto,
  VendorQueryDto,
  WithholdingQueryDto,
} from './dto/payables.dto.js';
import { PayablesReportsService } from './payables-reports.service.js';
import { TaxAtSourceService } from './tax-at-source.service.js';
import { VendorBillsService } from './vendor-bills.service.js';
import { VendorPaymentsService } from './vendor-payments.service.js';
import { VendorsService } from './vendors.service.js';

@Controller()
export class PayablesController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly vendorBillsService: VendorBillsService,
    private readonly vendorPaymentsService: VendorPaymentsService,
    private readonly taxAtSourceService: TaxAtSourceService,
    private readonly payablesReportsService: PayablesReportsService,
  ) {}

  // --------------------------------------------------------------- settings

  // GET /companies/:companyId/payables-settings
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/payables-settings')
  settings(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.vendorsService.settings(companyId);
  }

  // PUT /companies/:companyId/payables-settings
  @UseGuards(AuthGuard)
  @RequirePermission('payables.tax')
  @Put('companies/:companyId/payables-settings')
  updateSettings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PayablesSettingsDto,
  ) {
    return this.vendorsService.updateSettings(companyId, dto);
  }

  // GET /companies/:companyId/withholding-categories?date=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/withholding-categories')
  categories(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: CategoriesQueryDto,
  ) {
    return this.vendorsService.categories(companyId, query.date);
  }

  // ---------------------------------------------------------------- vendors

  // GET /companies/:companyId/vendors?search=&active=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/vendors')
  listVendors(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: VendorQueryDto,
  ) {
    return this.vendorsService.list(companyId, query);
  }

  // POST /companies/:companyId/vendors
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Post('companies/:companyId/vendors')
  createVendor(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateVendorDto,
  ) {
    return this.vendorsService.create(companyId, dto);
  }

  // GET /vendors/:vendorId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('vendors/:vendorId')
  getVendor(@Param('vendorId', ParseUUIDPipe) vendorId: string) {
    return this.vendorsService.get(vendorId);
  }

  // PATCH /vendors/:vendorId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Patch('vendors/:vendorId')
  updateVendor(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: UpdateVendorDto,
  ) {
    return this.vendorsService.update(vendorId, dto);
  }

  // POST /vendors/:vendorId/bank-accounts
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @RequireStepUp()
  @Post('vendors/:vendorId/bank-accounts')
  requestBankAccount(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: VendorBankAccountDto,
  ) {
    return this.vendorsService.requestBankAccount(vendorId, dto);
  }

  // GET /vendors/:vendorId/statement?to=&from=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('vendors/:vendorId/statement')
  statement(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.payablesReportsService.statement(
      vendorId,
      query.to,
      query.from,
    );
  }

  // ------------------------------------------------------------------ bills

  // GET /companies/:companyId/vendor-bills?vendorId=&state=&open=&from=&to=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/vendor-bills')
  listBills(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: BillQueryDto,
  ) {
    return this.vendorBillsService.list(companyId, query);
  }

  // POST /companies/:companyId/vendor-bills
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Post('companies/:companyId/vendor-bills')
  createBill(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateBillDto,
  ) {
    return this.vendorBillsService.create(companyId, dto);
  }

  // GET /vendor-bills/:billId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('vendor-bills/:billId')
  getBill(@Param('billId', ParseUUIDPipe) billId: string) {
    return this.vendorBillsService.get(billId);
  }

  // PATCH /vendor-bills/:billId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Patch('vendor-bills/:billId')
  updateBill(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: UpdateBillDto,
  ) {
    return this.vendorBillsService.update(billId, dto);
  }

  // POST /vendor-bills/:billId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Post('vendor-bills/:billId/submit')
  @HttpCode(200)
  submitBill(@Param('billId', ParseUUIDPipe) billId: string) {
    return this.vendorBillsService.submit(billId);
  }

  // POST /vendor-bills/:billId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Post('vendor-bills/:billId/cancel')
  @HttpCode(200)
  cancelBill(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: PayablesReasonDto,
  ) {
    return this.vendorBillsService.cancel(billId, dto.reason);
  }

  // --------------------------------------------------------------- payments

  // GET /companies/:companyId/vendor-payments?vendorId=&state=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/vendor-payments')
  listPayments(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PaymentQueryDto,
  ) {
    return this.vendorPaymentsService.list(companyId, query);
  }

  // POST /companies/:companyId/vendor-payments
  @UseGuards(AuthGuard)
  @RequirePermission('payables.manage')
  @Post('companies/:companyId/vendor-payments')
  createPayment(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateVendorPaymentDto,
  ) {
    return this.vendorPaymentsService.create(companyId, dto);
  }

  // GET /vendor-payments/:vendorPaymentId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('vendor-payments/:vendorPaymentId')
  getPayment(@Param('vendorPaymentId', ParseUUIDPipe) vendorPaymentId: string) {
    return this.vendorPaymentsService.get(vendorPaymentId);
  }

  // ---------------------------------------------------------- tax at source

  // GET /companies/:companyId/tax-withholdings?taxType=&period=&deposited=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/tax-withholdings')
  withholdings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: WithholdingQueryDto,
  ) {
    return this.taxAtSourceService.withholdings(companyId, query);
  }

  // GET /companies/:companyId/tax-challans
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/tax-challans')
  listChallans(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.taxAtSourceService.listChallans(companyId);
  }

  // POST /companies/:companyId/tax-challans
  @UseGuards(AuthGuard)
  @RequirePermission('payables.tax')
  @Post('companies/:companyId/tax-challans')
  createChallan(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateChallanDto,
  ) {
    return this.taxAtSourceService.createChallan(companyId, dto);
  }

  // GET /tax-challans/:challanId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('tax-challans/:challanId')
  getChallan(@Param('challanId', ParseUUIDPipe) challanId: string) {
    return this.taxAtSourceService.getChallan(challanId);
  }

  // POST /vendors/:vendorId/tax-certificates
  @UseGuards(AuthGuard)
  @RequirePermission('payables.tax')
  @Post('vendors/:vendorId/tax-certificates')
  issueCertificate(
    @Param('vendorId', ParseUUIDPipe) vendorId: string,
    @Body() dto: CreateCertificateDto,
  ) {
    return this.taxAtSourceService.issueCertificate(vendorId, dto);
  }

  // GET /companies/:companyId/tax-certificates
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/tax-certificates')
  listCertificates(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.taxAtSourceService.listCertificates(companyId);
  }

  // GET /tax-certificates/:certificateId
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('tax-certificates/:certificateId')
  getCertificate(@Param('certificateId', ParseUUIDPipe) certificateId: string) {
    return this.taxAtSourceService.getCertificate(certificateId);
  }

  // ---------------------------------------------------------------- reports

  // GET /companies/:companyId/payables/aging?asOf=
  @UseGuards(AuthGuard)
  @RequirePermission('payables.view')
  @Get('companies/:companyId/payables/aging')
  aging(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: AgingQueryDto,
  ) {
    return this.payablesReportsService.aging(companyId, query.asOf);
  }
}
