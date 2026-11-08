/**
 * Request bodies for Gate 1 parallel payroll comparisons (WP12).
 */
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

/** POST /payroll-runs/:runId/parallel-comparisons   multipart: file, tolerance? ("1.00" = whole-taka rounding allowed) */
export class CompareDto {
  @IsOptional()
  @Matches(/^\d{1,4}(\.\d{1,2})?$/, {
    message: 'tolerance must be an amount like 1.00',
  })
  tolerance?: string;
}

/** POST /parallel-comparisons/:id/lines/:employeeCode/explain   { "explanation": "Old system rounds tax to whole taka" } */
export class ExplainDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  explanation: string;
}

/** POST /parallel-comparisons/:id/accept   { "note": "Checked with the September bank statement" } */
export class AcceptComparisonDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
