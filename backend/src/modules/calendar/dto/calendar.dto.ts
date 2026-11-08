import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  IsBusinessDate,
  VersionedDto,
} from '../../../platform/http/common.dto.js';

const TYPES = ['public', 'festival', 'company'] as const;

/** POST /companies/:companyId/holiday-calendars   { "name": "Bangladesh 2026" } */
export class CreateHolidayCalendarDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}

/**
 * POST /holiday-calendars/:calendarId/holidays
 *   { "date": "2026-03-21", "nameEn": "Eid-ul-Fitr", "nameBn": "ঈদুল ফিতর", "type": "festival" }
 */
export class CreateHolidayDto {
  @IsBusinessDate()
  date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  /** public (government), festival (counts toward the statutory festival days), company */
  @IsIn(TYPES)
  type: (typeof TYPES)[number];
}

/** PATCH /holidays/:holidayId — moving "date" recomputes attendance for both dates. */
export class UpdateHolidayDto extends VersionedDto {
  @IsOptional()
  @IsBusinessDate()
  date?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nameEn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nameBn?: string;

  @IsOptional()
  @IsIn(TYPES)
  type?: (typeof TYPES)[number];
}

export class RemoveHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class YearQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
