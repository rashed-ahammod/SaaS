/**
 * What other modules may ask the organization module (guide §3: "other modules
 * call its service interface, never its tables directly").
 *
 * Used by the employees module today; by attendance (weekends, geo-fence) and
 * permissions (department scope) later.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { CompaniesService } from './companies.service.js';
import { DepartmentsService } from './departments.service.js';

export interface PlacementIds {
  branchId?: string;
  departmentId?: string;
  designationId?: string;
  gradeId?: string;
}

/** Display names for a set of org ids (for building API responses). */
export interface OrgNames {
  branches: Map<string, { code: string; name: string }>;
  departments: Map<
    string,
    { code: string; name: string; costCentreCode: string | null }
  >;
  designations: Map<
    string,
    { code: string; nameEn: string; nameBn: string | null }
  >;
  grades: Map<string, { code: string; name: string }>;
}

@Injectable()
export class OrgLookupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly companies: CompaniesService,
    private readonly departments: DepartmentsService,
  ) {}

  async getCompanyRules(companyId: string) {
    const company = await this.companies.findCompany(companyId);
    return {
      probationMonths: company.probation_months,
      fiscalYearStart: company.fiscal_year_start,
      attendanceCorrectionLimit: company.attendance_correction_limit,
      latePenaltyEnabled: company.late_penalty_enabled,
      latePenaltyEvery: company.late_penalty_every,
      noticeDaysResignation: company.notice_days_resignation,
      noticeDaysTermination: company.notice_days_termination,
      retirementAge: company.retirement_age,
    };
  }

  /**
   * Next employee code for a company, e.g. "DTL-00042".
   * The UPDATE locks the company row, so two requests never get the same number.
   */
  async allocateEmployeeCode(companyId: string): Promise<string> {
    const row = await this.db.tx
      .updateTable('companies')
      .set((eb) => ({
        next_employee_number: eb('next_employee_number', '+', 1),
      }))
      .where('id', '=', companyId)
      .returning([
        'employee_code_prefix',
        sql<number>`next_employee_number - 1`.as('number'),
      ])
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.COMPANY_NOT_FOUND);
    return `${row.employee_code_prefix}-${String(row.number).padStart(5, '0')}`;
  }

  /**
   * Checks that each given branch/department/designation/grade exists, belongs to
   * the company and is active. Throws a clear 404/400 otherwise.
   */
  async assertPlacement(companyId: string, ids: PlacementIds): Promise<void> {
    const checks: Array<
      [
        keyof PlacementIds,
        'branches' | 'departments' | 'designations' | 'grades',
        string,
      ]
    > = [
      ['branchId', 'branches', MSG.BRANCH_NOT_FOUND],
      ['departmentId', 'departments', MSG.DEPARTMENT_NOT_FOUND],
      ['designationId', 'designations', MSG.DESIGNATION_NOT_FOUND],
      ['gradeId', 'grades', MSG.GRADE_NOT_FOUND],
    ];
    for (const [field, table, notFound] of checks) {
      const id = ids[field];
      if (!id) continue;
      const row = await this.db.tx
        .selectFrom(table)
        .select(['company_id', 'is_active'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row || row.company_id !== companyId)
        throw new NotFoundException(notFound);
      if (!row.is_active)
        throw new BadRequestException(`${field} refers to an inactive record`);
    }
  }

  /** Active companies of the tenant (for jobs that run per company). */
  async activeCompanyIds(): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('companies')
      .select('id')
      .where('is_active', '=', true)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Active branch / department / designation / grade codes of a company (data migration). */
  async codeMaps(companyId: string) {
    const tx = this.db.tx;
    const map = (rows: Array<{ id: string; code: string }>) =>
      new Map(rows.map((r) => [r.code.toUpperCase(), r.id]));
    return {
      branches: map(
        await tx
          .selectFrom('branches')
          .select(['id', 'code'])
          .where('company_id', '=', companyId)
          .where('is_active', '=', true)
          .execute(),
      ),
      departments: map(
        await tx
          .selectFrom('departments')
          .select(['id', 'code'])
          .where('company_id', '=', companyId)
          .where('is_active', '=', true)
          .execute(),
      ),
      designations: map(
        await tx
          .selectFrom('designations')
          .select(['id', 'code'])
          .where('company_id', '=', companyId)
          .where('is_active', '=', true)
          .execute(),
      ),
      grades: map(
        await tx
          .selectFrom('grades')
          .select(['id', 'code'])
          .where('company_id', '=', companyId)
          .where('is_active', '=', true)
          .execute(),
      ),
    };
  }

  /** Company names for documents (payslips, bank files). */
  async companyNames(
    companyId: string,
  ): Promise<{ legalName: string; shortName: string | null }> {
    const company = await this.companies.findCompany(companyId);
    return { legalName: company.legal_name, shortName: company.short_name };
  }

  /** Throws 404 if the company does not exist (in this tenant). */
  async assertCompanyExists(companyId: string): Promise<void> {
    await this.companies.findCompany(companyId);
  }

  /** The company a department belongs to; 404 if the department does not exist. */
  async companyOfDepartment(departmentId: string): Promise<string> {
    return (await this.departments.findDepartment(departmentId)).company_id;
  }

  /**
   * Of these departments, the ones that belong to this company.
   *
   * A department-scoped grant (a Dept Head's) names departments but not their
   * company, so a screen that filters by such a scope must keep the company in
   * the question too — otherwise a head of one company passes the gate of
   * another and reads what that company holds at company level.
   */
  async departmentsOfCompany(
    companyId: string,
    departmentIds: string[],
  ): Promise<string[]> {
    if (!departmentIds.length) return [];
    const rows = await this.db.tx
      .selectFrom('departments')
      .select('id')
      .where('company_id', '=', companyId)
      .where('id', 'in', departmentIds)
      .execute();
    return rows.map((r) => r.id);
  }

  /** Head and parent of a department (approval routing: "dept_head" steps). */
  async departmentHeadInfo(
    departmentId: string,
  ): Promise<{ headEmployeeId: string | null; parentId: string | null }> {
    const d = await this.departments.findDepartment(departmentId);
    return { headEmployeeId: d.head_employee_id, parentId: d.parent_id };
  }

  /** What other modules need about a branch: weekend, holiday calendar, geo-fence. */
  async branchInfo(branchId: string) {
    const b = await this.db.tx
      .selectFrom('branches')
      .selectAll()
      .where('id', '=', branchId)
      .executeTakeFirst();
    if (!b) throw new NotFoundException(MSG.BRANCH_NOT_FOUND);
    return {
      id: b.id,
      companyId: b.company_id,
      name: b.name,
      weekendDays: b.weekend_days as string[],
      holidayCalendarId: b.holiday_calendar_id,
      geoFence:
        b.geo_lat !== null && b.geo_lng !== null && b.geo_radius_m !== null
          ? { lat: b.geo_lat, lng: b.geo_lng, radiusM: b.geo_radius_m }
          : null,
    };
  }

  /** Overtime is paid only for OT-eligible grades (spec §6.2). */
  async gradeOtEligible(gradeId: string): Promise<boolean> {
    const g = await this.db.tx
      .selectFrom('grades')
      .select('ot_eligible')
      .where('id', '=', gradeId)
      .executeTakeFirst();
    return g?.ot_eligible ?? false;
  }

  /** Branches of a company that use a holiday calendar. */
  async branchesUsingCalendar(calendarId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('branches')
      .select('id')
      .where('holiday_calendar_id', '=', calendarId)
      .execute();
    return rows.map((r) => r.id);
  }

  /** A department plus all departments below it. */
  departmentWithDescendants(departmentId: string): Promise<string[]> {
    return this.departments.descendantIds(departmentId);
  }

  /** Names for many ids at once (one query per kind). */
  async names(ids: {
    branchIds?: string[];
    departmentIds?: string[];
    designationIds?: string[];
    gradeIds?: string[];
  }): Promise<OrgNames> {
    // "in ()" is invalid SQL, so an empty list becomes a never-matching id
    const list = (values?: string[]) =>
      values?.length
        ? [...new Set(values)]
        : ['00000000-0000-0000-0000-000000000000'];
    const tx = this.db.tx;

    const branches = await tx
      .selectFrom('branches')
      .select(['id', 'code', 'name'])
      .where('id', 'in', list(ids.branchIds))
      .execute();
    const departments = await tx
      .selectFrom('departments')
      .select(['id', 'code', 'name', 'cost_centre_code'])
      .where('id', 'in', list(ids.departmentIds))
      .execute();
    const designations = await tx
      .selectFrom('designations')
      .select(['id', 'code', 'name_en', 'name_bn'])
      .where('id', 'in', list(ids.designationIds))
      .execute();
    const grades = await tx
      .selectFrom('grades')
      .select(['id', 'code', 'name'])
      .where('id', 'in', list(ids.gradeIds))
      .execute();

    return {
      branches: new Map(
        branches.map((r) => [r.id, { code: r.code, name: r.name }]),
      ),
      departments: new Map(
        departments.map((r) => [
          r.id,
          { code: r.code, name: r.name, costCentreCode: r.cost_centre_code },
        ]),
      ),
      designations: new Map(
        designations.map((r) => [
          r.id,
          { code: r.code, nameEn: r.name_en, nameBn: r.name_bn },
        ]),
      ),
      grades: new Map(
        grades.map((r) => [r.id, { code: r.code, name: r.name }]),
      ),
    };
  }
}
