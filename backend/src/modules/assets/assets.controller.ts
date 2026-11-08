/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/asset-classes
 *   POST  /companies/:companyId/asset-classes                 Admin  { code, name, assetAccountId, method, usefulLifeMonths? | annualRatePercent?, ... }
 *   POST  /companies/:companyId/asset-classes/defaults        Admin  furniture, office equipment, computers, vehicles
 *   PATCH /asset-classes/:classId                             Admin  { version, ... }  (method and life only before any depreciation)
 *   POST  /companies/:companyId/assets                        Admin  register  { classId, name, inServiceDate, cost, ... }
 *   GET   /companies/:companyId/assets?state=&classId=&departmentId=&employeeId=&q=
 *   GET   /assets/:assetId                                    with assignments, maintenance, depreciation posted
 *   GET   /assets/:assetId/schedule                           the whole depreciation schedule
 *   PATCH /assets/:assetId                                    Admin  { version, name?, serialNo?, departmentId?, location?, note? }
 *   POST  /assets/:assetId/assign                             Admin  { employeeId, assignedOn, expectedReturn?, note? }
 *   POST  /assets/:assetId/return                             Admin  { returnedOn, condition: good|damaged|lost, note? }
 *   POST  /assets/:assetId/maintenance                        Admin  { doneOn, kind, description, vendorId?, cost?, nextDue? }
 *   POST  /assets/:assetId/dispose                            Admin  { disposedOn, method: sale|scrap|write_off, proceeds?, receivedIntoAccountId?, note }
 *   GET   /me/assets                                          the employee's assets (app)
 *   POST  /me/assets/:assignmentId/acknowledge                the employee confirms receipt
 *   GET   /companies/:companyId/depreciation-runs
 *   GET   /companies/:companyId/depreciation-runs/preview?period=2026-10   Accounts
 *   POST  /companies/:companyId/depreciation-runs             Accounts  { period }
 *   GET   /depreciation-runs/:runId
 *   POST  /depreciation-runs/:runId/reverse                   Accounts  { reason }  (latest run; the checker approves)
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
import { AssetsService } from './assets.service.js';
import {
  AssetClassDto,
  AssetQueryDto,
  AssignAssetDto,
  CreateAssetDto,
  DepreciationRunDto,
  DisposeAssetDto,
  MaintenanceDto,
  ReasonDto,
  ReturnAssetDto,
  UpdateAssetDto,
} from './dto/assets.dto.js';

const READERS = ['assets.view', 'assets.manage', 'assets.depreciate'] as const;

@Controller()
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  // GET /companies/:companyId/asset-classes
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/asset-classes')
  listClasses(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.assetsService.listClasses(companyId);
  }

  // POST /companies/:companyId/asset-classes
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('companies/:companyId/asset-classes')
  createClass(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: AssetClassDto,
  ) {
    return this.assetsService.createClass(companyId, dto);
  }

  // POST /companies/:companyId/asset-classes/defaults
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('companies/:companyId/asset-classes/defaults')
  defaultClasses(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.assetsService.createDefaultClasses(companyId);
  }

  // PATCH /asset-classes/:classId
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Patch('asset-classes/:classId')
  updateClass(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Body() dto: Partial<AssetClassDto> & { version: number },
  ) {
    return this.assetsService.updateClass(classId, dto);
  }

  // POST /companies/:companyId/assets
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('companies/:companyId/assets')
  create(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateAssetDto,
  ) {
    return this.assetsService.create(companyId, dto);
  }

  // GET /companies/:companyId/assets
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/assets')
  list(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: AssetQueryDto,
  ) {
    return this.assetsService.list(companyId, query);
  }

  // GET /assets/:assetId
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('assets/:assetId')
  get(@Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.assetsService.get(assetId);
  }

  // GET /assets/:assetId/schedule
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('assets/:assetId/schedule')
  schedule(@Param('assetId', ParseUUIDPipe) assetId: string) {
    return this.assetsService.schedule(assetId);
  }

  // PATCH /assets/:assetId
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Patch('assets/:assetId')
  update(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: UpdateAssetDto,
  ) {
    return this.assetsService.update(assetId, dto);
  }

  // POST /assets/:assetId/assign
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('assets/:assetId/assign')
  @HttpCode(200)
  assign(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: AssignAssetDto,
  ) {
    return this.assetsService.assign(assetId, dto);
  }

  // POST /assets/:assetId/return
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('assets/:assetId/return')
  @HttpCode(200)
  takeBack(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: ReturnAssetDto,
  ) {
    return this.assetsService.takeBack(assetId, dto);
  }

  // POST /assets/:assetId/maintenance
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('assets/:assetId/maintenance')
  maintenance(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: MaintenanceDto,
  ) {
    return this.assetsService.addMaintenance(assetId, dto);
  }

  // POST /assets/:assetId/dispose
  @UseGuards(AuthGuard)
  @RequirePermission('assets.manage')
  @Post('assets/:assetId/dispose')
  @HttpCode(200)
  dispose(
    @Param('assetId', ParseUUIDPipe) assetId: string,
    @Body() dto: DisposeAssetDto,
  ) {
    return this.assetsService.dispose(assetId, dto);
  }

  // GET /me/assets
  @UseGuards(AuthGuard)
  @RequirePermission('assets.own')
  @Get('me/assets')
  myAssets() {
    return this.assetsService.myAssets();
  }

  // POST /me/assets/:assignmentId/acknowledge
  @UseGuards(AuthGuard)
  @RequirePermission('assets.own')
  @Post('me/assets/:assignmentId/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('assignmentId', ParseUUIDPipe) assignmentId: string) {
    return this.assetsService.acknowledge(assignmentId);
  }

  // GET /companies/:companyId/depreciation-runs
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('companies/:companyId/depreciation-runs')
  runs(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.assetsService.listRuns(companyId);
  }

  // GET /companies/:companyId/depreciation-runs/preview?period=2026-10
  @UseGuards(AuthGuard)
  @RequirePermission('assets.depreciate')
  @Get('companies/:companyId/depreciation-runs/preview')
  preview(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Query() query: DepreciationRunDto,
  ) {
    return this.assetsService.previewRun(companyId, query.period);
  }

  // POST /companies/:companyId/depreciation-runs
  @UseGuards(AuthGuard)
  @RequirePermission('assets.depreciate')
  @Post('companies/:companyId/depreciation-runs')
  run(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: DepreciationRunDto,
  ) {
    return this.assetsService.runDepreciation(companyId, dto.period);
  }

  // GET /depreciation-runs/:runId
  @UseGuards(AuthGuard)
  @RequirePermission(...READERS)
  @Get('depreciation-runs/:runId')
  getRun(@Param('runId', ParseUUIDPipe) runId: string) {
    return this.assetsService.getRun(runId);
  }

  // POST /depreciation-runs/:runId/reverse
  @UseGuards(AuthGuard)
  @RequirePermission('assets.depreciate')
  @Post('depreciation-runs/:runId/reverse')
  @HttpCode(200)
  reverse(
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() dto: ReasonDto,
  ) {
    return this.assetsService.reverseRun(runId, dto.reason);
  }
}
