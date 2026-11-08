/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET    /companies/:companyId/opening-balances                       the import and how many old accounts are mapped
 *   POST   /companies/:companyId/opening-balances                       Accounts  multipart "file" (CSV) + { cutOverDate }  -> the opening voucher, to the checker
 *   GET    /companies/:companyId/receivables?open=true                  customers' invoices
 *   GET    /companies/:companyId/receivables/aging?asOf=&by=customer|manager
 *   POST   /receivable-items/:itemId/receipts                           Accounts  { receiptDate, amount, receivedIntoAccountId, reference? }  -> checker
 *   GET    /companies/:companyId/reports/cash-flow?from=&to=
 *   GET    /companies/:companyId/reports/department-cost?from=&to=
 *   GET    /companies/:companyId/month-close/:period                    the checklist
 *   POST   /companies/:companyId/month-close/:period/items/:key         Accounts  { note }  a person's item done
 *   DELETE /companies/:companyId/month-close/:period/items/:key         Accounts  undo it
 *   POST   /companies/:companyId/month-close/:period/close              Accounts  close the month (all items done)
 *   GET    /companies/:companyId/account-map                            old system account -> ours
 *   PUT    /companies/:companyId/account-map                            Accounts  { oldCode, oldName?, accountId }
 *   GET    /companies/:companyId/old-system-comparisons
 *   POST   /companies/:companyId/old-system-comparisons                 Accounts  multipart "file" (CSV) + { asOf, note? }
 *   GET    /old-system-comparisons/:comparisonId
 *   GET    /companies/:companyId/gate-2                                 the Gate 2 report
 */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MSG } from '../../platform/i18n/messages.js';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  AccountMapDto,
  ComparisonDto,
  OpeningBalancesDto,
  RangeQueryDto,
  ReceiptDto,
  ReceivablesQueryDto,
  TickDto,
} from './dto/close.dto.js';
import { FinanceReportsService } from './finance-reports.service.js';
import { Gate2Service } from './gate2.service.js';
import { MonthCloseService } from './month-close.service.js';
import {
  MAX_TB_BYTES,
  OpeningBalancesService,
} from './opening-balances.service.js';
import { ReceivablesService } from './receivables.service.js';

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

@Controller()
export class CloseController {
  constructor(
    private readonly openingBalancesService: OpeningBalancesService,
    private readonly receivablesService: ReceivablesService,
    private readonly financeReportsService: FinanceReportsService,
    private readonly monthCloseService: MonthCloseService,
    private readonly gate2Service: Gate2Service,
  ) {}

  // GET /companies/:companyId/opening-balances
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/opening-balances')
  openingStatus(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.openingBalancesService.status(companyId);
  }

  // POST /companies/:companyId/opening-balances
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_TB_BYTES, files: 1 } }),
  )
  @Post('companies/:companyId/opening-balances')
  importOpening(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: OpeningBalancesDto,
  ) {
    return this.openingBalancesService.upload(companyId, file, dto.cutOverDate);
  }

  // GET /companies/:companyId/receivables
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.view')
  @Get('companies/:companyId/receivables')
  receivables(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ReceivablesQueryDto,
  ) {
    return this.receivablesService.list(companyId, query.open === 'true');
  }

  // GET /companies/:companyId/receivables/aging
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.view')
  @Get('companies/:companyId/receivables/aging')
  receivablesAging(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ReceivablesQueryDto,
  ) {
    return this.receivablesService.aging(companyId, query.asOf, query.by);
  }

  // POST /receivable-items/:itemId/receipts
  @UseGuards(AuthGuard)
  @RequirePermission('receivables.manage')
  @Post('receivable-items/:itemId/receipts')
  receipt(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: ReceiptDto,
  ) {
    return this.receivablesService.receipt(itemId, dto);
  }

  // GET /companies/:companyId/reports/cash-flow
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/reports/cash-flow')
  cashFlow(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: RangeQueryDto,
  ) {
    return this.financeReportsService.cashFlow(companyId, query.from, query.to);
  }

  // GET /companies/:companyId/reports/department-cost
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/reports/department-cost')
  departmentCost(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: RangeQueryDto,
  ) {
    return this.financeReportsService.departmentCost(
      companyId,
      query.from,
      query.to,
    );
  }

  // GET /companies/:companyId/month-close/:period
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/month-close/:period')
  checklist(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('period') period: string,
  ) {
    return this.monthCloseService.checklist(companyId, this.period(period));
  }

  // POST /companies/:companyId/month-close/:period/items/:key
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.periods.close')
  @Post('companies/:companyId/month-close/:period/items/:key')
  @HttpCode(200)
  tick(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('period') period: string,
    @Param('key') key: string,
    @Body() dto: TickDto,
  ) {
    return this.monthCloseService.tick(
      companyId,
      this.period(period),
      key,
      dto.note,
    );
  }

  // DELETE /companies/:companyId/month-close/:period/items/:key
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.periods.close')
  @Delete('companies/:companyId/month-close/:period/items/:key')
  untick(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('period') period: string,
    @Param('key') key: string,
  ) {
    return this.monthCloseService.untick(companyId, this.period(period), key);
  }

  // POST /companies/:companyId/month-close/:period/close
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.periods.close')
  @Post('companies/:companyId/month-close/:period/close')
  @HttpCode(200)
  close(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Param('period') period: string,
  ) {
    return this.monthCloseService.close(companyId, this.period(period));
  }

  // GET /companies/:companyId/account-map
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/account-map')
  accountMap(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.gate2Service.accountMap(companyId);
  }

  // PUT /companies/:companyId/account-map
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @Put('companies/:companyId/account-map')
  setMap(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AccountMapDto,
  ) {
    return this.gate2Service.map(companyId, dto);
  }

  // GET /companies/:companyId/old-system-comparisons
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/old-system-comparisons')
  comparisons(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.gate2Service.list(companyId);
  }

  // POST /companies/:companyId/old-system-comparisons
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.setup')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_TB_BYTES, files: 1 } }),
  )
  @Post('companies/:companyId/old-system-comparisons')
  compare(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ComparisonDto,
  ) {
    return this.gate2Service.upload(companyId, file, dto.asOf, dto.note);
  }

  // GET /old-system-comparisons/:comparisonId
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('old-system-comparisons/:comparisonId')
  comparison(@Param('comparisonId', ParseUUIDPipe) comparisonId: string) {
    return this.gate2Service.get(comparisonId);
  }

  // GET /companies/:companyId/gate-2
  @UseGuards(AuthGuard)
  @RequirePermission('ledger.view')
  @Get('companies/:companyId/gate-2')
  gate2(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.gate2Service.report(companyId);
  }

  private period(period: string) {
    if (!PERIOD.test(period))
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    return period;
  }
}
