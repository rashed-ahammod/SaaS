/**
 * Facts about employees that other modules need for routing work, without
 * reading the employee tables themselves (guide §3). Used by the approval engine.
 */
import { Injectable } from '@nestjs/common';
import {
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';

export interface PlacementFacts {
  employeeId: string;
  companyId: string;
  branchId: string;
  departmentId: string;
  gradeId: string;
  designationId: string;
  lineManagerId: string | null;
}

@Injectable()
export class EmployeeDirectory {
  constructor(private readonly db: DatabaseService) {}

  /** Where the employee sits on a date (default today); undefined if not employed then. */
  async placementOn(
    employeeId: string,
    date: BusinessDate = todayInDhaka(),
  ): Promise<PlacementFacts | undefined> {
    const row = await this.db.tx
      .selectFrom('employee_assignments')
      .select([
        'employee_id',
        'company_id',
        'branch_id',
        'department_id',
        'grade_id',
        'designation_id',
        'line_manager_id',
      ])
      .where('employee_id', '=', employeeId)
      .where('effective_from', '<=', date)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', date)]),
      )
      .executeTakeFirst();
    return row
      ? {
          employeeId: row.employee_id,
          companyId: row.company_id,
          branchId: row.branch_id,
          departmentId: row.department_id,
          gradeId: row.grade_id,
          designationId: row.designation_id,
          lineManagerId: row.line_manager_id,
        }
      : undefined;
  }

  /**
   * Today's placement, or the first one for someone who has not joined yet
   * (a request about a new joiner still needs routing).
   */
  async currentOrFirstPlacement(
    employeeId: string,
  ): Promise<PlacementFacts | undefined> {
    const today = await this.placementOn(employeeId);
    if (today) return today;
    const first = await this.db.tx
      .selectFrom('employee_assignments')
      .select('effective_from')
      .where('employee_id', '=', employeeId)
      .orderBy('effective_from')
      .executeTakeFirst();
    return first
      ? this.placementOn(employeeId, first.effective_from as BusinessDate)
      : undefined;
  }

  /** Employees with a placement covering the date, optionally in one company or set of branches. */
  async employedOn(
    date: BusinessDate,
    filter: { companyId?: string; branchIds?: string[] } = {},
  ): Promise<PlacementFacts[]> {
    let q = this.db.tx
      .selectFrom('employee_assignments')
      .select([
        'employee_id',
        'company_id',
        'branch_id',
        'department_id',
        'grade_id',
        'designation_id',
        'line_manager_id',
      ])
      .where('effective_from', '<=', date)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', date)]),
      );
    if (filter.companyId) q = q.where('company_id', '=', filter.companyId);
    if (filter.branchIds)
      q = q.where(
        'branch_id',
        'in',
        filter.branchIds.length
          ? filter.branchIds
          : ['00000000-0000-0000-0000-000000000000'],
      );
    const rows = await q.execute();
    return rows.map((r) => ({
      employeeId: r.employee_id,
      companyId: r.company_id,
      branchId: r.branch_id,
      departmentId: r.department_id,
      gradeId: r.grade_id,
      designationId: r.designation_id,
      lineManagerId: r.line_manager_id,
    }));
  }

  /** Employees of a company by code (data migration): code -> id and join date. */
  async byCode(
    companyId: string,
  ): Promise<Map<string, { id: string; joinDate: string }>> {
    const rows = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'employee_code', 'join_date'])
      .where('company_id', '=', companyId)
      .execute();
    return new Map(
      rows.map((r) => [r.employee_code, { id: r.id, joinDate: r.join_date }]),
    );
  }

  /** Employees of a company counted at a date: joined, not draft, not separated before it. */
  async onPayrollOn(companyId: string, date: BusinessDate): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('employees')
      .select('id')
      .where('company_id', '=', companyId)
      .where('status', '<>', 'draft')
      .where('join_date', '<=', date)
      .where((eb) =>
        eb.or([
          eb('last_working_day', 'is', null),
          eb('last_working_day', '>=', date),
        ]),
      )
      .execute();
    return rows.map((r) => r.id);
  }

  /** An active document of this employee (e.g. a medical certificate attached to sick leave)? */
  async hasDocument(employeeId: string, documentId: string): Promise<boolean> {
    const row = await this.db.tx
      .selectFrom('employee_documents')
      .select('id')
      .where('id', '=', documentId)
      .where('employee_id', '=', employeeId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    return row !== undefined;
  }

  async companyOf(employeeId: string): Promise<string | undefined> {
    const row = await this.db.tx
      .selectFrom('employees')
      .select('company_id')
      .where('id', '=', employeeId)
      .executeTakeFirst();
    return row?.company_id;
  }
}
