/**
 * Department tree (spec §3) with a closure table (guide §7.1).
 *
 * department_paths holds one row per (ancestor, descendant) pair:
 *
 *   Head Office            HO->HO 0
 *   └─ Sales               HO->SALES 1, SALES->SALES 0
 *      └─ Sales Dhaka      HO->SD 2, SALES->SD 1, SD->SD 0
 *
 * "Everything under Sales" is then one query: descendants of SALES. WP2 uses it
 * for Department-scope permissions ("a Dept Head sees their department and below").
 * Only this service writes department_paths.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { auditDiff } from '../../platform/audit/audit-diff.js';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import {
  assertUpdated,
  assertVersion,
  changesOnly,
} from '../../platform/db/optimistic-lock.js';
import type { Department } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { CompaniesService } from './companies.service.js';
import type {
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from './dto/org.dto.js';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly companies: CompaniesService,
    private readonly access: AccessService,
  ) {}

  async createDepartment(companyId: string, dto: CreateDepartmentDto) {
    // check company and parent
    await this.companies.findCompany(companyId);
    this.access.assert('org.structure.manage', { companyId });
    if (dto.parentId)
      await this.findDepartmentInCompany(dto.parentId, companyId);

    // save department
    const department = await this.db.tx
      .insertInto('departments')
      .values({
        company_id: companyId,
        parent_id: dto.parentId ?? null,
        code: dto.code,
        name: dto.name.trim(),
        cost_centre_code: dto.costCentreCode ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // add its paths: itself (depth 0) + every ancestor of the parent (one level deeper)
    await sql`
      INSERT INTO department_paths (ancestor_id, descendant_id, depth)
      SELECT ${department.id}::uuid, ${department.id}::uuid, 0
      UNION ALL
      SELECT ancestor_id, ${department.id}::uuid, depth + 1
        FROM department_paths
       WHERE descendant_id = ${dto.parentId ?? null}::uuid`.execute(this.db.tx);

    await this.audit.record({
      action: 'department.created',
      entity: 'department',
      entityId: department.id,
      after: toDepartmentResponse(department),
    });
    return toDepartmentResponse(department);
  }

  /** All departments of a company in tree order (parents before children), each with its depth. */
  async listDepartments(companyId: string) {
    await this.companies.findCompany(companyId);
    const departments = await this.db.tx
      .selectFrom('departments')
      .selectAll()
      .where('company_id', '=', companyId)
      .execute();

    // order as a tree: depth-first, siblings by name
    const children = new Map<string | null, Department[]>();
    for (const d of departments) {
      const list = children.get(d.parent_id) ?? [];
      list.push(d);
      children.set(d.parent_id, list);
    }
    const ordered: Array<
      ReturnType<typeof toDepartmentResponse> & { depth: number }
    > = [];
    const visit = (parentId: string | null, depth: number) => {
      for (const d of (children.get(parentId) ?? []).sort((a, b) =>
        a.name.localeCompare(b.name),
      )) {
        ordered.push({ ...toDepartmentResponse(d), depth });
        visit(d.id, depth + 1);
      }
    };
    visit(null, 0);
    return ordered;
  }

  async getDepartment(id: string) {
    return toDepartmentResponse(await this.findDepartment(id));
  }

  async updateDepartment(id: string, dto: UpdateDepartmentDto) {
    // find and check version
    const before = await this.findDepartment(id);
    this.access.assert('org.structure.manage', {
      companyId: before.company_id,
    });
    assertVersion(before, dto.version);

    // moving to a new parent?
    const isMove =
      dto.parentId !== undefined && dto.parentId !== before.parent_id;
    if (isMove && dto.parentId) {
      await this.findDepartmentInCompany(dto.parentId, before.company_id);
      if (await this.isInSubtree(dto.parentId, id))
        throw new BadRequestException(MSG.DEPARTMENT_CYCLE);
    }

    // collect the fields that were sent (the head must be an employee of the same
    // company: enforced by the database foreign key)
    const changes = changesOnly({
      code: dto.code,
      name: dto.name?.trim(),
      cost_centre_code: dto.costCentreCode,
      parent_id: dto.parentId,
      head_employee_id: dto.headEmployeeId,
      is_active: dto.isActive,
    });
    if (!changes) return toDepartmentResponse(before);

    // save
    const result = await this.db.tx
      .updateTable('departments')
      .set(changes)
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .executeTakeFirst();
    assertUpdated(result);
    if (isMove) await this.movePaths(id, dto.parentId ?? null);

    const after = await this.findDepartment(id);
    await this.audit.record({
      action: 'department.updated',
      entity: 'department',
      entityId: id,
      ...auditDiff(before, after),
    });
    return toDepartmentResponse(after);
  }

  /** Ids of a department and everything below it. */
  async descendantIds(departmentId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('department_paths')
      .select('descendant_id')
      .where('ancestor_id', '=', departmentId)
      .execute();
    return rows.map((r) => r.descendant_id);
  }

  async findDepartment(id: string): Promise<Department> {
    const department = await this.db.tx
      .selectFrom('departments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!department) throw new NotFoundException(MSG.DEPARTMENT_NOT_FOUND);
    return department;
  }

  // ------------------------------------------------------------------ helpers

  private async findDepartmentInCompany(
    id: string,
    companyId: string,
  ): Promise<Department> {
    const department = await this.findDepartment(id);
    if (department.company_id !== companyId)
      throw new NotFoundException(MSG.DEPARTMENT_NOT_FOUND);
    return department;
  }

  /** Is `candidateId` the department `rootId` itself or somewhere below it? */
  private async isInSubtree(
    candidateId: string,
    rootId: string,
  ): Promise<boolean> {
    const row = await this.db.tx
      .selectFrom('department_paths')
      .select('depth')
      .where('ancestor_id', '=', rootId)
      .where('descendant_id', '=', candidateId)
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Re-hang a subtree under a new parent:
   *   1. forget the links between the subtree and its old ancestors;
   *   2. link every new ancestor to every member of the subtree.
   * Links inside the subtree stay as they are.
   */
  private async movePaths(
    departmentId: string,
    newParentId: string | null,
  ): Promise<void> {
    await sql`
      DELETE FROM department_paths
       WHERE descendant_id IN (SELECT descendant_id FROM department_paths WHERE ancestor_id = ${departmentId}::uuid)
         AND ancestor_id NOT IN (SELECT descendant_id FROM department_paths WHERE ancestor_id = ${departmentId}::uuid)`.execute(
      this.db.tx,
    );

    if (newParentId) {
      await sql`
        INSERT INTO department_paths (ancestor_id, descendant_id, depth)
        SELECT above.ancestor_id, below.descendant_id, above.depth + below.depth + 1
          FROM department_paths above
         CROSS JOIN department_paths below
         WHERE above.descendant_id = ${newParentId}::uuid
           AND below.ancestor_id = ${departmentId}::uuid`.execute(this.db.tx);
    }
  }
}

export function toDepartmentResponse(d: Department) {
  return {
    id: d.id,
    companyId: d.company_id,
    parentId: d.parent_id,
    code: d.code,
    name: d.name,
    costCentreCode: d.cost_centre_code,
    headEmployeeId: d.head_employee_id,
    isActive: d.is_active,
    version: d.version,
  };
}
