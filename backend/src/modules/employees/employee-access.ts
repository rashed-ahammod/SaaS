/**
 * Access checks for one employee record, shared by the employee services.
 *
 *   const employee = await this.employeeAccess.check('employee.manage', employeeId);
 *
 * finds the employee (404 if missing) and checks the current user's permission
 * against where the employee sits: company, department today, and the employee
 * itself (for "own" scope). Throws 403 if not allowed.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Employee } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import type { AccessResource } from '../identity/access/access-grants.js';
import { AccessService } from '../identity/access/access.service.js';
import type { PermissionKey } from '../identity/access/permissions.js';

@Injectable()
export class EmployeeAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
  ) {}

  /** Find the employee and check the permission on it. */
  async check(
    permission: PermissionKey,
    employeeId: string,
  ): Promise<Employee> {
    const employee = await this.find(employeeId);
    this.access.assert(permission, await this.resourceOf(employee));
    return employee;
  }

  async find(employeeId: string): Promise<Employee> {
    const employee = await this.db.tx
      .selectFrom('employees')
      .selectAll()
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    return employee;
  }

  /**
   * Where the employee sits for access checks: the department of today's
   * placement, or of the first placement for someone who has not joined yet.
   */
  async resourceOf(employee: Employee): Promise<AccessResource> {
    const today = todayInDhaka();
    const placement = await this.db.tx
      .selectFrom('employee_assignments')
      .select(['department_id', 'effective_from'])
      .where('employee_id', '=', employee.id)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', today)]),
      )
      .orderBy('effective_from')
      .execute();
    const current =
      placement.find((p) => p.effective_from <= today) ?? placement[0];
    return {
      companyId: employee.company_id,
      departmentId: current?.department_id ?? null,
      employeeId: employee.id,
    };
  }
}
