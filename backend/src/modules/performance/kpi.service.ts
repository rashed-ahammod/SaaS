/**
 * The KPI library (WP30; spec §6.5 "goals/KPIs set from a library per designation").
 *
 * A KPI belongs to the company, optionally to one designation. When a manager writes an
 * appraisal's goals, the library gives them the KPIs for that person's designation plus the
 * company-wide ones, with a default weight each — so two managers measuring the same job
 * measure the same things.
 */
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { KpiDto, UpdateKpiDto } from './dto/performance.dto.js';

@Injectable()
export class KpiService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  async list(
    companyId: string,
    opts: { designationId?: string; all?: boolean } = {},
  ) {
    // the company must exist in this tenant (RLS makes another tenant's a 404)
    await this.org.assertCompanyExists(companyId);
    // The library is the company's own reference data, not anybody's personal data, so a
    // Dept Head's department-scoped grant is enough to read it: they need the KPIs of
    // their people's designations to write goals at all.
    const me = this.access.current();
    if (
      !me.has('performance.view') &&
      !me.has('performance.manage') &&
      !me.has('performance.rate')
    )
      this.access.assert('performance.view', { companyId }); // throws

    let q = this.db.tx
      .selectFrom('kpi_library')
      .select([
        'id',
        'code',
        'title',
        'title_bn',
        'description',
        'measure',
        'designation_id',
        'default_weight',
        'is_active',
        'version',
      ])
      .where('company_id', '=', companyId)
      .orderBy('code');
    if (!opts.all) q = q.where('is_active', '=', true);
    // for one designation: its own KPIs and the company-wide ones
    if (opts.designationId)
      q = q.where((eb) =>
        eb.or([
          eb('designation_id', '=', opts.designationId!),
          eb('designation_id', 'is', null),
        ]),
      );
    const rows = await q.execute();
    return {
      kpis: rows.map((k) => ({
        id: k.id,
        code: k.code,
        title: k.title,
        titleBn: k.title_bn,
        description: k.description,
        measure: k.measure,
        designationId: k.designation_id,
        defaultWeight: k.default_weight,
        isActive: k.is_active,
        version: k.version,
      })),
    };
  }

  async create(companyId: string, dto: KpiDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('performance.manage', { companyId });
    if (dto.designationId)
      await this.org.assertPlacement(companyId, {
        designationId: dto.designationId,
      });
    const taken = await this.db.tx
      .selectFrom('kpi_library')
      .select('id')
      .where('company_id', '=', companyId)
      .where('code', '=', dto.code)
      .executeTakeFirst();
    if (taken) throw new ConflictException(MSG.KPI_CODE_TAKEN);
    const row = await this.db.tx
      .insertInto('kpi_library')
      .values({
        company_id: companyId,
        code: dto.code,
        title: dto.title,
        title_bn: dto.titleBn ?? null,
        description: dto.description ?? null,
        measure: dto.measure ?? 'number',
        designation_id: dto.designationId ?? null,
        default_weight: dto.defaultWeight ?? 10,
      })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'kpi.created',
      entity: 'kpi',
      entityId: row.id,
      after: { code: row.code, title: dto.title },
    });
    return this.list(companyId, { all: true });
  }

  async update(kpiId: string, dto: UpdateKpiDto) {
    const kpi = await this.db.tx
      .selectFrom('kpi_library')
      .selectAll()
      .where('id', '=', kpiId)
      .executeTakeFirst();
    if (!kpi) throw new NotFoundException(MSG.KPI_NOT_FOUND);
    this.access.assert('performance.manage', { companyId: kpi.company_id });
    if (kpi.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    await this.db.tx
      .updateTable('kpi_library')
      .set({
        title: dto.title ?? kpi.title,
        title_bn: dto.titleBn ?? kpi.title_bn,
        description: dto.description ?? kpi.description,
        measure: dto.measure ?? kpi.measure,
        default_weight: dto.defaultWeight ?? kpi.default_weight,
        is_active: dto.isActive ?? kpi.is_active,
      })
      .where('id', '=', kpiId)
      .execute();
    await this.audit.record({
      action: 'kpi.updated',
      entity: 'kpi',
      entityId: kpiId,
      before: { title: kpi.title, isActive: kpi.is_active },
      after: { title: dto.title ?? kpi.title, isActive: dto.isActive ?? kpi.is_active },
    });
    return this.list(kpi.company_id, { all: true });
  }
}
