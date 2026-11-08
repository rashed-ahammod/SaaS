/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /approvals/inbox                         waiting for me (or for someone who delegated to me)
 *   GET   /approvals/requests/mine                 requests I submitted
 *   GET   /approvals/requests?companyId=&…         every request of the company (approvals.view_all)
 *   GET   /approvals/requests/:requestId           details, approvers, full history
 *   POST  /approvals/requests/:requestId/approve   { comment? }
 *   POST  /approvals/requests/:requestId/reject    { comment }
 *   POST  /approvals/requests/:requestId/return    { comment }   (send back for correction)
 *   POST  /approvals/requests/:requestId/cancel    { comment? }  (requester only)
 *
 *   GET   /approvals/chains                        configured + built-in chains
 *   POST  /approvals/chains                        { requestType, name, priority?, conditions?, steps[] }
 *   PATCH /approvals/chains/:chainId               { name?, priority?, isActive?, version }
 *
 * Requests are created by the module that owns them (e.g. POST /employees/:id/bank-accounts).
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
import {
  AnyAuthenticated,
  RequirePermission,
} from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { ApprovalChainsService } from './approval-chains.service.js';
import { ApprovalsService } from './approvals.service.js';
import {
  ApproveDto,
  CreateChainDto,
  DecisionWithCommentDto,
  ListRequestsQueryDto,
  UpdateChainDto,
} from './dto/approvals.dto.js';

@Controller('approvals')
export class ApprovalsController {
  constructor(
    private readonly approvalsService: ApprovalsService,
    private readonly chainsService: ApprovalChainsService,
  ) {}

  // GET /approvals/inbox
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('inbox')
  inbox() {
    return this.approvalsService.inbox();
  }

  // GET /approvals/requests/mine
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('requests/mine')
  myRequests() {
    return this.approvalsService.myRequests();
  }

  // GET /approvals/requests?companyId=&requestType=&state=&open=&overdue=
  // (declared before :requestId, which would reject an empty id)
  @UseGuards(AuthGuard)
  @RequirePermission('approvals.view_all')
  @Get('requests')
  listCompanyRequests(@Query() query: ListRequestsQueryDto) {
    return this.approvalsService.listCompanyRequests(query);
  }

  // GET /approvals/requests/:requestId
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Get('requests/:requestId')
  getRequest(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.approvalsService.getRequest(requestId);
  }

  // POST /approvals/requests/:requestId/approve
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('requests/:requestId/approve')
  @HttpCode(200)
  approve(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveDto,
  ) {
    return this.approvalsService.decide(requestId, 'approve', dto.comment);
  }

  // POST /approvals/requests/:requestId/reject
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('requests/:requestId/reject')
  @HttpCode(200)
  reject(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: DecisionWithCommentDto,
  ) {
    return this.approvalsService.decide(requestId, 'reject', dto.comment);
  }

  // POST /approvals/requests/:requestId/return
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('requests/:requestId/return')
  @HttpCode(200)
  returnForCorrection(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: DecisionWithCommentDto,
  ) {
    return this.approvalsService.decide(requestId, 'return', dto.comment);
  }

  // POST /approvals/requests/:requestId/cancel
  @UseGuards(AuthGuard)
  @AnyAuthenticated()
  @Post('requests/:requestId/cancel')
  @HttpCode(200)
  cancel(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApproveDto,
  ) {
    return this.approvalsService.cancel(requestId, dto.comment);
  }

  // GET /approvals/chains
  @UseGuards(AuthGuard)
  @RequirePermission('approvals.configure')
  @Get('chains')
  listChains() {
    return this.chainsService.listChains();
  }

  // POST /approvals/chains
  @UseGuards(AuthGuard)
  @RequirePermission('approvals.configure')
  @Post('chains')
  createChain(@Body() dto: CreateChainDto) {
    return this.chainsService.createChain(dto);
  }

  // PATCH /approvals/chains/:chainId
  @UseGuards(AuthGuard)
  @RequirePermission('approvals.configure')
  @Patch('chains/:chainId')
  updateChain(
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() dto: UpdateChainDto,
  ) {
    return this.chainsService.updateChain(chainId, dto);
  }
}
