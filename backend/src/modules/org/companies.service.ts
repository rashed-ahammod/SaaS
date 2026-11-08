import { Injectable, NotFoundException } from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Company } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import type { CreateCompanyDto, UpdateCompanyDto } from './dto/org.dto.js';

/** Legal entities of the tenant (spec §3). Phase 1 UI shows one company per tenant. */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
  ) {}

  async createCompany(dto: CreateCompanyDto) {
    // a new legal entity needs group-wide rights
    this.access.assert('org.structure.manage', {});

    // save
    const company = await this.db.tx
      .insertInto('companies')
      .values({
        legal_name: dto.legalName.trim(),
        short_name: dto.shortName ?? null,
        tin: dto.tin ?? null,
        bin: dto.bin ?? null,
        fiscal_year_start: dto.fiscalYearStart,
        employee_code_prefix: dto.employeeCodePrefix,
        probation_months: dto.probationMonths,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'company.created',
      entity: 'company',
      entityId: company.id,
      after: toCompanyResponse(company),
    });
    return toCompanyResponse(company);
  }

  async listCompanies() {
    const companies = await this.db.tx
      .selectFrom('companies')
      .selectAll()
      .orderBy('legal_name')
      .execute();
    return companies.map(toCompanyResponse);
  }

  async getCompany(id: string) {
    return toCompanyResponse(await this.findCompany(id));
  }

  async updateCompany(id: string, dto: UpdateCompanyDto) {
    // find, check access and version
    const before = await this.findCompany(id);
    this.access.assert('org.structure.manage', { companyId: id });
    assertVersion(before, dto.version);

    // collect the fields that were sent (nothing sent = nothing to do)
    const changes = changesOnly({
      legal_name: dto.legalName?.trim(),
      short_name: dto.shortName,
      tin: dto.tin,
      bin: dto.bin,
      fiscal_year_start: dto.fiscalYearStart,
      employee_code_prefix: dto.employeeCodePrefix,
      probation_months: dto.probationMonths,
      attendance_correction_limit: dto.attendanceCorrectionLimit,
      late_penalty_enabled: dto.latePenaltyEnabled,
      late_penalty_every: dto.latePenaltyEvery,
      notice_days_resignation: dto.noticeDaysResignation,
      notice_days_termination: dto.noticeDaysTermination,
      retirement_age: dto.retirementAge,
      is_active: dto.isActive,
    });
    if (!changes) return toCompanyResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('companies')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.findCompany(id);
    await this.audit.record({
      action: 'company.updated',
      entity: 'company',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toCompanyResponse(after);
  }

  /** Used by other org services and OrgLookupService. Throws 404 if missing (or another tenant's). */
  async findCompany(id: string): Promise<Company> {
    const company = await this.db.tx
      .selectFrom('companies')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!company) throw new NotFoundException(MSG.COMPANY_NOT_FOUND);
    return company;
  }
}

export function toCompanyResponse(c: Company) {
  return {
    id: c.id,
    legalName: c.legal_name,
    shortName: c.short_name,
    tin: c.tin,
    bin: c.bin,
    fiscalYearStart: c.fiscal_year_start,
    baseCurrency: c.base_currency,
    employeeCodePrefix: c.employee_code_prefix,
    probationMonths: c.probation_months,
    attendanceCorrectionLimit: c.attendance_correction_limit,
    latePenaltyEnabled: c.late_penalty_enabled,
    latePenaltyEvery: c.late_penalty_every,
    noticeDaysResignation: c.notice_days_resignation,
    noticeDaysTermination: c.notice_days_termination,
    retirementAge: c.retirement_age,
    isActive: c.is_active,
    version: c.version,
  };
}
