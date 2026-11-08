/**
 * Building blocks for request DTOs, shared by all modules.
 */
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Max,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { businessDate } from '../dates/business-date.js';

/** Validates a 'YYYY-MM-DD' business date that really exists (no 2026-02-30). */
export function IsBusinessDate(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isBusinessDate',
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a date in YYYY-MM-DD format`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          try {
            businessDate(value);
            return true;
          } catch {
            return false;
          }
        },
      },
    });
}

/** ?page=1&pageSize=20 */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 20;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * Every update (PATCH) body carries the `version` the client last read.
 * If someone else saved in between, the update is refused with 409 STALE_VERSION
 * (optimistic locking, guide §7).
 */
export class VersionedDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version: number;
}
