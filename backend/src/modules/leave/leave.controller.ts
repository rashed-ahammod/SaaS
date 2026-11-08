/**
 * Routes (all need  Authorization: Bearer <token>; writes need Idempotency-Key):
 *
 *   Employee / HR:
 *     POST /employees/:employeeId/leave-requests/preview   { leaveTypeId, fromDate, toDate, halfDay?, reason?, documentId? }  nothing saved
 *     POST /employees/:employeeId/leave-documents          multipart "file": certificate (photo / PDF) -> { id } to send as documentId
 *     POST /employees/:employeeId/leave-requests           same body -> approval
 *     GET  /employees/:employeeId/leave-requests
 *     GET  /me/leave-requests
 *     GET  /leave/requests/:requestId
 *     POST /leave/requests/:requestId/cancel               { reason }  pending, returned, or approved and not started
 *     POST /leave/requests/:requestId/resubmit             same body as apply (after "return for correction")
 *
 *   Balances:
 *     GET  /me/leave-balances?asOf=
 *     GET  /employees/:employeeId/leave-balances?asOf=
 *     GET  /employees/:employeeId/leave-ledger?leaveTypeId=   every entry with running balance
 *     POST /employees/:employeeId/leave-ledger               HR: { leaveTypeId, kind: opening|adjustment, days, entryDate, note }
 *
 *   Approvers / HR:
 *     GET  /leave/team-calendar?departmentId=&from=&to=
 *     POST /leave/accruals/run                              { companyId, asOf? }
 *     POST /leave/year-end                                  { companyId, leaveYear }
 *     GET  /leave/encashments?companyId=                    waiting for payroll
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MSG } from '../../platform/i18n/messages.js';
import { SkipIdempotency } from '../../platform/idempotency/idempotency.interceptor.js';
import { AccessService } from '../identity/access/access.service.js';
import { RequirePermission } from '../identity/access/decorators.js';
import { AuthGuard } from '../identity/auth.guard.js';
import {
  ApplyLeaveDto,
  AsOfQueryDto,
  CancelLeaveDto,
  CompanyQueryDto,
  LedgerEntryDto,
  LedgerQueryDto,
  RunAccrualsDto,
  TeamCalendarQueryDto,
  YearEndDto,
} from './dto/leave.dto.js';
import { MAX_DOCUMENT_BYTES } from '../employees/documents.service.js';
import { LeaveLedgerService } from './leave-ledger.service.js';
import { LeaveRequestsService } from './leave-requests.service.js';

@Controller()
export class LeaveController {
  constructor(
    private readonly requestsService: LeaveRequestsService,
    private readonly ledgerService: LeaveLedgerService,
    private readonly access: AccessService,
  ) {}

  // POST /employees/:employeeId/leave-requests/preview   (nothing is saved, so no Idempotency-Key needed)
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own', 'leave.manage')
  @SkipIdempotency()
  @Post('employees/:employeeId/leave-requests/preview')
  @HttpCode(200)
  preview(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ApplyLeaveDto,
  ) {
    return this.requestsService.preview(employeeId, dto);
  }

  // POST /employees/:employeeId/leave-documents   multipart "file": a doctor's certificate etc. (photo / PDF)
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own', 'leave.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
    }),
  )
  @Post('employees/:employeeId/leave-documents')
  uploadDocument(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.requestsService.uploadDocument(employeeId, file);
  }

  // POST /employees/:employeeId/leave-requests
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own', 'leave.manage')
  @Post('employees/:employeeId/leave-requests')
  apply(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: ApplyLeaveDto,
  ) {
    return this.requestsService.apply(employeeId, dto);
  }

  // GET /employees/:employeeId/leave-requests
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view', 'leave.apply_own')
  @Get('employees/:employeeId/leave-requests')
  listForEmployee(@Param('employeeId', ParseUUIDPipe) employeeId: string) {
    return this.requestsService.listForEmployee(employeeId);
  }

  // GET /me/leave-requests
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own')
  @Get('me/leave-requests')
  listOwn() {
    return this.requestsService.listForEmployee(this.ownEmployeeId());
  }

  // GET /leave/requests/:requestId
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view', 'leave.apply_own')
  @Get('leave/requests/:requestId')
  getRequest(@Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.requestsService.getRequest(requestId);
  }

  // POST /leave/requests/:requestId/cancel
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own', 'leave.manage')
  @Post('leave/requests/:requestId/cancel')
  @HttpCode(200)
  cancel(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: CancelLeaveDto,
  ) {
    return this.requestsService.cancel(requestId, dto);
  }

  // POST /leave/requests/:requestId/resubmit
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own', 'leave.manage')
  @Post('leave/requests/:requestId/resubmit')
  @HttpCode(200)
  resubmit(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: ApplyLeaveDto,
  ) {
    return this.requestsService.resubmit(requestId, dto);
  }

  // GET /me/leave-balances?asOf=
  @UseGuards(AuthGuard)
  @RequirePermission('leave.apply_own')
  @Get('me/leave-balances')
  ownBalances(@Query() query: AsOfQueryDto) {
    return this.ledgerService.balances(this.ownEmployeeId(), query.asOf);
  }

  // GET /employees/:employeeId/leave-balances?asOf=
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view', 'leave.apply_own')
  @Get('employees/:employeeId/leave-balances')
  balances(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: AsOfQueryDto,
  ) {
    return this.ledgerService.balances(employeeId, query.asOf);
  }

  // GET /employees/:employeeId/leave-ledger?leaveTypeId=
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view', 'leave.apply_own')
  @Get('employees/:employeeId/leave-ledger')
  statement(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.ledgerService.statement(employeeId, query.leaveTypeId);
  }

  // POST /employees/:employeeId/leave-ledger
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Post('employees/:employeeId/leave-ledger')
  addManualEntry(
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() dto: LedgerEntryDto,
  ) {
    return this.ledgerService.addManualEntry(employeeId, dto);
  }

  // GET /leave/team-calendar?departmentId=&from=&to=
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view')
  @Get('leave/team-calendar')
  teamCalendar(@Query() query: TeamCalendarQueryDto) {
    return this.requestsService.teamCalendar(query);
  }

  // POST /leave/accruals/run
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Post('leave/accruals/run')
  runAccruals(@Body() dto: RunAccrualsDto) {
    return this.ledgerService.runAccruals(dto.companyId, dto.asOf);
  }

  // POST /leave/year-end
  @UseGuards(AuthGuard)
  @RequirePermission('leave.manage')
  @Post('leave/year-end')
  runYearEnd(@Body() dto: YearEndDto) {
    return this.ledgerService.runYearEnd(dto.companyId, dto.leaveYear);
  }

  // GET /leave/encashments?companyId=
  @UseGuards(AuthGuard)
  @RequirePermission('leave.view')
  @Get('leave/encashments')
  encashments(@Query() query: CompanyQueryDto) {
    return this.ledgerService.encashments(query.companyId);
  }

  /** The login must be linked to an employee record. */
  private ownEmployeeId(): string {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    return employeeId;
  }
}
