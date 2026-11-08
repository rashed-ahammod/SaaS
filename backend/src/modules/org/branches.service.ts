import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Branch } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { CompaniesService } from './companies.service.js';
import type { CreateBranchDto, UpdateBranchDto } from './dto/org.dto.js';

/** Offices / locations. Each has its own weekend days and geo-fence (spec §3, §6.2). */
@Injectable()
export class BranchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly access: AccessService,
  ) {}

  async createBranch(companyId: string, dto: CreateBranchDto) {
    // check company
    await this.companies.findCompany(companyId);
    this.access.assert('org.structure.manage', { companyId });
    checkGeoFence(dto.geoLat, dto.geoLng, dto.geoRadiusM);

    // save
    const branch = await this.db.tx
      .insertInto('branches')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name.trim(),
        address: dto.address ?? null,
        weekend_days: dto.weekendDays,
        geo_lat: dto.geoLat ?? null,
        geo_lng: dto.geoLng ?? null,
        geo_radius_m: dto.geoRadiusM ?? null,
        holiday_calendar_id: dto.holidayCalendarId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'branch.created',
      entity: 'branch',
      entityId: branch.id,
      after: toBranchResponse(branch),
    });
    return toBranchResponse(branch);
  }

  async listBranches(companyId: string) {
    await this.companies.findCompany(companyId);
    const branches = await this.db.tx
      .selectFrom('branches')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('name')
      .execute();
    return branches.map(toBranchResponse);
  }

  async getBranch(id: string) {
    return toBranchResponse(await this.findBranch(id));
  }

  async updateBranch(id: string, dto: UpdateBranchDto) {
    // find and check version
    const before = await this.findBranch(id);
    this.access.assert('org.structure.manage', {
      companyId: before.company_id,
    });
    assertVersion(before, dto.version);

    // the geo-fence is checked as it will be after the update
    const geoLat = dto.geoLat !== undefined ? dto.geoLat : before.geo_lat;
    const geoLng = dto.geoLng !== undefined ? dto.geoLng : before.geo_lng;
    const geoRadiusM =
      dto.geoRadiusM !== undefined ? dto.geoRadiusM : before.geo_radius_m;
    checkGeoFence(geoLat, geoLng, geoRadiusM);

    // collect the fields that were sent (nothing sent = nothing to do)
    const changes = changesOnly({
      code: dto.code,
      name: dto.name?.trim(),
      address: dto.address,
      weekend_days: dto.weekendDays,
      geo_lat: dto.geoLat,
      geo_lng: dto.geoLng,
      geo_radius_m: dto.geoRadiusM,
      holiday_calendar_id: dto.holidayCalendarId,
      is_active: dto.isActive,
    });
    if (!changes) return toBranchResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('branches')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.findBranch(id);
    await this.audit.record({
      action: 'branch.updated',
      entity: 'branch',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toBranchResponse(after);
  }

  async findBranch(id: string): Promise<Branch> {
    const branch = await this.db.tx
      .selectFrom('branches')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!branch) throw new NotFoundException(MSG.BRANCH_NOT_FOUND);
    return branch;
  }
}

/** Latitude, longitude and radius go together: all three or none. */
function checkGeoFence(
  lat?: number | null,
  lng?: number | null,
  radius?: number | null,
) {
  const given = [lat, lng, radius].filter(
    (v) => v !== undefined && v !== null,
  ).length;
  if (given !== 0 && given !== 3) {
    throw new BadRequestException(
      'geoLat, geoLng and geoRadiusM must be given together',
    );
  }
}

export function toBranchResponse(b: Branch) {
  return {
    id: b.id,
    companyId: b.company_id,
    code: b.code,
    name: b.name,
    address: b.address,
    weekendDays: b.weekend_days,
    geoFence:
      b.geo_lat === null
        ? null
        : { lat: b.geo_lat, lng: b.geo_lng, radiusM: b.geo_radius_m },
    holidayCalendarId: b.holiday_calendar_id,
    isActive: b.is_active,
    version: b.version,
  };
}
