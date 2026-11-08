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
import type { Grade } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { CompaniesService } from './companies.service.js';
import type { CreateGradeDto, UpdateGradeDto } from './dto/org.dto.js';

/** Pay grades with an optional salary band and the overtime-eligible flag (spec §3, §6.2). */
@Injectable()
export class GradesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly access: AccessService,
  ) {}

  async createGrade(companyId: string, dto: CreateGradeDto) {
    // check company and salary band
    await this.companies.findCompany(companyId);
    this.access.assert('org.jobs.manage', { companyId });
    checkBand(dto.salaryMin ?? null, dto.salaryMax ?? null);

    // save
    const grade = await this.db.tx
      .insertInto('grades')
      .values({
        company_id: companyId,
        code: dto.code,
        name: dto.name.trim(),
        rank: dto.rank,
        ot_eligible: dto.otEligible,
        salary_min: dto.salaryMin ? Money.of(dto.salaryMin).toDb() : null,
        salary_max: dto.salaryMax ? Money.of(dto.salaryMax).toDb() : null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'grade.created',
      entity: 'grade',
      entityId: grade.id,
      after: toGradeResponse(grade),
    });
    return toGradeResponse(grade);
  }

  async listGrades(companyId: string) {
    await this.companies.findCompany(companyId);
    const rows = await this.db.tx
      .selectFrom('grades')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('rank', 'desc')
      .orderBy('code')
      .execute();
    return rows.map(toGradeResponse);
  }

  async getGrade(id: string) {
    return toGradeResponse(await this.findGrade(id));
  }

  async updateGrade(id: string, dto: UpdateGradeDto) {
    // find and check version
    const before = await this.findGrade(id);
    this.access.assert('org.jobs.manage', { companyId: before.company_id });
    assertVersion(before, dto.version);

    // the band is checked as it will be after the update
    const salaryMin =
      dto.salaryMin !== undefined ? Money.of(dto.salaryMin).toDb() : undefined;
    const salaryMax =
      dto.salaryMax !== undefined ? Money.of(dto.salaryMax).toDb() : undefined;
    checkBand(salaryMin ?? before.salary_min, salaryMax ?? before.salary_max);

    // collect the fields that were sent
    const changes = changesOnly({
      code: dto.code,
      name: dto.name?.trim(),
      rank: dto.rank,
      ot_eligible: dto.otEligible,
      salary_min: salaryMin,
      salary_max: salaryMax,
      is_active: dto.isActive,
    });
    if (!changes) return toGradeResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('grades')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);

    const after = await this.findGrade(id);
    await this.audit.record({
      action: 'grade.updated',
      entity: 'grade',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toGradeResponse(after);
  }

  async findGrade(id: string): Promise<Grade> {
    const grade = await this.db.tx
      .selectFrom('grades')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!grade) throw new NotFoundException(MSG.GRADE_NOT_FOUND);
    return grade;
  }
}

function checkBand(min: string | null, max: string | null) {
  if (min !== null && max !== null && Money.of(max).lessThan(min)) {
    throw new BadRequestException('salaryMax must not be lower than salaryMin');
  }
}

export function toGradeResponse(g: Grade) {
  return {
    id: g.id,
    companyId: g.company_id,
    code: g.code,
    name: g.name,
    rank: g.rank,
    otEligible: g.ot_eligible,
    salaryMin: g.salary_min, // money as a string, e.g. "25000.00"
    salaryMax: g.salary_max,
    isActive: g.is_active,
    version: g.version,
  };
}
