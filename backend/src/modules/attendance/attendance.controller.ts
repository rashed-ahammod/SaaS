/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   GET  /me/attendance?from=&to=                         my days
 *   GET  /employees/:employeeId/attendance?from=&to=      an employee's days (own or in scope)
 *   GET  /attendance/days?date=&companyId=&departmentId=&status=   a team on one date
 *   GET  /attendance/summary?companyId=&period=YYYY-MM    monthly totals per employee (payroll input)
 *   GET  /attendance/summary.csv?companyId=&period=       the same month as a spreadsheet (muster roll)
 *   GET  /attendance/adjustments?companyId=               changes to locked days, for the next payroll
 *   POST /attendance/recompute                            { companyId, from, to }
 *   POST /attendance/locks                                { companyId, period }   monthly lock before payroll
 *   GET  /attendance/locks?companyId=
 *   GET  /attendance/punch-review?companyId=&from=&to=    suspicious phone / web punches (HR, Admin; Dept Head: dept)
 *
 *   POST /employees/:employeeId/attendance-corrections    { date, inTime?, outTime?, reason }  -> approval (Dept Head)
 *   GET  /employees/:employeeId/attendance-corrections
 *   POST /employees/:employeeId/overtime-requests         { date, minutes?, reason? }          -> approval (Dept Head)
 *   GET  /employees/:employeeId/overtime-requests
 */
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import { AttendanceRequestsService } from './attendance-requests.service.js';
import { AttendanceService } from './attendance.service.js';
import { PunchReviewService } from './punch-review.service.js';
import {
  CompanyQueryDto,
  CreateCorrectionDto,
  CreateOvertimeRequestDto,
  DateRangeQueryDto,
  DaysQueryDto,
  LockMonthDto,
  PeriodQueryDto,
  PunchReviewQueryDto,
  RecomputeDto,
} from './dto/attendance.dto.js';

@Controller()
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly requestsService: AttendanceRequestsService,
    private readonly punchReviewService: PunchReviewService,
  ) {}

  // GET /me/attendance?from=&to=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own')
  @Get('me/attendance')
  ownDays(@Query() query: DateRangeQueryDto) {
    return this.attendanceService.ownDays(query.from, query.to);
  }

  // GET /employees/:employeeId/attendance?from=&to=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view', 'attendance.own')
  @Get('employees/:employeeId/attendance')
  employeeDays(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.attendanceService.employeeDays(
      employeeId,
      query.from,
      query.to,
    );
  }

  // GET /attendance/days?date=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/days')
  teamDay(@Query() query: DaysQueryDto) {
    return this.attendanceService.teamDay(query);
  }

  // GET /attendance/summary?companyId=&period=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/summary')
  monthlySummary(@Query() query: PeriodQueryDto) {
    return this.attendanceService.monthlySummary(query);
  }

  // GET /attendance/summary.csv?companyId=&period=   the month's sheet, for payroll checking and inspections
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/summary.csv')
  async exportMonthlySummary(@Query() query: PeriodQueryDto) {
    const file = await this.attendanceService.exportMonthlySummaryCsv(query);
    return new StreamableFile(file.content, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${file.fileName}"`,
    });
  }

  // GET /attendance/adjustments?companyId=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/adjustments')
  adjustments(@Query() query: CompanyQueryDto) {
    return this.attendanceService.adjustments(query.companyId);
  }

  // POST /attendance/recompute
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('attendance/recompute')
  recompute(@Body() dto: RecomputeDto) {
    return this.attendanceService.recompute(dto);
  }

  // POST /attendance/locks
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.manage')
  @Post('attendance/locks')
  lockMonth(@Body() dto: LockMonthDto) {
    return this.attendanceService.lockMonth(dto);
  }

  // GET /attendance/locks?companyId=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/locks')
  listLocks(@Query() query: CompanyQueryDto) {
    return this.attendanceService.listLocks(query.companyId);
  }

  // GET /attendance/punch-review?companyId=&from=&to=
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.view')
  @Get('attendance/punch-review')
  punchReview(@Query() query: PunchReviewQueryDto) {
    return this.punchReviewService.review(
      query.companyId,
      query.from,
      query.to,
    );
  }

  // POST /employees/:employeeId/attendance-corrections
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own', 'attendance.manage')
  @Post('employees/:employeeId/attendance-corrections')
  requestCorrection(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateCorrectionDto,
  ) {
    return this.requestsService.requestCorrection(employeeId, dto);
  }

  // GET /employees/:employeeId/attendance-corrections
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own', 'attendance.view')
  @Get('employees/:employeeId/attendance-corrections')
  listCorrections(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.requestsService.listCorrections(employeeId);
  }

  // POST /employees/:employeeId/overtime-requests
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own', 'attendance.manage')
  @Post('employees/:employeeId/overtime-requests')
  requestOvertime(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: CreateOvertimeRequestDto,
  ) {
    return this.requestsService.requestOvertime(employeeId, dto);
  }

  // GET /employees/:employeeId/overtime-requests
  @UseGuards(AuthGuard)
  @RequirePermission('attendance.own', 'attendance.view')
  @Get('employees/:employeeId/overtime-requests')
  listOvertime(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.requestsService.listOvertime(employeeId);
  }
}
