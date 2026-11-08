/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/vat-items?fiscalYear=2026-27         with their rates
 *   POST  /companies/:companyId/vat-items                            Accounts  { code, nameEn, kind, nbrCode?, rate: { fiscalYear, rateClass, vatPercent, sdPercent? } }
 *   POST  /companies/:companyId/vat-items/defaults                   Accounts  { fiscalYear }  the standard items (placeholder rates)
 *   POST  /companies/:companyId/vat-rates/copy                       Accounts  { from, to }  a year's rates to the next
 *   PATCH /vat-items/:itemId                                         Accounts  { version, nameEn?, nbrCode?, isActive? ... }
 *   PUT   /vat-items/:itemId/rate                                    Accounts  { fiscalYear, rateClass, vatPercent, sdPercent? }
 *   GET   /companies/:companyId/vat-sales?period=2026-10             the sales register (Mushak 6.2 data)
 *   POST  /companies/:companyId/vat-sales                            Accounts  a VAT invoice (Mushak 6.3) and its receipt voucher -> checker
 *   GET   /vat-sales/:saleId
 *   GET   /companies/:companyId/vat-purchases?period=2026-10         the purchase register (Mushak 6.1 data)
 *   GET   /companies/:companyId/vat-returns
 *   GET   /companies/:companyId/vat-returns/preview?period=2026-10   Mushak 9.1 figures and the ledger tie
 *   POST  /companies/:companyId/vat-returns                          Accounts  { period, submittedOn?, submissionRef? }  file (only when tied)
 *   GET   /vat-returns/:returnId
 *   POST  /vat-returns/:returnId/challan                             Accounts  { challanNo, challanDate, paidFromAccountId } -> checker
 */
import {
  Body,
  Controller,
  Get,
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
  CopyRatesDto,
  FiscalYearDto,
  PeriodQueryDto,
  UpdateVatItemDto,
  VatChallanDto,
  VatItemDto,
  VatRateDto,
  VatReturnDto,
  VatSaleDto,
} from './dto/vat.dto.js';
import { VatReturnsService } from './vat-returns.service.js';
import { VatService } from './vat.service.js';

@Controller()
export class VatController {
  constructor(
    private readonly vatService: VatService,
    private readonly vatReturnsService: VatReturnsService,
  ) {}

  // GET /companies/:companyId/vat-items
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('companies/:companyId/vat-items')
  items(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: Partial<FiscalYearDto>,
  ) {
    return this.vatService.listItems(companyId, query.fiscalYear);
  }

  // POST /companies/:companyId/vat-items
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('companies/:companyId/vat-items')
  createItem(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: VatItemDto,
  ) {
    return this.vatService.createItem(companyId, dto);
  }

  // POST /companies/:companyId/vat-items/defaults
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('companies/:companyId/vat-items/defaults')
  defaults(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: FiscalYearDto,
  ) {
    return this.vatService.createDefaultItems(companyId, dto.fiscalYear);
  }

  // POST /companies/:companyId/vat-rates/copy
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('companies/:companyId/vat-rates/copy')
  copyRates(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CopyRatesDto,
  ) {
    return this.vatService.copyRates(companyId, dto);
  }

  // PATCH /vat-items/:itemId
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Patch('vat-items/:itemId')
  updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateVatItemDto,
  ) {
    return this.vatService.updateItem(itemId, dto);
  }

  // PUT /vat-items/:itemId/rate
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Put('vat-items/:itemId/rate')
  putRate(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: VatRateDto,
  ) {
    return this.vatService.putRate(itemId, dto);
  }

  // GET /companies/:companyId/vat-sales
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('companies/:companyId/vat-sales')
  sales(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.vatService.listSales(companyId, query);
  }

  // POST /companies/:companyId/vat-sales
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('companies/:companyId/vat-sales')
  createSale(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: VatSaleDto,
  ) {
    return this.vatService.createSale(companyId, dto);
  }

  // GET /vat-sales/:saleId
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('vat-sales/:saleId')
  sale(@Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.vatService.getSale(saleId);
  }

  // GET /companies/:companyId/vat-purchases
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('companies/:companyId/vat-purchases')
  purchases(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.vatService.purchaseRegister(companyId, query);
  }

  // GET /companies/:companyId/vat-returns
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('companies/:companyId/vat-returns')
  returns(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.vatReturnsService.list(companyId);
  }

  // GET /companies/:companyId/vat-returns/preview
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('companies/:companyId/vat-returns/preview')
  preview(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PeriodQueryDto,
  ) {
    return this.vatReturnsService.preview(companyId, query.period ?? '');
  }

  // POST /companies/:companyId/vat-returns
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('companies/:companyId/vat-returns')
  file(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: VatReturnDto,
  ) {
    return this.vatReturnsService.file(companyId, dto);
  }

  // GET /vat-returns/:returnId
  @UseGuards(AuthGuard)
  @RequirePermission('vat.view', 'vat.manage')
  @Get('vat-returns/:returnId')
  getReturn(@Param('returnId', ParseUUIDPipe) returnId: string) {
    return this.vatReturnsService.get(returnId);
  }

  // POST /vat-returns/:returnId/challan
  @UseGuards(AuthGuard)
  @RequirePermission('vat.manage')
  @Post('vat-returns/:returnId/challan')
  challan(
    @Param('returnId', ParseUUIDPipe) returnId: string,
    @Body() dto: VatChallanDto,
  ) {
    return this.vatReturnsService.challan(returnId, dto);
  }
}
