/**
 * Request bodies and query strings for the attendance routes.
 * Times of day are local Dhaka time "HH:MM"; instants are ISO-8601 with offset.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const TIME_MSG = { message: 'time must be HH:MM (24-hour, Dhaka time)' };
const upper = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const STATUSES = [
  'present',
  'late',
  'half_day',
  'absent',
  'on_leave',
  'holiday',
  'weekend',
  'missing_punch',
] as const;

// ------------------------------------------------------------------- shifts --

/** POST /companies/:companyId/shifts  { "code": "GEN", "name": "General", "startTime": "09:00", "endTime": "18:00" } */
export class CreateShiftDto {
  @upper()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Matches(TIME, TIME_MSG)
  startTime: string;

  /** Earlier than startTime = ends the next day (night shift). */
  @Matches(TIME, TIME_MSG)
  endTime: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  graceMinutes?: number;

  /** Worked less than this = Half-day. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  halfDayMinutes?: number;

  /** Used for employees without a shift assignment. */
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateShiftDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @Matches(TIME, TIME_MSG)
  startTime?: string;

  @IsOptional()
  @Matches(TIME, TIME_MSG)
  endTime?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  graceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  halfDayMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** POST /companies/:companyId/shift-overrides — e.g. Ramadan hours. */
export class CreateShiftOverrideDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Leave out for every branch of the company. */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsBusinessDate()
  fromDate: string;

  /** Inclusive. */
  @IsBusinessDate()
  toDate: string;

  @Matches(TIME, TIME_MSG)
  startTime: string;

  @Matches(TIME, TIME_MSG)
  endTime: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(180)
  graceMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  halfDayMinutes?: number;
}

/** POST /employees/:employeeId/shift-assignments  { "shiftId": "...", "effectiveFrom": "2026-11-01" } */
export class AssignShiftDto {
  @IsUUID()
  shiftId: string;

  @IsBusinessDate()
  effectiveFrom: string;

  /** Exclusive end; leave out for "until further notice". */
  @IsOptional()
  @IsBusinessDate()
  effectiveTo?: string;
}

/** PATCH /employees/:employeeId/attendance-profile */
export class UpdateAttendanceProfileDto {
  /** User number of the employee on the office biometric devices; null = remove. */
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @Matches(/^[A-Za-z0-9]{1,20}$/)
  deviceUserId?: string | null;

  /** "Approved remote staff" may punch from the web (spec §6.2). */
  @IsOptional()
  @IsBoolean()
  webPunchAllowed?: boolean;
}

// ------------------------------------------------------------ devices, punches --

/** POST /me/devices  { "deviceId": "<install id from the app>", "name": "Samsung Galaxy A15" } */
export class RegisterDeviceDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{8,200}$/, {
    message: 'deviceId must be the app install id (8-200 characters)',
  })
  deviceId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

export class ReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /me/punches/mobile — the server records its own time, never the phone's. */
export class MobilePunchDto {
  @IsString()
  @MinLength(8)
  @MaxLength(200)
  deviceId: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  /** GPS accuracy in metres as the phone reports it (coords.accuracy); weak readings are refused. */
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100000)
  accuracy: number;
}

export class DevicePunchDto {
  /** User number on the device (attendance profile deviceUserId). */
  @IsString()
  @Matches(/^[A-Za-z0-9]{1,20}$/)
  deviceUserId: string;

  /** When the punch happened, by the device clock, ISO with offset (e.g. 2026-10-14T09:02:11+06:00). */
  @IsDateString()
  punchedAt: string;
}

/**
 * POST /attendance/device-batches   (Authorization: ServiceKey <id>.<secret>, Idempotency-Key)
 * Sent by the office sync agent; may contain old punches after an internet outage.
 */
export class DeviceBatchDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._-]{3,100}$/)
  deviceSerial: string;

  @IsUUID()
  branchId: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  /** The device clock at sending time, to measure clock drift. */
  @IsDateString()
  deviceTime: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => DevicePunchDto)
  punches: DevicePunchDto[];
}

// ------------------------------------------------------------- requests --

/** POST /employees/:employeeId/attendance-corrections  { "date": "2026-10-12", "inTime": "09:05", "outTime": "18:10", "reason": "Forgot to punch" } */
export class CreateCorrectionDto {
  @IsBusinessDate()
  date: string;

  @ValidateIf((o) => !o.outTime)
  @Matches(TIME, TIME_MSG)
  inTime?: string;

  /** Earlier than inTime = next day (night shift). */
  @ValidateIf((o) => !o.inTime)
  @Matches(TIME, TIME_MSG)
  outTime?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** POST /employees/:employeeId/overtime-requests  { "date": "2026-10-12", "minutes": 90, "reason": "Year-end stock count" } */
export class CreateOvertimeRequestDto {
  @IsBusinessDate()
  date: string;

  /** Leave out to claim all eligible overtime of the day. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  minutes?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ------------------------------------------------------------- HR --

export class DateRangeQueryDto {
  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** GET /attendance/punch-review?companyId=&from=&to= */
export class PunchReviewQueryDto extends DateRangeQueryDto {
  @IsUUID()
  companyId: string;
}

/** POST /attendance/recompute  { "companyId": "...", "from": "2026-10-01", "to": "2026-10-14" } */
export class RecomputeDto {
  @IsUUID()
  companyId: string;

  @IsBusinessDate()
  from: string;

  @IsBusinessDate()
  to: string;
}

/** POST /attendance/locks  { "companyId": "...", "period": "2026-10" } */
export class LockMonthDto {
  @IsUUID()
  companyId: string;

  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period: string;
}

/** GET /attendance/days?date=2026-10-14&companyId=&departmentId=&status= */
export class DaysQueryDto {
  @IsBusinessDate()
  date: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

/** GET /attendance/summary?companyId=&period=2026-10 */
export class PeriodQueryDto {
  @IsUUID()
  companyId: string;

  @Matches(/^[0-9]{4}-(0[1-9]|1[0-2])$/, { message: 'period must be YYYY-MM' })
  period: string;
}

export class CompanyQueryDto {
  @IsUUID()
  companyId: string;
}

export class DeviceStatusQueryDto {
  @IsOptional()
  @IsIn(['pending', 'active', 'revoked'])
  status?: 'pending' | 'active' | 'revoked';
}

// ------------------------------------------------------------ consent (WP12) --

/** POST /me/consents   { "purpose": "location_attendance", "granted": true } */
export class GiveConsentDto {
  @IsIn(['biometric_attendance', 'location_attendance', 'selfie_attendance'])
  purpose: 'biometric_attendance' | 'location_attendance' | 'selfie_attendance';

  @IsBoolean()
  granted: boolean;
}

/** POST /employees/:employeeId/consents   { "purpose": "biometric_attendance", "granted": true, "documentId": "<scanned form>" } */
export class RecordConsentDto extends GiveConsentDto {
  @IsOptional()
  @IsUUID()
  documentId?: string;
}
