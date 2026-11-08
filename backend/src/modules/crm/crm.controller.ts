/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/leads?state=open|new|contacted|qualified|disqualified&ownerId=&source=&q=
 *   POST  /companies/:companyId/leads                     a salesperson's lead (or for someone: Sales head / Admin)
 *   GET   /leads/:leadId                                  with its activities
 *   PATCH /leads/:leadId                                  { version, name?, organisation?, phone?, email?, district? }
 *   POST  /leads/:leadId/assign                           Sales head / Admin  { ownerId, note? }
 *   POST  /leads/:leadId/disqualify                       { reason }
 *   POST  /leads/:leadId/qualify                          { customerId } | { customer: {...} }  -> a customer
 *   POST  /leads/:leadId/activities                       { kind, subject, body?, dueOn?, ownerId? }
 *   GET   /companies/:companyId/customers?q=&type=&managerId=
 *   POST  /companies/:companyId/customers
 *   GET   /customers/:customerId                          contacts, leads, activities
 *   PATCH /customers/:customerId                          { version, ... }
 *   PUT   /customers/:customerId/credit                   Accounts  { version, creditLimit, paymentTermsDays }
 *   POST  /customers/:customerId/assign                   Sales head / Admin  { ownerId, note? }
 *   POST  /customers/:customerId/contacts                 { name, designation?, phone?, email?, isPrimary? }
 *   POST  /customers/:customerId/activities
 *   POST  /crm-activities/:activityId/done                a task done
 *   GET   /companies/:companyId/crm/my-tasks
 *   GET   /companies/:companyId/sales-territories
 *   POST  /companies/:companyId/sales-territories         Admin  { code, name, districts[], memberIds[] }
 *   PUT   /sales-territories/:territoryId                 Admin  { version, name, districts[], memberIds[], isActive? }
 *   GET   /companies/:companyId/salespeople               the company's Sales users
 *
 * n8n (Authorization: ServiceKey <id>.<secret>, permission crm.capture):
 *   POST  /companies/:companyId/leads/capture             { source, externalRef?, name, phone?, email?, district?, message?, ... }
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
import { ServiceKeyGuard } from '../identity/service-key.guard.js';
import { CustomersService } from './customers.service.js';
import {
  ActivityDto,
  AssignDto,
  CaptureLeadDto,
  ContactDto,
  CreditDto,
  CustomerDto,
  CustomerQueryDto,
  DisqualifyDto,
  LeadDto,
  LeadQueryDto,
  QualifyDto,
  TerritoryDto,
  UpdateCustomerDto,
  UpdateLeadDto,
  UpdateTerritoryDto,
} from './dto/crm.dto.js';
import { LeadsService } from './leads.service.js';
import { TerritoriesService } from './territories.service.js';

const SALES = ['crm.own', 'crm.view', 'crm.assign', 'crm.manage'] as const;
const CUSTOMERS = [...SALES, 'crm.credit'] as const;

@Controller()
export class CrmController {
  constructor(
    private readonly leadsService: LeadsService,
    private readonly customersService: CustomersService,
    private readonly territoriesService: TerritoriesService,
  ) {}

  // GET /companies/:companyId/leads
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/leads')
  leads(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: LeadQueryDto,
  ) {
    return this.leadsService.list(companyId, query);
  }

  // POST /companies/:companyId/leads
  @UseGuards(AuthGuard)
  @RequirePermission('crm.own', 'crm.assign', 'crm.manage')
  @Post('companies/:companyId/leads')
  createLead(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: LeadDto,
  ) {
    return this.leadsService.create(companyId, dto);
  }

  // POST /companies/:companyId/leads/capture   (service key, not a user)
  @UseGuards(ServiceKeyGuard)
  @RequirePermission('crm.capture')
  @Post('companies/:companyId/leads/capture')
  @HttpCode(200)
  capture(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CaptureLeadDto,
  ) {
    return this.leadsService.capture(companyId, dto);
  }

  // GET /leads/:leadId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('leads/:leadId')
  lead(@Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.leadsService.get(leadId);
  }

  // PATCH /leads/:leadId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Patch('leads/:leadId')
  updateLead(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: UpdateLeadDto,
  ) {
    return this.leadsService.update(leadId, dto);
  }

  // POST /leads/:leadId/assign
  @UseGuards(AuthGuard)
  @RequirePermission('crm.assign', 'crm.manage')
  @Post('leads/:leadId/assign')
  @HttpCode(200)
  assignLead(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: AssignDto,
  ) {
    return this.leadsService.assign(leadId, dto);
  }

  // POST /leads/:leadId/disqualify
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('leads/:leadId/disqualify')
  @HttpCode(200)
  disqualify(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: DisqualifyDto,
  ) {
    return this.leadsService.disqualify(leadId, dto.reason);
  }

  // POST /leads/:leadId/qualify
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('leads/:leadId/qualify')
  @HttpCode(200)
  qualify(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: QualifyDto,
  ) {
    return this.leadsService.qualify(leadId, dto);
  }

  // POST /leads/:leadId/activities
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('leads/:leadId/activities')
  leadActivity(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: ActivityDto,
  ) {
    return this.leadsService.addActivity({ leadId }, dto);
  }

  // GET /companies/:companyId/customers
  @UseGuards(AuthGuard)
  @RequirePermission(...CUSTOMERS)
  @Get('companies/:companyId/customers')
  customers(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: CustomerQueryDto,
  ) {
    return this.customersService.list(companyId, query);
  }

  // POST /companies/:companyId/customers
  @UseGuards(AuthGuard)
  @RequirePermission('crm.own', 'crm.assign', 'crm.manage')
  @Post('companies/:companyId/customers')
  createCustomer(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CustomerDto,
  ) {
    return this.customersService.create(companyId, dto);
  }

  // GET /customers/:customerId
  @UseGuards(AuthGuard)
  @RequirePermission(...CUSTOMERS)
  @Get('customers/:customerId')
  customer(@Param('customerId', ParseUUIDPipe) customerId: string) {
    return this.customersService.get(customerId);
  }

  // PATCH /customers/:customerId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Patch('customers/:customerId')
  updateCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customersService.update(customerId, dto);
  }

  // PUT /customers/:customerId/credit
  @UseGuards(AuthGuard)
  @RequirePermission('crm.credit')
  @Put('customers/:customerId/credit')
  credit(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: CreditDto,
  ) {
    return this.customersService.credit(customerId, dto);
  }

  // POST /customers/:customerId/assign
  @UseGuards(AuthGuard)
  @RequirePermission('crm.assign', 'crm.manage')
  @Post('customers/:customerId/assign')
  @HttpCode(200)
  assignCustomer(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: AssignDto,
  ) {
    return this.customersService.assign(customerId, dto);
  }

  // POST /customers/:customerId/contacts
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('customers/:customerId/contacts')
  addContact(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: ContactDto,
  ) {
    return this.customersService.addContact(customerId, dto);
  }

  // POST /customers/:customerId/activities
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('customers/:customerId/activities')
  customerActivity(
    @Param('customerId', ParseUUIDPipe) customerId: string,
    @Body() dto: ActivityDto,
  ) {
    return this.leadsService.addActivity({ customerId }, dto);
  }

  // POST /crm-activities/:activityId/done
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('crm-activities/:activityId/done')
  @HttpCode(200)
  done(@Param('activityId', ParseUUIDPipe) activityId: string) {
    return this.leadsService.completeTask(activityId);
  }

  // GET /companies/:companyId/crm/my-tasks
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/crm/my-tasks')
  myTasks(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.leadsService.myTasks(companyId);
  }

  // GET /companies/:companyId/sales-territories
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/sales-territories')
  territories(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.territoriesService.list(companyId);
  }

  // POST /companies/:companyId/sales-territories
  @UseGuards(AuthGuard)
  @RequirePermission('crm.manage')
  @Post('companies/:companyId/sales-territories')
  createTerritory(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: TerritoryDto,
  ) {
    return this.territoriesService.create(companyId, dto);
  }

  // PUT /sales-territories/:territoryId
  @UseGuards(AuthGuard)
  @RequirePermission('crm.manage')
  @Put('sales-territories/:territoryId')
  updateTerritory(
    @Param('territoryId', ParseUUIDPipe) territoryId: string,
    @Body() dto: UpdateTerritoryDto,
  ) {
    return this.territoriesService.update(territoryId, dto);
  }

  // GET /companies/:companyId/salespeople
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/salespeople')
  salespeople(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.territoriesService.salespeople(companyId);
  }
}
