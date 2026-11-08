/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET   /companies/:companyId/leave-policy
 *   PUT   /companies/:companyId/leave-policy             { leaveYearStart?, sandwichRule?, teamAbsenceWarnPct?, maxBackdatedDays? }
 *   POST  /companies/:companyId/leave-types               { code, nameEn, accrualMethod, entitlementDays | entitlementRuleKey, ... }
 *   POST  /companies/:companyId/leave-types/defaults      Bangladesh defaults: CL, SL, EL, ML, LWP (from the rule pack)
 *   GET   /companies/:companyId/leave-types
 *   PATCH /leave-types/:leaveTypeId                       { ..., version }
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
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  CreateLeaveTypeDto,
  LeavePolicyDto,
  UpdateLeaveTypeDto,
} from './dto/leave.dto.js';
import { LeaveTypesService } from './leave-types.service.js';

@Controller()
export class LeaveTypesController {
  constructor(private readonly leaveTypesService: LeaveTypesService) {}

  // GET /companies/:companyId/leave-policy
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/leave-policy')
  getPolicy(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.leaveTypesService.getPolicy(companyId);
  }

  // PUT /companies/:companyId/leave-policy
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Put('companies/:companyId/leave-policy')
  savePolicy(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: LeavePolicyDto,
  ) {
    return this.leaveTypesService.savePolicy(companyId, dto);
  }

  // POST /companies/:companyId/leave-types
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Post('companies/:companyId/leave-types')
  createType(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateLeaveTypeDto,
  ) {
    return this.leaveTypesService.createType(companyId, dto);
  }

  // POST /companies/:companyId/leave-types/defaults
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Post('companies/:companyId/leave-types/defaults')
  createDefaults(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.leaveTypesService.createDefaults(companyId);
  }

  // GET /companies/:companyId/leave-types
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/leave-types')
  listTypes(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.leaveTypesService.listTypes(companyId);
  }

  // PATCH /leave-types/:leaveTypeId
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Patch('leave-types/:leaveTypeId')
  updateType(
    @Param('leaveTypeId', ParseUUIDPipe) leaveTypeId: string,
    @Body() dto: UpdateLeaveTypeDto,
  ) {
    return this.leaveTypesService.updateType(leaveTypeId, dto);
  }
}
