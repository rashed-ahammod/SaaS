/**
 * Request bodies of customers and leads (Phase 3 WP23). Phone numbers are taken as people
 * write them (01711-223344, +880 1711 223344) and stored as +8801711223344.
 */
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsBusinessDate } from '../../../platform/http/common.dto.js';
import type {
  ActivityKind,
  CustomerType,
  LeadSource,
  LeadState,
} from '../../../platform/db/schema.js';
import { OpportunityFieldsDto } from './opportunities.dto.js';

const trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
export const LEAD_SOURCES: LeadSource[] = [
  'web_form',
  'facebook',
  'referral',
  'call',
  'walk_in',
  'manual',
  'other',
];
export const CUSTOMER_TYPES: CustomerType[] = [
  'dealer',
  'distributor',
  'retail',
  'corporate',
  'government',
  'export',
];
export const ACTIVITY_KINDS: ActivityKind[] = [
  'call',
  'meeting',
  'note',
  'task',
  'email',
  'sms',
];

/**
 * POST /companies/:companyId/leads   (a salesperson, or the Sales head / Admin for someone)
 *   { "name": "Abdul Karim", "organisation": "Karim Stores", "phone": "01711-223344", "district": "Dhaka",
 *     "source": "walk_in", "message": "Wants 200 cans of rice bran oil every month" }
 */
export class LeadDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  district?: string;

  @IsIn(LEAD_SOURCES)
  source: LeadSource;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;

  /** another salesperson (Sales head / Admin); left out: assigned by territory, then in turn */
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

/**
 * POST /companies/:companyId/leads/capture   (n8n with a ServiceKey carrying crm.capture)
 *   { "source": "facebook", "externalRef": "leadgen:1203948571", "name": "Nasrin Akter", "phone": "+880 1819-445566",
 *     "district": "Chattogram", "sourceDetail": "Eid campaign 2026", "message": "Price for dealers?" }
 */
export class CaptureLeadDto {
  @IsIn(['web_form', 'facebook', 'other'])
  source: LeadSource;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  district?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  sourceDetail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  message?: string;
}

/** PATCH /leads/:leadId   { version, name?, organisation?, phone?, email?, district? } */
export class UpdateLeadDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  organisation?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  district?: string;
}

/** GET /companies/:companyId/leads?state=new&ownerId=&source=&q= */
export class LeadQueryDto {
  @IsOptional()
  @IsIn(['new', 'contacted', 'qualified', 'disqualified', 'open'])
  state?: LeadState | 'open';

  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @IsOptional()
  @IsIn(LEAD_SOURCES)
  source?: LeadSource;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;
}

/** POST /leads/:leadId/assign   { "ownerId": "<user>", "note": "Chattogram dealers go to Rafi" } */
export class AssignDto {
  @IsUUID()
  ownerId: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/** POST /leads/:leadId/disqualify   { "reason": "Student project, not a buyer" } */
export class DisqualifyDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/**
 * POST /leads/:leadId/qualify   the lead becomes a customer (new, or one that exists)
 *   { "customer": { "kind": "company", "name": "Karim Stores", "customerType": "retail", "address": "House 12, Sector 7, Uttara" } }
 *   { "customerId": "<existing customer>" }
 *   either one with "opportunity": { title, value, expectedCloseOn, stageId? } (WP24)
 */
export class CustomerFieldsDto {
  @IsIn(['company', 'person'])
  kind: 'company' | 'person';

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @IsOptional()
  @trim()
  @Matches(/^[0-9]{9}-?[0-9]{4}$/, {
    message: 'must be a BIN like 000123456-0101',
  })
  bin?: string;

  @IsOptional()
  @trim()
  @Matches(/^[0-9]{12}$/, { message: 'must be a 12-digit TIN' })
  tin?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  district?: string;

  /** another salesperson (Sales head / Admin); left out: the creator, or the lead's owner */
  @IsOptional()
  @IsUUID()
  accountManagerId?: string;
}

export class QualifyDto {
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CustomerFieldsDto)
  customer?: CustomerFieldsDto;

  /** WP24: an opportunity for the customer at once, e.g. { "title": "200 cans a month", "value": "360000", "expectedCloseOn": "2026-11-15" } */
  @IsOptional()
  @ValidateNested()
  @Type(() => OpportunityFieldsDto)
  opportunity?: OpportunityFieldsDto;
}

/** POST /companies/:companyId/customers */
export class CustomerDto extends CustomerFieldsDto {}

/** PATCH /customers/:customerId   { version, ... } */
export class UpdateCustomerDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  nameBn?: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  customerType?: CustomerType;

  @IsOptional()
  @trim()
  @Matches(/^[0-9]{9}-?[0-9]{4}$/, {
    message: 'must be a BIN like 000123456-0101',
  })
  bin?: string;

  @IsOptional()
  @trim()
  @Matches(/^[0-9]{12}$/, { message: 'must be a 12-digit TIN' })
  tin?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(60)
  district?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** PUT /customers/:customerId/credit   (Accounts) { "creditLimit": "500000", "paymentTermsDays": 30, "version": 3 } */
export class CreditDto {
  @IsInt()
  @Min(1)
  version: number;

  @Matches(AMOUNT, { message: 'must be an amount like 500000' })
  creditLimit: string;

  @IsInt()
  @Min(0)
  @Max(365)
  paymentTermsDays: number;
}

/** POST /customers/:customerId/contacts   { "name": "Md. Jasim Uddin", "designation": "Purchase officer", "phone": "01911-556677", "isPrimary": true } */
export class ContactDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** GET /companies/:companyId/customers?q=&type=&managerId= */
export class CustomerQueryDto {
  @IsOptional()
  @trim()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(CUSTOMER_TYPES)
  type?: CustomerType;

  @IsOptional()
  @IsUUID()
  managerId?: string;
}

/**
 * POST /leads/:leadId/activities  |  POST /customers/:customerId/activities
 *   { "kind": "call", "subject": "Called: wants a price list", "body": "Will visit Tejgaon office on Sunday" }
 *   { "kind": "task", "subject": "Send the dealer price list", "dueOn": "2026-11-02" }
 */
export class ActivityDto {
  @IsIn(ACTIVITY_KINDS)
  kind: ActivityKind;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  /** tasks: the day it is due */
  @IsOptional()
  @IsBusinessDate()
  dueOn?: string;

  /** tasks: who does it (another salesperson); left out: oneself */
  @IsOptional()
  @IsUUID()
  ownerId?: string;
}

/**
 * POST /companies/:companyId/sales-territories   (Admin)
 *   { "code": "CTG", "name": "Chattogram division", "districts": ["Chattogram", "Cox's Bazar", "Cumilla", "Feni"], "memberIds": ["<Rafi>"] }
 */
export class TerritoryDto {
  @trim()
  @Matches(/^[A-Z0-9-]{1,20}$/, {
    message: 'code: capital letters, digits and dashes',
  })
  code: string;

  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsArray()
  @ArrayMaxSize(64)
  @IsString({ each: true })
  districts: string[];

  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  memberIds: string[];
}

/** PUT /sales-territories/:territoryId   { version, name, districts, memberIds, isActive } */
export class UpdateTerritoryDto extends TerritoryDto {
  @IsInt()
  @Min(1)
  version: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
