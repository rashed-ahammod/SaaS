/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 * Products, price lists, discount limits (WP25; set up by the Admin or Accounts):
 *   GET   /companies/:companyId/products
 *   POST  /companies/:companyId/products                       { code, name, nameBn?, kind?, unit, vatItemId }
 *   PATCH /products/:productId                                 { version, name?, nameBn?, unit?, vatItemId?, isActive? }
 *   GET   /companies/:companyId/price-lists
 *   POST  /companies/:companyId/price-lists                    { name, fiscalYear, customerType?, prices: [{ productId, unitPrice }] }
 *   GET   /companies/:companyId/discount-limits
 *   PUT   /companies/:companyId/discount-limits                { limits: [{ userId?, productId?, customerType?, maxPercent }] }
 *
 * Quotations (WP25):
 *   GET   /companies/:companyId/quotations?state=open|draft|...&customerId=&q=
 *   POST  /companies/:companyId/quotations                     { customerId, opportunityId?, quoteDate?, validUntil, language?, terms?, lines }
 *   GET   /quotations/:quotationId
 *   GET   /quotations/:quotationId/pdf?lang=bn
 *   POST  /quotations/:quotationId/revise                      { version, validUntil, terms?, lines }   -> the next revision
 *   POST  /quotations/:quotationId/submit                      { version }   -> approved, or the discount chain
 *   POST  /quotations/:quotationId/send                        { version }
 *   POST  /quotations/:quotationId/accept                      { version, orderDate?, customerRef? }   -> the sales order
 *   POST  /quotations/:quotationId/reject                      { version, reason? }
 *   POST  /quotations/:quotationId/cancel                      { version, reason? }
 *
 * Orders and invoices (WP26):
 *   GET   /companies/:companyId/sales-orders?state=&customerId=
 *   GET   /sales-orders/:orderId
 *   POST  /sales-orders/:orderId/deliver                       { version, deliveredOn?, challanNo }
 *   POST  /sales-orders/:orderId/cancel                        { version, reason }
 *   POST  /sales-orders/:orderId/invoice                       Accounts  { invoiceDate? }   -> Mushak 6.3, posted
 *   GET   /companies/:companyId/sales-invoices?customerId=&open=true
 *   GET   /sales-invoices/:invoiceId
 *   GET   /sales-invoices/:invoiceId/pdf?lang=bn
 *   POST  /sales-invoices/:invoiceId/credit-notes              Accounts  { noteDate?, reason, lines: [{ invoiceLineId, quantity }] }   Mushak 6.7
 *
 * Collections (WP27):
 *   GET   /companies/:companyId/customer-receipts?customerId=
 *   POST  /companies/:companyId/customer-receipts              Accounts  { customerId, receiptDate, method, receivedIntoAccountId, amount, vdsAmount?, vdsCertificateNo?, chequeNo?, chequeBank?, reference?, allocations }
 *   GET   /customer-receipts/:receiptId
 *   GET   /customers/:customerId/account                       what is owed, open invoices, money on account
 *   GET   /customers/:customerId/statement?from=&to=
 *   POST  /customers/:customerId/apply-advance                 Accounts  { itemId, amount, appliedOn? }
 *   (aged receivables: GET /companies/:companyId/receivables/aging?by=customer|manager, CloseController)
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
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { CatalogueService } from './catalogue.service.js';
import {
  AcceptQuotationDto,
  ApplyAdvanceDto,
  CancelOrderDto,
  CreditNoteDto,
  CustomerReceiptDto,
  DeliverDto,
  DiscountLimitsDto,
  InvoiceDto,
  InvoiceQueryDto,
  OrderQueryDto,
  PdfQueryDto,
  PriceListDto,
  ProductDto,
  QuotationDto,
  QuotationQueryDto,
  QuotationStepDto,
  ReceiptQueryDto,
  ReviseQuotationDto,
  StatementQueryDto,
  UpdateProductDto,
} from './dto/sales.dto.js';
import { InvoicesService } from './invoices.service.js';
import { OrdersService } from './orders.service.js';
import { QuotationsService } from './quotations.service.js';
import { ReceiptsService } from './receipts.service.js';

const SALES = ['crm.own', 'crm.view', 'crm.assign', 'crm.manage'] as const;
const SALES_OR_ACCOUNTS = [...SALES, 'receivables.view'] as const;
const CATALOGUE = [...SALES_OR_ACCOUNTS, 'sales.catalogue'] as const;

@Controller()
export class SalesController {
  constructor(
    private readonly catalogueService: CatalogueService,
    private readonly quotationsService: QuotationsService,
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
    private readonly receiptsService: ReceiptsService,
  ) {}

  // ================================================================ catalogue

  // GET /companies/:companyId/products
  @UseGuards(AuthGuard)
  @RequirePermission(...CATALOGUE)
  @Get('companies/:companyId/products')
  products(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.catalogueService.products(companyId);
  }

  // POST /companies/:companyId/products
  @UseGuards(AuthGuard)
  @RequirePermission('sales.catalogue')
  @Post('companies/:companyId/products')
  createProduct(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProductDto,
  ) {
    return this.catalogueService.createProduct(companyId, dto);
  }

  // PATCH /products/:productId
  @UseGuards(AuthGuard)
  @RequirePermission('sales.catalogue')
  @Patch('products/:productId')
  updateProduct(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.catalogueService.updateProduct(productId, dto);
  }

  // GET /companies/:companyId/price-lists
  @UseGuards(AuthGuard)
  @RequirePermission(...CATALOGUE)
  @Get('companies/:companyId/price-lists')
  priceLists(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.catalogueService.priceLists(companyId);
  }

  // POST /companies/:companyId/price-lists
  @UseGuards(AuthGuard)
  @RequirePermission('sales.catalogue')
  @Post('companies/:companyId/price-lists')
  createPriceList(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: PriceListDto,
  ) {
    return this.catalogueService.createPriceList(companyId, dto);
  }

  // GET /companies/:companyId/discount-limits
  @UseGuards(AuthGuard)
  @RequirePermission(...CATALOGUE)
  @Get('companies/:companyId/discount-limits')
  discountLimits(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.catalogueService.discountLimits(companyId);
  }

  // PUT /companies/:companyId/discount-limits
  @UseGuards(AuthGuard)
  @RequirePermission('sales.catalogue')
  @Put('companies/:companyId/discount-limits')
  setDiscountLimits(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: DiscountLimitsDto,
  ) {
    return this.catalogueService.setDiscountLimits(companyId, dto);
  }

  // ================================================================ quotations

  // GET /companies/:companyId/quotations
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('companies/:companyId/quotations')
  quotations(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: QuotationQueryDto,
  ) {
    return this.quotationsService.list(companyId, query);
  }

  // POST /companies/:companyId/quotations
  @UseGuards(AuthGuard)
  @RequirePermission('crm.own', 'crm.assign', 'crm.manage')
  @Post('companies/:companyId/quotations')
  createQuotation(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: QuotationDto,
  ) {
    return this.quotationsService.create(companyId, dto);
  }

  // GET /quotations/:quotationId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('quotations/:quotationId')
  quotation(@Param('quotationId', ParseUUIDPipe) quotationId: string) {
    return this.quotationsService.get(quotationId);
  }

  // GET /quotations/:quotationId/pdf
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('quotations/:quotationId/pdf')
  async quotationPdf(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Query() query: PdfQueryDto,
  ) {
    const file = await this.quotationsService.pdf(quotationId, query.lang);
    return new StreamableFile(file.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // POST /quotations/:quotationId/revise
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/revise')
  revise(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: ReviseQuotationDto,
  ) {
    return this.quotationsService.revise(quotationId, dto);
  }

  // POST /quotations/:quotationId/submit
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/submit')
  @HttpCode(200)
  submitQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: QuotationStepDto,
  ) {
    return this.quotationsService.submit(quotationId, dto);
  }

  // POST /quotations/:quotationId/send
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/send')
  @HttpCode(200)
  sendQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: QuotationStepDto,
  ) {
    return this.quotationsService.send(quotationId, dto);
  }

  // POST /quotations/:quotationId/accept
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/accept')
  @HttpCode(200)
  acceptQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: AcceptQuotationDto,
  ) {
    return this.quotationsService.accept(quotationId, dto);
  }

  // POST /quotations/:quotationId/reject
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/reject')
  @HttpCode(200)
  rejectQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: QuotationStepDto,
  ) {
    return this.quotationsService.reject(quotationId, dto);
  }

  // POST /quotations/:quotationId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('quotations/:quotationId/cancel')
  @HttpCode(200)
  cancelQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: QuotationStepDto,
  ) {
    return this.quotationsService.cancel(quotationId, dto);
  }

  // ================================================================ orders and invoices

  // GET /companies/:companyId/sales-orders
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('companies/:companyId/sales-orders')
  orders(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: OrderQueryDto,
  ) {
    return this.ordersService.list(companyId, query);
  }

  // GET /sales-orders/:orderId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('sales-orders/:orderId')
  order(@Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.ordersService.get(orderId);
  }

  // POST /sales-orders/:orderId/deliver
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES, 'receivables.manage')
  @Post('sales-orders/:orderId/deliver')
  @HttpCode(200)
  deliver(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DeliverDto,
  ) {
    return this.ordersService.deliver(orderId, dto);
  }

  // POST /sales-orders/:orderId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES, 'receivables.manage')
  @Post('sales-orders/:orderId/cancel')
  @HttpCode(200)
  cancelOrder(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.ordersService.cancel(orderId, dto);
  }

  // POST /sales-orders/:orderId/invoice
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.manage')
  @Post('sales-orders/:orderId/invoice')
  invoice(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: InvoiceDto,
  ) {
    return this.invoicesService.invoice(orderId, dto);
  }

  // GET /companies/:companyId/sales-invoices
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('companies/:companyId/sales-invoices')
  invoices(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: InvoiceQueryDto,
  ) {
    return this.invoicesService.list(companyId, query);
  }

  // GET /sales-invoices/:invoiceId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('sales-invoices/:invoiceId')
  salesInvoice(@Param('invoiceId', ParseUUIDPipe) invoiceId: string) {
    return this.invoicesService.get(invoiceId);
  }

  // GET /sales-invoices/:invoiceId/pdf
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('sales-invoices/:invoiceId/pdf')
  async invoicePdf(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Query() query: PdfQueryDto,
  ) {
    const file = await this.invoicesService.pdf(invoiceId, query.lang ?? 'en');
    return new StreamableFile(file.buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // POST /sales-invoices/:invoiceId/credit-notes
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.manage')
  @Post('sales-invoices/:invoiceId/credit-notes')
  creditNote(
    @Param('invoiceId', ParseUUIDPipe) invoiceId: string,
    @Body() dto: CreditNoteDto,
  ) {
    return this.invoicesService.creditNote(invoiceId, dto);
  }

  // ================================================================ collections

  // GET /companies/:companyId/customer-receipts
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.view')
  @Get('companies/:companyId/customer-receipts')
  receipts(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ReceiptQueryDto,
  ) {
    return this.receiptsService.list(companyId, query);
  }

  // POST /companies/:companyId/customer-receipts
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.manage')
  @Post('companies/:companyId/customer-receipts')
  createReceipt(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CustomerReceiptDto,
  ) {
    return this.receiptsService.create(companyId, dto);
  }

  // GET /customer-receipts/:receiptId
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.view')
  @Get('customer-receipts/:receiptId')
  receipt(@Param('receiptId', ParseUUIDPipe) receiptId: string) {
    return this.receiptsService.get(receiptId);
  }

  // GET /customers/:customerId/account
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('customers/:customerId/account')
  customerAccount(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.receiptsService.account(customerId);
  }

  // GET /customers/:customerId/statement
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES_OR_ACCOUNTS)
  @Get('customers/:customerId/statement')
  statement(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Query() query: StatementQueryDto,
  ) {
    return this.receiptsService.statement(customerId, query);
  }

  // POST /customers/:customerId/apply-advance
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.manage')
  @Post('customers/:customerId/apply-advance')
  @HttpCode(200)
  applyAdvance(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: ApplyAdvanceDto,
  ) {
    return this.receiptsService.applyAdvance(customerId, dto);
  }
}
