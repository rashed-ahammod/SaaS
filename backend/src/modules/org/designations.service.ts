import { Injectable, NotFoundException } from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Designation } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { CompaniesService } from './companies.service.js';
import type {
  CreateDesignationDto,
  UpdateDesignationDto,
} from './dto/org.dto.js';

/** Job titles, e.g. "Senior Executive" / "সিনিয়র এক্সিকিউটিভ". Owned by HR (spec §3). */
@Injectable()
export class DesignationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly access: AccessService,
  ) {}

  async createDesignation(companyId: string, dto: CreateDesignationDto) {
    // check company
    await this.companies.findCompany(companyId);
    this.access.assert('org.jobs.manage', { companyId });

    // save
    const designation = await this.db.tx
      .insertInto('designations')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn.trim(),
        name_bn: dto.nameBn?.trim() ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'designation.created',
      entity: 'designation',
      entityId: designation.id,
      after: toDesignationResponse(designation),
    });
    return toDesignationResponse(designation);
  }

  async listDesignations(companyId: string) {
    await this.companies.findCompany(companyId);
    const rows = await this.db.tx
      .selectFrom('designations')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('name_en')
      .execute();
    return rows.map(toDesignationResponse);
  }

  async getDesignation(id: string) {
    return toDesignationResponse(await this.findDesignation(id));
  }

  async updateDesignation(id: string, dto: UpdateDesignationDto) {
    // find and check version
    const before = await this.findDesignation(id);
    this.access.assert('org.jobs.manage', { companyId: before.company_id });
    assertVersion(before, dto.version);

    // collect the fields that were sent
    const changes = changesOnly({
      code: dto.code,
      name_en: dto.nameEn?.trim(),
      name_bn: dto.nameBn?.trim(),
      is_active: dto.isActive,
    });
    if (!changes) return toDesignationResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('designations')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.findDesignation(id);
    await this.audit.record({
      action: 'designation.updated',
      entity: 'designation',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toDesignationResponse(after);
  }

  async findDesignation(id: string): Promise<Designation> {
    const designation = await this.db.tx
      .selectFrom('designations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!designation) throw new NotFoundException(MSG.DESIGNATION_NOT_FOUND);
    return designation;
  }
}

export function toDesignationResponse(d: Designation) {
  return {
    id: d.id,
    companyId: d.company_id,
    code: d.code,
    nameEn: d.name_en,
    nameBn: d.name_bn,
    isActive: d.is_active,
    version: d.version,
  };
}
