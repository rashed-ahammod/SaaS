/**
 * Request bodies for the organization routes.
 *
 * Conventions:
 *   - Create DTOs: required fields have no @IsOptional.
 *   - Update DTOs: every field optional; send only what changes, plus `version`.
 *     For a clearable field (e.g. parentId), `null` means "clear it" and leaving
 *     it out means "keep it".
 *   - Codes are trimmed and upper-cased automatically ("hr" -> "HR").
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { VersionedDto } from '../../../platform/http/common.dto.js';

const upperTrim = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );
const CODE = /^[A-Z0-9-]{1,20}$/;
const CODE_MSG = {
  message: 'code may contain only letters, digits and "-" (max 20)',
};
const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;
const AMOUNT_MSG = {
  message:
    'amount must be a number with up to 2 decimals, sent as a string, e.g. "25000.00"',
};
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

/** Allows null (= clear) but validates any other value. */
const NullableUuid = () => ValidateIf((_, v) => v !== null && v !== undefined);

// ------------------------------------------------------------------ company --

export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  shortName?: string;

  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'tin must be 12 digits' })
  tin?: string;

  @IsOptional()
  @Matches(/^[0-9-]{9,15}$/, { message: 'bin must be 9-15 digits' })
  bin?: string;

  /** Month and day the fiscal year starts, e.g. "07-01" (July-June, Bangladesh default). */
  @IsOptional()
  @Matches(/^(0[1-9]|1[0-2])-01$/, {
    message: 'fiscalYearStart must look like "07-01"',
  })
  fiscalYearStart?: string;

  /** Employee codes become <prefix>-00001, <prefix>-00002 ... */
  @IsOptional()
  @upperTrim()
  @Matches(/^[A-Z0-9]{1,10}$/, {
    message: 'employeeCodePrefix: letters/digits, max 10',
  })
  employeeCodePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  probationMonths?: number;
}

export class UpdateCompanyDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  legalName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  shortName?: string;

  @IsOptional()
  @Matches(/^[0-9]{12}$/, { message: 'tin must be 12 digits' })
  tin?: string;

  @IsOptional()
  @Matches(/^[0-9-]{9,15}$/, { message: 'bin must be 9-15 digits' })
  bin?: string;

  @IsOptional()
  @Matches(/^(0[1-9]|1[0-2])-01$/, {
    message: 'fiscalYearStart must look like "07-01"',
  })
  fiscalYearStart?: string;

  @IsOptional()
  @upperTrim()
  @Matches(/^[A-Z0-9]{1,10}$/, {
    message: 'employeeCodePrefix: letters/digits, max 10',
  })
  employeeCodePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  probationMonths?: number;

  /** Attendance corrections an employee may request per month. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  attendanceCorrectionLimit?: number;

  /** Late penalty (N lates = 1 day): keep off until legal review (spec §6.2). */
  @IsOptional()
  @IsBoolean()
  latePenaltyEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  latePenaltyEvery?: number;

  /** Notice the employee must give when resigning, in days (placeholder default 60; verify). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  noticeDaysResignation?: number;

  /** Notice the employer must give when terminating, in days (placeholder default 120; verify). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  noticeDaysTermination?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(80)
  retirementAge?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ------------------------------------------------------------------- branch --

export class CreateBranchDto {
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  /** Weekly off days, e.g. ["FRI"] or ["FRI","SAT"]. Default ["FRI"]. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(WEEKDAYS, { each: true })
  weekendDays?: (typeof WEEKDAYS)[number][];

  /** Geo-fence for mobile punches: send all three or none. */
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  geoLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  geoLng?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  geoRadiusM?: number;

  /** Holiday calendar of this branch (GET /companies/:id/holiday-calendars); null = none. */
  @NullableUuid()
  @IsUUID()
  holidayCalendarId?: string | null;
}

export class UpdateBranchDto extends VersionedDto {
  @IsOptional()
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(WEEKDAYS, { each: true })
  weekendDays?: (typeof WEEKDAYS)[number][];

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  geoLat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  geoLng?: number | null;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(5000)
  geoRadiusM?: number | null;

  /** Holiday calendar of this branch (GET /companies/:id/holiday-calendars); null = none. */
  @NullableUuid()
  @IsUUID()
  holidayCalendarId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// --------------------------------------------------------------- department --

export class CreateDepartmentDto {
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  /** Leave out for a top-level department. */
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  costCentreCode?: string;
}

export class UpdateDepartmentDto extends VersionedDto {
  @IsOptional()
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  costCentreCode?: string;

  /** Move under another department; null = make top-level. */
  @NullableUuid()
  @IsUUID()
  parentId?: string | null;

  /** Department Head (an employee of the same company); null = no head. */
  @NullableUuid()
  @IsUUID()
  headEmployeeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------- designation --

export class CreateDesignationDto {
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;
}

export class UpdateDesignationDto extends VersionedDto {
  @IsOptional()
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------------- grade --

export class CreateGradeDto {
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  /** Higher = more senior. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  rank?: number;

  /** Overtime is paid only for OT-eligible grades. */
  @IsOptional()
  @IsBoolean()
  otEligible?: boolean;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  salaryMin?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  salaryMax?: string;
}

export class UpdateGradeDto extends VersionedDto {
  @IsOptional()
  @upperTrim()
  @Matches(CODE, CODE_MSG)
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  rank?: number;

  @IsOptional()
  @IsBoolean()
  otEligible?: boolean;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  salaryMin?: string;

  @IsOptional()
  @Matches(AMOUNT, AMOUNT_MSG)
  salaryMax?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
