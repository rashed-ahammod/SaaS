/**
 * Sales territories (Phase 3 WP23): districts and the salespeople who take their leads in turn.
 * A district belongs to one active territory at most. Set up by the Admin (crm.manage).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { districtOf } from './crm-rules.js';
import type { TerritoryDto, UpdateTerritoryDto } from './dto/crm.dto.js';
import { LeadsService } from './leads.service.js';

@Injectable()
export class TerritoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly leads: LeadsService,
  ) {}

  async list(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const company = { companyId };
    if (
      !this.access.allows('crm.manage', company) &&
      !this.access.allows('crm.view', company) &&
      !this.access.current().has('crm.assign') &&
      !this.access.current().has('crm.own')
    ) {
      this.access.assert('crm.view', company);
    }
    const rows = await this.db.tx
      .selectFrom('sales_territories')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    const members = rows.length
      ? await this.db.tx
          .selectFrom('sales_territory_members as m')
          .innerJoin('users as u', 'u.id', 'm.user_id')
          .leftJoin('employees as e', 'e.id', 'u.employee_id')
          .select(['m.territory_id', 'm.user_id', 'u.email', 'e.full_name_en'])
          .where(
            'm.territory_id',
            'in',
            rows.map((r) => r.id),
          )
          .execute()
      : [];
    return rows.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      districts: t.districts,
      isActive: t.is_active,
      version: t.version,
      members: members
        .filter((m) => m.territory_id === t.id)
        .map((m) => ({ userId: m.user_id, name: m.full_name_en ?? m.email })),
    }));
  }

  /** The company's Sales users: who can be a territory member or a lead's owner. */
  async salespeople(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const ids = await this.leads.salespeople(companyId);
    if (!ids.length) return [];
    const rows = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en', 'e.employee_code'])
      .where('u.id', 'in', ids)
      .orderBy('e.full_name_en')
      .execute();
    return rows.map((r) => ({
      userId: r.id,
      name: r.full_name_en ?? r.email,
      employeeCode: r.employee_code,
    }));
  }

  async create(companyId: string, dto: TerritoryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('crm.manage', { companyId });
    const districts = await this.checkDistricts(companyId, dto.districts, null);
    await this.checkMembers(companyId, dto.memberIds);
    const t = await this.db.tx
      .insertInto('sales_territories')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name,
        districts,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (dto.memberIds.length)
      await this.db.tx
        .insertInto('sales_territory_members')
        .values(
          dto.memberIds.map((user_id) => ({ territory_id: t.id, user_id })),
        )
        .execute();
    await this.audit.record({
      action: 'sales_territory.created',
      entity: 'sales_territory',
      entityId: t.id,
      after: { code: dto.code, districts, members: dto.memberIds },
    });
    return (await this.list(companyId)).find((x) => x.id === t.id)!;
  }

  async update(id: string, dto: UpdateTerritoryDto) {
    const t = await this.db.tx
      .selectFrom('sales_territories')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) throw new NotFoundException(MSG.TERRITORY_NOT_FOUND);
    this.access.assert('crm.manage', { companyId: t.company_id });
    const districts = await this.checkDistricts(
      t.company_id,
      dto.districts,
      id,
    );
    await this.checkMembers(t.company_id, dto.memberIds);
    const row = await this.db.tx
      .updateTable('sales_territories')
      .set({
        name: dto.name,
        districts,
        is_active: dto.isActive ?? t.is_active,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.db.tx
      .deleteFrom('sales_territory_members')
      .where('territory_id', '=', id)
      .execute();
    if (dto.memberIds.length)
      await this.db.tx
        .insertInto('sales_territory_members')
        .values(dto.memberIds.map((user_id) => ({ territory_id: id, user_id })))
        .execute();
    await this.audit.record({
      action: 'sales_territory.updated',
      entity: 'sales_territory',
      entityId: id,
      before: { districts: t.districts },
      after: { districts, members: dto.memberIds, isActive: row.is_active },
    });
    return (await this.list(t.company_id)).find((x) => x.id === id)!;
  }

  private async checkDistricts(
    companyId: string,
    given: string[],
    selfId: string | null,
  ) {
    const districts = given.map((d) => districtOf(d));
    if (districts.some((d) => !d))
      throw new BadRequestException({
        message: MSG.CRM_CONTACT_INVALID,
        details: {
          problems: given
            .filter((d) => !districtOf(d))
            .map((d) => `Not a district of Bangladesh: ${d}`),
        },
      });
    const others = await this.db.tx
      .selectFrom('sales_territories')
      .select(['code', 'districts'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .execute();
    const clash = others.flatMap((o) =>
      o.districts
        .filter((d) => districts.includes(d))
        .map((d) => `${d} (${o.code})`),
    );
    const own = selfId
      ? (
          await this.db.tx
            .selectFrom('sales_territories')
            .select('code')
            .where('id', '=', selfId)
            .executeTakeFirst()
        )?.code
      : null;
    const real = clash.filter((c) => !own || !c.endsWith(`(${own})`));
    if (real.length)
      throw new ConflictException({
        message: MSG.TERRITORY_DISTRICT_TAKEN,
        details: { problems: real },
      });
    return [...new Set(districts as string[])];
  }

  private async checkMembers(companyId: string, ids: string[]) {
    const people = await this.leads.salespeople(companyId);
    if (ids.some((id) => !people.includes(id)))
      throw new BadRequestException(MSG.CRM_OWNER_INVALID);
  }
}
