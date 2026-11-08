/**
 * Request bodies and query strings for the employee routes.
 * Update DTOs: send only the fields that change, plus `version`.
 */
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  IsBusinessDate,
  PageQueryDto,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const PHONE = /^\+?[0-9]{8,15}$/;
const PHONE_MSG = {
  message:
    'phone must be 8-15 digits, optionally starting with +, e.g. 01712345678',
};
const NID = /^([0-9]{10}|[0-9]{13}|[0-9]{17})$/;
const NID_MSG = { message: 'nid must have 10, 13 or 17 digits' };
const TIN = /^[0-9]{12}$/;
const TIN_MSG = { message: 'tin must have 12 digits' };
const GENDERS = ['male', 'female', 'other'] as const;
const STATUSES = [
  'draft',
  'probation',
  'active',
  'notice',
  'separated',
] as const;

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const lower = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
/** Allows null (= clear) but validates any other value. */
const NullableField = () => ValidateIf((_, v) => v !== null && v !== undefined);

export class CreateEmployeeDto {
  @IsUUID()
  companyId: string;

  /** Leave out to get the next automatic code (e.g. DTL-00042). */
  @IsOptional()
  @trim()
  @Matches(/^[A-Za-z0-9-]{1,30}$/, {
    message: 'employeeCode: letters, digits, "-" (max 30)',
  })
  employeeCode?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullNameEn: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  fullNameBn?: string;

  @IsOptional()
  @IsBusinessDate()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  /** Stored encrypted; responses show it masked. */
  @IsOptional()
  @Matches(NID, NID_MSG)
  nid?: string;

  @IsOptional()
  @Matches(TIN, TIN_MSG)
  tin?: string;

  @IsOptional()
  @lower()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  presentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  emergencyContactPhone?: string;

  /** Decides festival bonus timing (spec §6.4), e.g. "eid", "puja". */
  @IsOptional()
  @lower()
  @Matches(/^[a-z_]{1,30}$/, {
    message: 'festivalGroup: lower-case letters and _',
  })
  festivalGroup?: string;

  @IsBusinessDate()
  joinDate: string;

  // --- first placement (becomes the "joining" job event) ---

  @IsUUID()
  branchId: string;

  @IsUUID()
  departmentId: string;

  @IsUUID()
  designationId: string;

  @IsUUID()
  gradeId: string;

  /** Approves leave, attendance and claims. Leave out only for the top of the organization. */
  @IsOptional()
  @IsUUID()
  lineManagerId?: string;

  /** Performance input only. */
  @IsOptional()
  @IsUUID()
  functionalManagerId?: string;
}

export class UpdateEmployeeDto extends VersionedDto {
  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  fullNameEn?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  fullNameBn?: string;

  @IsOptional()
  @IsBusinessDate()
  dateOfBirth?: string;

  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number];

  @IsOptional()
  @Matches(NID, NID_MSG)
  nid?: string;

  @IsOptional()
  @Matches(TIN, TIN_MSG)
  tin?: string;

  @IsOptional()
  @lower()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  presentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  permanentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  emergencyContactPhone?: string;

  @NullableField()
  @lower()
  @Matches(/^[a-z_]{1,30}$/, {
    message: 'festivalGroup: lower-case letters and _',
  })
  festivalGroup?: string | null;

  /** Only while the employee is in draft. */
  @IsOptional()
  @IsBusinessDate()
  joinDate?: string;
}

/** PATCH /me/contact — what employees may change themselves (spec §3). */
export class UpdateOwnContactDto extends VersionedDto {
  @IsOptional()
  @lower()
  @IsEmail()
  personalEmail?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  presentAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @IsOptional()
  @Matches(PHONE, PHONE_MSG)
  emergencyContactPhone?: string;
}

/** GET /employees?companyId=&departmentId=&status=&q=&page=&pageSize= */
export class ListEmployeesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  /** Includes all sub-departments. Uses the placement in force today. */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Uses the placement in force today (a transferred employee counts at the new branch). */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Uses the placement in force today. */
  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  /** Search in English name, Bangla name or employee code. */
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/**
 * GET /employees/export.csv — the same filters as the list, without paging.
 * No salary, bank or identity field: the file leaves the system, so it carries
 * only what the list itself shows.
 */
export class ExportEmployeesQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}
