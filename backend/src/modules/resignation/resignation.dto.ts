/** Request bodies of a resignation from the app (2026-10-30). */
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsBusinessDate } from '../../platform/http/common.dto.js';

/** POST /me/resignation   { "lastWorkingDay": "2026-11-30", "reason": "Moving to Chattogram with my family" } */
export class ResignationDto {
  @IsBusinessDate()
  lastWorkingDay: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}

/** POST /me/resignation/withdraw   { "reason": "Changed my mind after talking to my manager" } */
export class WithdrawResignationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
