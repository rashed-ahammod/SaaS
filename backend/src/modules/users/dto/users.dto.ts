/**
 * Request bodies for user, role, field-grant and delegation routes.
 */
import { Transform } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const SYSTEM_ROLES = [
  'admin',
  'system_admin',
  'hr',
  'accounts',
  'dept_head',
  'employee',
  'auditor',
  'sales',
] as const;
const SCOPES = ['own', 'department', 'company', 'group'] as const;
const FIELD_GROUPS = ['salary', 'bank', 'identity', 'complaint'] as const;
const PHONE = /^\+?[0-9]{8,15}$/;
const lower = () =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
const NullableUuid = () => ValidateIf((_, v) => v !== null && v !== undefined);

// -------------------------------------------------------------------- users --

export class CreateUserDto {
  @lower()
  @IsEmail()
  email: string;

  @IsOptional()
  @Matches(PHONE, { message: 'phone must be 8-15 digits' })
  phone?: string;

  /** First password; the user should change it (password change flow comes with the PWA). */
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password: string;

  @IsOptional()
  @IsIn(['bn', 'en'])
  preferredLanguage?: 'bn' | 'en';

  /** Link the login to an employee record (needed for "own" scope and approvals). */
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class UpdateUserDto extends VersionedDto {
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: 'active' | 'disabled';

  @IsOptional()
  @IsIn(['bn', 'en'])
  preferredLanguage?: 'bn' | 'en';

  @IsOptional()
  @Matches(PHONE, { message: 'phone must be 8-15 digits' })
  phone?: string;

  /** null = unlink from the employee. */
  @NullableUuid()
  @IsUUID()
  employeeId?: string | null;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  newPassword: string;
}

// -------------------------------------------------------------------- roles --

/**
 * POST /users/:userId/roles
 *   { "role": "hr", "scopeType": "company", "scopeId": "<company id>" }
 *   { "role": "dept_head", "scopeType": "department", "scopeId": "<department id>" }
 *   { "customRoleId": "...", "scopeType": "company", "scopeId": "..." }
 *   { "role": "auditor", "scopeType": "company", "scopeId": "...", "expiresAt": "2026-12-31T23:59:59+06:00" }
 */
export class GrantRoleDto {
  /** A system role; or give customRoleId instead. */
  @ValidateIf((o) => !o.customRoleId)
  @IsIn(SYSTEM_ROLES)
  role?: (typeof SYSTEM_ROLES)[number];

  @ValidateIf((o) => !o.role)
  @IsUUID()
  customRoleId?: string;

  @IsIn(SCOPES)
  scopeType: (typeof SCOPES)[number];

  /** Company id (company scope) or department id (department scope); leave out for own / group. */
  @IsOptional()
  @IsUUID()
  scopeId?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class RevokeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class GrantFieldAccessDto {
  @IsIn(FIELD_GROUPS)
  fieldGroup: (typeof FIELD_GROUPS)[number];
}

/** POST /roles — a copy of a system role with some permissions removed. */
export class CreateCustomRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsIn(SYSTEM_ROLES)
  basedOn: (typeof SYSTEM_ROLES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  /** Must be a subset of the base role's permissions. Leave out to copy all. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateCustomRoleDto extends VersionedDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// -------------------------------------------------------------- delegations --

/**
 * POST /delegations
 *   { "toUserId": "...", "startsOn": "2026-10-20", "endsOn": "2026-10-30", "reason": "Annual leave" }
 * fromUserId: leave out to delegate your own approvals; admins may set it for someone else.
 */
export class CreateDelegationDto {
  @IsOptional()
  @IsUUID()
  fromUserId?: string;

  @IsUUID()
  toUserId: string;

  @IsBusinessDate()
  startsOn: string;

  @IsBusinessDate()
  endsOn: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ------------------------------------------------------------- service keys --

/**
 * POST /service-keys
 *   { "name": "Dhaka HQ biometric agent", "permissions": ["attendance.ingest"], "companyId": "..." }
 */
export class CreateServiceKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions: string[];

  /** Limit the key to one company (recommended for office agents). */
  @IsOptional()
  @IsUUID()
  companyId?: string;
}
