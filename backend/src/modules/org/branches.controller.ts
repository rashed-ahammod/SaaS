/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/branches
 *   GET   /companies/:companyId/branches
 *   GET   /branches/:branchId
 *   PATCH /branches/:branchId            body includes "version"
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { BranchesService } from './branches.service.js';
import { CreateBranchDto, UpdateBranchDto } from './dto/org.dto.js';

@Controller()
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // POST /companies/:companyId/branches
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Post('companies/:companyId/branches')
  createBranch(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateBranchDto,
  ) {
    return this.branchesService.createBranch(companyId, dto);
  }

  // GET /companies/:companyId/branches
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/branches')
  listBranches(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.branchesService.listBranches(companyId);
  }

  // GET /branches/:branchId
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('branches/:branchId')
  getBranch(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.branchesService.getBranch(branchId);
  }

  // PATCH /branches/:branchId
  @UseGuards(AuthGuard)
  @RequirePermission('org.structure.manage')
  @Patch('branches/:branchId')
  updateBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.updateBranch(branchId, dto);
  }
}
