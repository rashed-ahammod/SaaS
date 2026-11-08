/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/opportunity-stages                the stages, in order (five defaults on first use)
 *   POST  /companies/:companyId/opportunity-stages                Admin  { name, nameBn?, probability, sortOrder }
 *   PUT   /opportunity-stages/:stageId                            Admin  { version, name, nameBn?, probability, sortOrder, isActive? }
 *   GET   /companies/:companyId/opportunities?state=open|won|lost&ownerId=&stageId=&customerId=&q=
 *   POST  /companies/:companyId/opportunities                     { customerId, title, value, expectedCloseOn, stageId?, probability?, ownerId? }
 *   GET   /opportunities/:opportunityId                           with its stage history
 *   PATCH /opportunities/:opportunityId                           { version, title?, value?, probability?, expectedCloseOn? }
 *   POST  /opportunities/:opportunityId/stage                     { version, stageId, probability?, note? }
 *   POST  /opportunities/:opportunityId/won                       { version, closedOn?, value?, note? }   -> opportunity.won
 *   POST  /opportunities/:opportunityId/lost                      { version, reason, closedOn?, note? }
 *   POST  /opportunities/:opportunityId/reopen                    { version, stageId, expectedCloseOn, note }
 *   POST  /opportunities/:opportunityId/assign                    Sales head / Admin  { ownerId, note? }
 *   GET   /companies/:companyId/pipeline?ownerId=&departmentId=   the board: open opportunities by stage
 *   GET   /companies/:companyId/sales-forecast?from=YYYY-MM&to=YYYY-MM&ownerId=&departmentId=
 *   GET   /companies/:companyId/sales-targets?month=YYYY-MM       targets, won and expected
 *   PUT   /companies/:companyId/sales-targets                     Sales head / Admin  { month, targets: [{ userId | departmentId, amount }] }
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
import { AssignDto } from './dto/crm.dto.js';
import {
  ForecastQueryDto,
  LostDto,
  MoveStageDto,
  OpportunityDto,
  OpportunityQueryDto,
  PipelineQueryDto,
  ReopenDto,
  SetTargetsDto,
  StageDto,
  TargetQueryDto,
  UpdateOpportunityDto,
  UpdateStageDto,
  WonDto,
} from './dto/opportunities.dto.js';
import { OpportunitiesService } from './opportunities.service.js';
import { SalesPipelineService } from './sales-pipeline.service.js';

const SALES = ['crm.own', 'crm.view', 'crm.assign', 'crm.manage'] as const;

@Controller()
export class OpportunitiesController {
  constructor(
    private readonly opportunitiesService: OpportunitiesService,
    private readonly pipelineService: SalesPipelineService,
  ) {}

  // GET /companies/:companyId/opportunity-stages
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/opportunity-stages')
  stages(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.opportunitiesService.stages(companyId);
  }

  // POST /companies/:companyId/opportunity-stages
  @UseGuards(AuthGuard)
  @RequirePermission('crm.manage')
  @Post('companies/:companyId/opportunity-stages')
  createStage(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: StageDto,
  ) {
    return this.opportunitiesService.createStage(companyId, dto);
  }

  // PUT /opportunity-stages/:stageId
  @UseGuards(AuthGuard)
  @RequirePermission('crm.manage')
  @Put('opportunity-stages/:stageId')
  updateStage(
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdateStageDto,
  ) {
    return this.opportunitiesService.updateStage(stageId, dto);
  }

  // GET /companies/:companyId/opportunities
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/opportunities')
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: OpportunityQueryDto,
  ) {
    return this.opportunitiesService.list(companyId, query);
  }

  // POST /companies/:companyId/opportunities
  @UseGuards(AuthGuard)
  @RequirePermission('crm.own', 'crm.assign', 'crm.manage')
  @Post('companies/:companyId/opportunities')
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: OpportunityDto,
  ) {
    return this.opportunitiesService.create(companyId, dto);
  }

  // GET /opportunities/:opportunityId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('opportunities/:opportunityId')
  get(@Param('opportunityId', ParseUUIDPipe) opportunityId: string) {
    return this.opportunitiesService.get(opportunityId);
  }

  // PATCH /opportunities/:opportunityId
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Patch('opportunities/:opportunityId')
  update(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: UpdateOpportunityDto,
  ) {
    return this.opportunitiesService.update(opportunityId, dto);
  }

  // POST /opportunities/:opportunityId/stage
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('opportunities/:opportunityId/stage')
  @HttpCode(200)
  moveStage(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: MoveStageDto,
  ) {
    return this.opportunitiesService.moveStage(opportunityId, dto);
  }

  // POST /opportunities/:opportunityId/won
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('opportunities/:opportunityId/won')
  @HttpCode(200)
  won(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: WonDto,
  ) {
    return this.opportunitiesService.won(opportunityId, dto);
  }

  // POST /opportunities/:opportunityId/lost
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('opportunities/:opportunityId/lost')
  @HttpCode(200)
  lost(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: LostDto,
  ) {
    return this.opportunitiesService.lost(opportunityId, dto);
  }

  // POST /opportunities/:opportunityId/reopen
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Post('opportunities/:opportunityId/reopen')
  @HttpCode(200)
  reopen(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: ReopenDto,
  ) {
    return this.opportunitiesService.reopen(opportunityId, dto);
  }

  // POST /opportunities/:opportunityId/assign
  @UseGuards(AuthGuard)
  @RequirePermission('crm.assign', 'crm.manage')
  @Post('opportunities/:opportunityId/assign')
  @HttpCode(200)
  assign(
    @Param('opportunityId', ParseUUIDPipe) opportunityId: string,
    @Body() dto: AssignDto,
  ) {
    return this.opportunitiesService.assign(opportunityId, dto);
  }

  // GET /companies/:companyId/pipeline
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/pipeline')
  pipeline(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: PipelineQueryDto,
  ) {
    return this.pipelineService.board(companyId, query);
  }

  // GET /companies/:companyId/sales-forecast
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/sales-forecast')
  forecast(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: ForecastQueryDto,
  ) {
    return this.pipelineService.forecast(companyId, query);
  }

  // GET /companies/:companyId/sales-targets
  @UseGuards(AuthGuard)
  @RequirePermission(...SALES)
  @Get('companies/:companyId/sales-targets')
  targets(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: TargetQueryDto,
  ) {
    return this.pipelineService.targets(companyId, query.month);
  }

  // PUT /companies/:companyId/sales-targets
  @UseGuards(AuthGuard)
  @RequirePermission('crm.assign', 'crm.manage')
  @Put('companies/:companyId/sales-targets')
  setTargets(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: SetTargetsDto,
  ) {
    return this.pipelineService.setTargets(companyId, dto);
  }
}
