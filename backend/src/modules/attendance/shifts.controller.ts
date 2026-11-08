/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   POST  /companies/:companyId/shifts               { code, name, startTime, endTime, graceMinutes?, halfDayMinutes?, isDefault? }
 *   GET   /companies/:companyId/shifts
 *   PATCH /shifts/:shiftId                           { ..., version }
 *   POST  /companies/:companyId/shift-overrides      { name, fromDate, toDate, startTime, endTime, branchId? }  e.g. Ramadan
 *   GET   /companies/:companyId/shift-overrides
 *   POST  /employees/:employeeId/shift-assignments   { shiftId, effectiveFrom, effectiveTo? }
 *   GET   /employees/:employeeId/shift-assignments
 *   GET   /employees/:employeeId/attendance-profile
 *   PATCH /employees/:employeeId/attendance-profile  { deviceUserId?, webPunchAllowed? }
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
import {
  AssignShiftDto,
  CreateShiftDto,
  CreateShiftOverrideDto,
  UpdateAttendanceProfileDto,
  UpdateShiftDto,
} from './dto/attendance.dto.js';
import { ShiftsService } from './shifts.service.js';

@Controller()
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  // POST /companies/:companyId/shifts
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('companies/:companyId/shifts')
  createShift(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateShiftDto,
  ) {
    return this.shiftsService.createShift(companyId, dto);
  }

  // GET /companies/:companyId/shifts
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/shifts')
  listShifts(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.shiftsService.listShifts(companyId);
  }

  // PATCH /shifts/:shiftId
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Patch('shifts/:shiftId')
  updateShift(
    @Param('shiftId', ParseUUIDPipe) shiftId: string,
    @Body() dto: UpdateShiftDto,
  ) {
    return this.shiftsService.updateShift(shiftId, dto);
  }

  // POST /companies/:companyId/shift-overrides
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('companies/:companyId/shift-overrides')
  createOverride(
    @Param('companyId', ParseUUIDPipe) companyId: string,
    @Body() dto: CreateShiftOverrideDto,
  ) {
    return this.shiftsService.createOverride(companyId, dto);
  }

  // GET /companies/:companyId/shift-overrides
  @UseGuards(AuthGuard)
  @RequirePermission('org.view')
  @Get('companies/:companyId/shift-overrides')
  listOverrides(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.shiftsService.listOverrides(companyId);
  }

  // POST /employees/:employeeId/shift-assignments
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('employees/:employeeId/shift-assignments')
  assignShift(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: AssignShiftDto,
  ) {
    return this.shiftsService.assignShift(employeeId, dto);
  }

  // GET /employees/:employeeId/shift-assignments
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/shift-assignments')
  listAssignments(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.shiftsService.listAssignments(employeeId);
  }

  // GET /employees/:employeeId/attendance-profile
  @UseGuards(AuthGuard)
  @RequirePermission('employee.view')
  @Get('employees/:employeeId/attendance-profile')
  getProfile(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.shiftsService.getProfile(employeeId);
  }

  // PATCH /employees/:employeeId/attendance-profile
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Patch('employees/:employeeId/attendance-profile')
  updateProfile(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: UpdateAttendanceProfileDto,
  ) {
    return this.shiftsService.updateProfile(employeeId, dto);
  }
}
