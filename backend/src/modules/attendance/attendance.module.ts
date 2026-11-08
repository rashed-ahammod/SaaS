import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { CalendarModule } from '../calendar/calendar.module.js';
import { EmployeesModule } from '../employees/employees.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { OrgModule } from '../org/org.module.js';
import { AttendanceComputeService } from './attendance-compute.service.js';
import { AttendanceRequestsService } from './attendance-requests.service.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';
import { ConsentsController } from './consents.controller.js';
import { ConsentsService } from './consents.service.js';
import { PunchesController } from './punches.controller.js';
import { PunchReviewService } from './punch-review.service.js';
import { PunchesService } from './punches.service.js';
import { ShiftsController } from './shifts.controller.js';
import { ShiftsService } from './shifts.service.js';

/**
 * Attendance (WP4): shifts and overrides, punches (device / mobile / web),
 * daily status, corrections and overtime (approval engine), monthly lock.
 * Owns tables: shifts, shift_assignments, shift_overrides, attendance_profiles,
 *   employee_devices, attendance_devices, attendance_punches, attendance_days,
 *   attendance_adjustments, attendance_locks, attendance_corrections, overtime_requests,
 *   employee_consents (WP12: consent for biometric / location / selfie data).
 * Leave (WP5) plugs in through AttendanceComputeService.setLeaveSource().
 */
@Module({
  imports: [
    IdentityModule,
    OrgModule,
    EmployeesModule,
    CalendarModule,
    ApprovalsModule,
  ],
  controllers: [
    AttendanceController,
    PunchesController,
    ShiftsController,
    ConsentsController,
  ],
  providers: [
    AttendanceComputeService,
    AttendanceService,
    AttendanceRequestsService,
    PunchesService,
    PunchReviewService,
    ShiftsService,
    ConsentsService,
  ],
  exports: [AttendanceComputeService, AttendanceService, ConsentsService],
})
export class AttendanceModule {}
