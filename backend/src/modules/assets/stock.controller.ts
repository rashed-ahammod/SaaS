/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/stores
 *   POST  /companies/:companyId/stores                    Admin / Accounts  { code, name, branchId?, keeperEmployeeId? }
 *   PATCH /stores/:storeId                                { name?, branchId?, keeperEmployeeId?, isActive? }
 *   GET   /companies/:companyId/stock-items
 *   POST  /companies/:companyId/stock-items               { code, name, nameBn?, unit, reorderLevel? }
 *   PATCH /stock-items/:itemId
 *   GET   /companies/:companyId/stock?storeId=&belowReorder=true      on hand per store and item
 *   POST  /stores/:storeId/moves                          { kind: opening|receipt|adjustment, moveDate, reference?, note?, lines[] }
 *   GET   /stores/:storeId/moves?itemId=&from=&to=        the stock ledger
 *   POST  /companies/:companyId/stock-requests            an employee  { storeId, note?, lines[] }  -> Dept Head
 *   GET   /companies/:companyId/stock-requests?state=
 *   GET   /me/stock-requests                              the employee's own (app)
 *   GET   /stock-requests/:requestId
 *   POST  /stock-requests/:requestId/issue                the store  { issueDate, lines[] }
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
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  IssueStockDto,
  StockItemDto,
  StockMovesDto,
  StockMovesQueryDto,
  StockQueryDto,
  StockRequestDto,
  StockRequestQueryDto,
  StoreDto,
} from './dto/assets.dto.js';
import { StockService } from './stock.service.js';

const READERS = ['stock.view', 'stock.manage', 'stock.request_own'] as const;

@Controller()
export class StockController {
  constructor(private readonly stockService: StockService) {}

  // GET /companies/:companyId/stores
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/stores')
  stores(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.stockService.listStores(companyId);
  }

  // POST /companies/:companyId/stores
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Post('companies/:companyId/stores')
  createStore(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: StoreDto,
  ) {
    return this.stockService.createStore(companyId, dto);
  }

  // PATCH /stores/:storeId
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Patch('stores/:storeId')
  updateStore(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: Partial<StoreDto>,
  ) {
    return this.stockService.updateStore(storeId, dto);
  }

  // GET /companies/:companyId/stock-items
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/stock-items')
  items(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.stockService.listItems(companyId);
  }

  // POST /companies/:companyId/stock-items
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Post('companies/:companyId/stock-items')
  createItem(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: StockItemDto,
  ) {
    return this.stockService.createItem(companyId, dto);
  }

  // PATCH /stock-items/:itemId
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Patch('stock-items/:itemId')
  updateItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: Partial<StockItemDto>,
  ) {
    return this.stockService.updateItem(itemId, dto);
  }

  // GET /companies/:companyId/stock?storeId=&belowReorder=true
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/stock')
  balances(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: StockQueryDto,
  ) {
    return this.stockService.balances(companyId, query);
  }

  // POST /stores/:storeId/moves
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Post('stores/:storeId/moves')
  addMoves(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: StockMovesDto,
  ) {
    return this.stockService.addMoves(storeId, dto);
  }

  // GET /stores/:storeId/moves
  @UseGuards(AuthGuard)
  @RequirePermission('stock.view', 'stock.manage')
  @Get('stores/:storeId/moves')
  moves(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Query() query: StockMovesQueryDto,
  ) {
    return this.stockService.listMoves(storeId, query);
  }

  // POST /companies/:companyId/stock-requests
  @UseGuards(AuthGuard)
  @RequirePermission('stock.request_own')
  @Post('companies/:companyId/stock-requests')
  createRequest(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: StockRequestDto,
  ) {
    return this.stockService.createRequest(companyId, dto);
  }

  // GET /companies/:companyId/stock-requests?state=approved
  @UseGuards(AuthGuard)
  @RequirePermission('stock.view', 'stock.manage')
  @Get('companies/:companyId/stock-requests')
  requests(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: StockRequestQueryDto,
  ) {
    return this.stockService.listRequests(companyId, query);
  }

  // GET /me/stock-requests
  @UseGuards(AuthGuard)
  @RequirePermission('stock.request_own')
  @Get('me/stock-requests')
  myRequests() {
    return this.stockService.myRequests();
  }

  // GET /stock-requests/:requestId
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('stock-requests/:requestId')
  getRequest(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.stockService.getRequest(requestId);
  }

  // POST /stock-requests/:requestId/issue
  @UseGuards(AuthGuard)
  @RequirePermission('stock.manage')
  @Post('stock-requests/:requestId/issue')
  @HttpCode(200)
  issue(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: IssueStockDto,
  ) {
    return this.stockService.issue(requestId, dto);
  }
}
