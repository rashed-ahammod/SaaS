/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/procurement-settings
 *   PUT   /companies/:companyId/procurement-settings          Accounts  { quotationThreshold?, minQuotations?, adminThreshold?, matchTolerancePercent? }
 *
 *   POST  /companies/:companyId/purchase-requisitions          any employee (own) / Accounts  { title, justification, neededBy?, lines[], employeeId? }
 *   GET   /companies/:companyId/purchase-requisitions?state=   Accounts, Admin (company), Dept Head (department)
 *   GET   /me/purchase-requisitions                            the employee's own (app)
 *   GET   /purchase-requisitions/:requisitionId                lines, quotations, comparative statement, the order
 *   PATCH /purchase-requisitions/:requisitionId                drafts  { version, ... }
 *   POST  /purchase-requisitions/:requisitionId/submit         -> Dept Head -> Accounts [-> Admin]
 *   POST  /purchase-requisitions/:requisitionId/cancel         { reason }
 *
 *   POST  /purchase-requisitions/:requisitionId/quotations     Accounts  { vendorId, reference, quotationDate, validUntil?, deliveryDays?, note?, lines[] }
 *   POST  /quotations/:quotationId/withdraw                    Accounts  { reason }
 *   POST  /purchase-requisitions/:requisitionId/comparative-statement   Accounts  { quotationId, reason? }  -> Admin
 *
 *   POST  /purchase-requisitions/:requisitionId/purchase-orders   Accounts  { quotationId, orderDate, deliveryDate?, deliverTo?, terms?, lines[] }
 *   GET   /companies/:companyId/purchase-orders?state=&vendorId=&billable=true
 *   GET   /purchase-orders/:purchaseOrderId                    lines (ordered / received / billed), receipts, bills
 *   POST  /purchase-orders/:purchaseOrderId/issue              Accounts
 *   POST  /purchase-orders/:purchaseOrderId/cancel             Accounts  { reason }
 *   POST  /purchase-orders/:purchaseOrderId/receipts           Accounts / Dept Head  { receivedDate, note?, lines[] }
 *   POST  /goods-receipts/:receiptId/cancel                    Accounts  { reason }
 *
 *   POST  /vendor-bills/:billId/match-override                 Admin  { reason }  accept a three-way match variance
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
  ComparativeStatementDto,
  CreatePurchaseOrderDto,
  CreateRequisitionDto,
  GoodsReceiptDto,
  ProcurementSettingsDto,
  PurchaseOrderQueryDto,
  QuotationDto,
  ReasonDto,
  RequisitionQueryDto,
  UpdateRequisitionDto,
} from './dto/procurement.dto.js';
import { ProcurementCommon } from './procurement-common.js';
import { PurchaseOrdersService } from './purchase-orders.service.js';
import { RequisitionsService } from './requisitions.service.js';

const ANYONE = [
  'procurement.request_own',
  'procurement.view',
  'procurement.manage',
] as const;

@Controller()
export class ProcurementController {
  constructor(
    private readonly procurementCommon: ProcurementCommon,
    private readonly requisitionsService: RequisitionsService,
    private readonly purchaseOrdersService: PurchaseOrdersService,
  ) {}

  // GET /companies/:companyId/procurement-settings
  @UseGuards(AuthGuard)
  @RequirePermission(...ANYONE)
  @Get('companies/:companyId/procurement-settings')
  settings(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.procurementCommon.getSettings(companyId);
  }

  // PUT /companies/:companyId/procurement-settings
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Put('companies/:companyId/procurement-settings')
  saveSettings(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: ProcurementSettingsDto,
  ) {
    return this.procurementCommon.saveSettings(companyId, dto);
  }

  // POST /companies/:companyId/purchase-requisitions
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.request_own', 'procurement.manage')
  @Post('companies/:companyId/purchase-requisitions')
  createRequisition(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateRequisitionDto,
  ) {
    return this.requisitionsService.create(companyId, dto);
  }

  // GET /companies/:companyId/purchase-requisitions?state=approved
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.view')
  @Get('companies/:companyId/purchase-requisitions')
  listRequisitions(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: RequisitionQueryDto,
  ) {
    return this.requisitionsService.list(companyId, query);
  }

  // GET /me/purchase-requisitions
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.request_own')
  @Get('me/purchase-requisitions')
  myRequisitions() {
    return this.requisitionsService.mine();
  }

  // GET /purchase-requisitions/:requisitionId
  @UseGuards(AuthGuard)
  @RequirePermission(...ANYONE)
  @Get('purchase-requisitions/:requisitionId')
  getRequisition(@Param('requisitionId', ParseUUIDPipe) requisitionId: string) {
    return this.requisitionsService.get(requisitionId);
  }

  // PATCH /purchase-requisitions/:requisitionId
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.request_own', 'procurement.manage')
  @Patch('purchase-requisitions/:requisitionId')
  updateRequisition(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() dto: UpdateRequisitionDto,
  ) {
    return this.requisitionsService.update(requisitionId, dto);
  }

  // POST /purchase-requisitions/:requisitionId/submit
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.request_own', 'procurement.manage')
  @Post('purchase-requisitions/:requisitionId/submit')
  @HttpCode(200)
  submitRequisition(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
  ) {
    return this.requisitionsService.submit(requisitionId);
  }

  // POST /purchase-requisitions/:requisitionId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.request_own', 'procurement.manage')
  @Post('purchase-requisitions/:requisitionId/cancel')
  @HttpCode(200)
  cancelRequisition(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.requisitionsService.cancel(requisitionId, dto.reason);
  }

  // POST /purchase-requisitions/:requisitionId/quotations
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('purchase-requisitions/:requisitionId/quotations')
  addQuotation(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() dto: QuotationDto,
  ) {
    return this.requisitionsService.addQuotation(requisitionId, dto);
  }

  // POST /quotations/:quotationId/withdraw
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('quotations/:quotationId/withdraw')
  @HttpCode(200)
  withdrawQuotation(
    @Param('quotationId', ParseUUIDPipe) quotationId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.requisitionsService.withdrawQuotation(quotationId, dto.reason);
  }

  // POST /purchase-requisitions/:requisitionId/comparative-statement
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('purchase-requisitions/:requisitionId/comparative-statement')
  @HttpCode(200)
  comparativeStatement(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() dto: ComparativeStatementDto,
  ) {
    return this.requisitionsService.submitStatement(requisitionId, dto);
  }

  // POST /purchase-requisitions/:requisitionId/purchase-orders
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('purchase-requisitions/:requisitionId/purchase-orders')
  createOrder(
    @Param('requisitionId', ParseUUIDPipe) requisitionId: string,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchaseOrdersService.create(requisitionId, dto);
  }

  // GET /companies/:companyId/purchase-orders?state=&vendorId=&billable=true
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.view', 'payables.view')
  @Get('companies/:companyId/purchase-orders')
  listOrders(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PurchaseOrderQueryDto,
  ) {
    return this.purchaseOrdersService.list(companyId, query);
  }

  // GET /purchase-orders/:purchaseOrderId
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.view')
  @Get('purchase-orders/:purchaseOrderId')
  getOrder(@Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string) {
    return this.purchaseOrdersService.get(purchaseOrderId);
  }

  // POST /purchase-orders/:purchaseOrderId/issue
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('purchase-orders/:purchaseOrderId/issue')
  @HttpCode(200)
  issueOrder(@Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string) {
    return this.purchaseOrdersService.issue(purchaseOrderId);
  }

  // POST /purchase-orders/:purchaseOrderId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('purchase-orders/:purchaseOrderId/cancel')
  @HttpCode(200)
  cancelOrder(
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.purchaseOrdersService.cancel(purchaseOrderId, dto.reason);
  }

  // POST /purchase-orders/:purchaseOrderId/receipts
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.receive')
  @Post('purchase-orders/:purchaseOrderId/receipts')
  receive(
    @Param('purchaseOrderId', ParseUUIDPipe) purchaseOrderId: string,
    @Body() dto: GoodsReceiptDto,
  ) {
    return this.purchaseOrdersService.receive(purchaseOrderId, dto);
  }

  // POST /goods-receipts/:receiptId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.manage')
  @Post('goods-receipts/:receiptId/cancel')
  @HttpCode(200)
  cancelReceipt(
    @Param('receiptId', ParseUUIDPipe) receiptId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.purchaseOrdersService.cancelReceipt(receiptId, dto.reason);
  }

  // POST /vendor-bills/:billId/match-override
  @UseGuards(AuthGuard)
  @RequirePermission('procurement.override_match')
  @Post('vendor-bills/:billId/match-override')
  @HttpCode(200)
  overrideMatch(
    @Param('billId', ParseUUIDPipe) billId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.purchaseOrdersService.overrideMatch(billId, dto.reason);
  }
}
