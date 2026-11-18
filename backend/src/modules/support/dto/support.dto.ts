/**
 * Request bodies of support tickets (Phase 3 WP28).
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  TicketPriority,
  TicketSource,
  TicketState,
} from '../../../platform/db/schema.js';
import { TICKET_PRIORITIES } from '../support-rules.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const TICKET_SOURCES: TicketSource[] = [
  'phone',
  'email',
  'walk_in',
  'portal',
  'field_visit',
  'other',
];
export const TICKET_STATES: TicketState[] = [
  'new',
  'open',
  'waiting_customer',
  'resolved',
  'closed',
];

/**
 * POST /companies/:companyId/support/tickets
 *   { "customerId": "...", "categoryId": "...", "subject": "2 cartons leaked",
 *     "description": "Driver delivered 20 cartons; 2 were leaking.", "source": "phone" }
 * Priority defaults to the category's; the assignee to the customer's account manager.
 */
export class TicketDto {
  @IsUUID()
  customerId: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;

  @IsUUID()
  categoryId: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @IsOptional()
  @IsIn(TICKET_SOURCES)
  source?: TicketSource;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

export class TicketQueryDto {
  @IsOptional()
  @IsIn([...TICKET_STATES, 'open_only', 'breached'])
  state?: TicketState | 'open_only' | 'breached';

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  priority?: TicketPriority;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** A reply the customer sees, an internal note, or what the customer sent back. */
export class TicketMessageDto {
  @IsIn(['reply', 'note', 'customer'])
  kind: 'reply' | 'note' | 'customer';

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;
}

export class AssignTicketDto {
  @IsUUID()
  assigneeId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PriorityDto {
  @IsIn(TICKET_PRIORITIES)
  priority: TicketPriority;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class ResolveTicketDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  resolution: string;
}

export class ReopenTicketDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

export class WaitDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  question: string;
}

export class CategoryDto {
  @trim()
  @Matches(/^[A-Z0-9-]{1,20}$/)
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  defaultPriority?: TicketPriority;
}

export class UpdateCategoryDto {
  @Type(() => Number)
  @IsNumber()
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  nameBn?: string;

  @IsOptional()
  @IsIn(TICKET_PRIORITIES)
  defaultPriority?: TicketPriority;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SlaRowDto {
  @IsIn(TICKET_PRIORITIES)
  priority: TicketPriority;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(2000)
  firstResponseHours: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.25)
  @Max(2000)
  resolutionHours: number;
}

/** PUT /companies/:companyId/support/sla  { "rows": [ { priority, firstResponseHours, resolutionHours } ] } */
export class SlaPolicyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SlaRowDto)
  rows: SlaRowDto[];
}
