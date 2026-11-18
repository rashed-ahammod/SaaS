/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/support/tickets?state=open_only|breached|new|open|waiting_customer|resolved|closed
 *                                                    &priority=&customerId=&assigneeId=&q=
 *   POST  /companies/:companyId/support/tickets      { customerId, categoryId, subject, description, priority?, source?, contactId?, assigneeId? }
 *   GET   /companies/:companyId/support/my-tickets   what is on my desk, worst SLA first
 *   GET   /support/tickets/:ticketId                 with the thread
 *   POST  /support/tickets/:ticketId/messages        { kind: reply|note|customer, body }
 *   POST  /support/tickets/:ticketId/assign          support.manage  { assigneeId, note? }
 *   PUT   /support/tickets/:ticketId/priority        { priority, reason }
 *   POST  /support/tickets/:ticketId/wait            { question }   asks the customer; the clock stops
 *   POST  /support/tickets/:ticketId/resolve         { resolution }
 *   POST  /support/tickets/:ticketId/close
 *   POST  /support/tickets/:ticketId/reopen          support.manage  { reason }
 *
 *   GET   /companies/:companyId/support/categories?all=1
 *   POST  /companies/:companyId/support/categories   support.manage  { code, name, nameBn?, defaultPriority? }
 *   PUT   /support/categories/:ticketCategoryId            support.manage  { version, name?, nameBn?, defaultPriority?, isActive? }
 *   GET   /companies/:companyId/support/sla          the working hours per priority
 *   PUT   /companies/:companyId/support/sla          support.manage  { rows: [ { priority, firstResponseHours, resolutionHours } ] }
 *
 *   GET   /customers/:customerId/360                 Customer 360 (only the blocks the viewer may see)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { Customer360Service } from './customer-360.service.js';
import {
  AssignTicketDto,
  CategoryDto,
  PriorityDto,
  ReopenTicketDto,
  ResolveTicketDto,
  SlaPolicyDto,
  TicketDto,
  TicketMessageDto,
  TicketQueryDto,
  UpdateCategoryDto,
  WaitDto,
} from './dto/support.dto.js';
import { SupportSettingsService } from './support-settings.service.js';
import { TicketSlaService } from './ticket-sla.service.js';
import { TicketsService } from './tickets.service.js';

const SUPPORT = ['support.own', 'support.view', 'support.manage'] as const;
const WORK = ['support.own', 'support.manage'] as const;
/** Customer 360 opens for anyone who may see a part of it; the service decides which parts. */
const CUSTOMER_360 = [
  ...SUPPORT,
  'crm.own',
  'crm.view',
  'crm.assign',
  'crm.manage',
  'crm.credit',
  'receivables.view',
] as const;

@Controller()
export class SupportController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly settingsService: SupportSettingsService,
    private readonly slaService: TicketSlaService,
    private readonly customer360Service: Customer360Service,
  ) {}

  // ================================================================= tickets

  @UseGuards(AuthGuard)
  @RequirePermission(...SUPPORT)
  @Get('companies/:companyId/support/tickets')
  tickets(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: TicketQueryDto,
  ) {
    return this.ticketsService.list(companyId, query);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Post('companies/:companyId/support/tickets')
  createTicket(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: TicketDto,
  ) {
    return this.ticketsService.create(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Get('companies/:companyId/support/my-tickets')
  myTickets(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.ticketsService.mine(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SUPPORT)
  @Get('support/tickets/:ticketId')
  ticket(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.ticketsService.get(ticketId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Post('support/tickets/:ticketId/messages')
  addMessage(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: TicketMessageDto,
  ) {
    return this.ticketsService.addMessage(ticketId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('support.manage')
  @Post('support/tickets/:ticketId/assign')
  @HttpCode(200)
  assign(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.ticketsService.assign(ticketId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Put('support/tickets/:ticketId/priority')
  setPriority(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: PriorityDto,
  ) {
    return this.ticketsService.setPriority(ticketId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Post('support/tickets/:ticketId/wait')
  @HttpCode(200)
  wait(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: WaitDto,
  ) {
    return this.ticketsService.waitForCustomer(ticketId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Post('support/tickets/:ticketId/resolve')
  @HttpCode(200)
  resolve(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: ResolveTicketDto,
  ) {
    return this.ticketsService.resolve(ticketId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...WORK)
  @Post('support/tickets/:ticketId/close')
  @HttpCode(200)
  close(@Param('ticketId', ParseUUIDPipe) ticketId: string) {
    return this.ticketsService.close(ticketId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('support.manage')
  @Post('support/tickets/:ticketId/reopen')
  @HttpCode(200)
  reopen(
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: ReopenTicketDto,
  ) {
    return this.ticketsService.reopen(ticketId, dto);
  }

  // ================================================================ settings

  @UseGuards(AuthGuard)
  @RequirePermission(...SUPPORT)
  @Get('companies/:companyId/support/categories')
  categories(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query('all') all?: string,
  ) {
    return this.settingsService.categories(companyId, { all: all === '1' });
  }

  @UseGuards(AuthGuard)
  @RequirePermission('support.manage')
  @Post('companies/:companyId/support/categories')
  createCategory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CategoryDto,
  ) {
    return this.settingsService.createCategory(companyId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('support.manage')
  @Put('support/categories/:ticketCategoryId')
  updateCategory(
    @Param('ticketCategoryId', ParseUUIDPipe) categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.settingsService.updateCategory(categoryId, dto);
  }

  @UseGuards(AuthGuard)
  @RequirePermission(...SUPPORT)
  @Get('companies/:companyId/support/sla')
  sla(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.slaService.policies(companyId);
  }

  @UseGuards(AuthGuard)
  @RequirePermission('support.manage')
  @Put('companies/:companyId/support/sla')
  setSla(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SlaPolicyDto,
  ) {
    return this.slaService.setPolicies(companyId, dto);
  }

  // ============================================================ customer 360

  @UseGuards(AuthGuard)
  @RequirePermission(...CUSTOMER_360)
  @Get('customers/:customerId/360')
  customer360(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customer360Service.get(customerId);
  }
}
