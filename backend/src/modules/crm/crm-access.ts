/**
 * Who may see and work a lead or customer (spec §4 "CRM pipeline": Admin V company,
 * Dept Head V dept, Sales users O; Accounts reads customers for credit terms).
 *
 * A record belongs to its owner (a lead's owner, a customer's account manager). The owner is a
 * user; the scope check runs on the owner's employee record: their company, their current
 * department (the Sales head's department scope), and themself (the Sales user's own scope).
 *
 *   resourceOf(companyId, ownerId)   the access resource of a record
 *   canSee / canWork                 view, or change (log activities, edit, qualify)
 *   listScope(companyId)             for lists: everything, or the owners the user may see
 *   salespeople / assertSalesperson  the company's Sales users: who may own a lead, customer or
 *                                    opportunity (the Admin too)
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sql } from 'kysely';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import type { AccessResource } from '../identity/access/access-grants.js';
import { AccessService } from '../identity/access/access.service.js';

export interface ListScope {
  all: boolean;
  /** when not all: records owned by these users */
  ownerIds: string[];
}

@Injectable()
export class CrmAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
  ) {}

  async resourceOf(
    companyId: string,
    ownerId: string | null,
  ): Promise<AccessResource> {
    if (!ownerId) return { companyId };
    const today = todayInDhaka();
    const row = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employee_assignments as a', (j) =>
        j
          .onRef('a.employee_id', '=', 'u.employee_id')
          .on('a.effective_from', '<=', today)
          .on((eb) =>
            eb.or([
              eb('a.effective_to', 'is', null),
              eb('a.effective_to', '>', today),
            ]),
          ),
      )
      .select(['u.employee_id', 'a.department_id'])
      .where('u.id', '=', ownerId)
      .executeTakeFirst();
    return {
      companyId,
      employeeId: row?.employee_id ?? undefined,
      departmentId: row?.department_id ?? undefined,
    };
  }

  async canSee(
    companyId: string,
    ownerId: string | null,
    opts: { customer?: boolean } = {},
  ): Promise<boolean> {
    const r = await this.resourceOf(companyId, ownerId);
    return (
      this.access.allows('crm.view', r) ||
      this.access.allows('crm.manage', r) ||
      this.access.allows('crm.own', r) ||
      (!!opts.customer && this.access.allows('crm.credit', { companyId }))
    );
  }

  async canWork(companyId: string, ownerId: string | null): Promise<boolean> {
    const r = await this.resourceOf(companyId, ownerId);
    return (
      this.access.allows('crm.own', r) ||
      this.access.allows('crm.manage', r) ||
      this.access.allows('crm.assign', r)
    );
  }

  async assertSee(
    companyId: string,
    ownerId: string | null,
    opts: { customer?: boolean } = {},
  ) {
    if (!(await this.canSee(companyId, ownerId, opts)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  async assertWork(companyId: string, ownerId: string | null) {
    if (!(await this.canWork(companyId, ownerId)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  /** May hand a record to someone else (Sales head within the department, Admin anywhere). */
  async assertAssign(companyId: string, ownerId: string | null) {
    const r = await this.resourceOf(companyId, ownerId);
    if (
      !this.access.allows('crm.assign', r) &&
      !this.access.allows('crm.manage', r)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  async listScope(
    companyId: string,
    opts: { customer?: boolean } = {},
  ): Promise<ListScope> {
    const company = { companyId };
    if (
      this.access.allows('crm.view', company) ||
      this.access.allows('crm.manage', company) ||
      (opts.customer && this.access.allows('crm.credit', company))
    ) {
      return { all: true, ownerIds: [] };
    }
    const ownerIds = new Set<string>();
    const me = this.access.current();
    if (me.userId && me.has('crm.own')) ownerIds.add(me.userId);
    const filter = this.access.scopeFilter('crm.view');
    const departments = filter.all ? [] : filter.departmentIds;
    if (departments.length) {
      const today = todayInDhaka();
      const rows = await this.db.tx
        .selectFrom('users as u')
        .innerJoin(
          'employee_assignments as a',
          'a.employee_id',
          'u.employee_id',
        )
        .select('u.id')
        .where('a.department_id', 'in', departments)
        .where('a.effective_from', '<=', today)
        .where((eb) =>
          eb.or([
            eb('a.effective_to', 'is', null),
            eb('a.effective_to', '>', today),
          ]),
        )
        .execute();
      rows.forEach((r) => ownerIds.add(r.id));
    }
    if (!ownerIds.size) throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, ownerIds: [...ownerIds] };
  }

  /** The company's active Sales users (role "sales", employee of the company). */
  async salespeople(companyId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('user_roles as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .innerJoin('employees as e', 'e.id', 'u.employee_id')
      .select('u.id')
      .where('r.system_role', '=', 'sales')
      .where('r.revoked_at', 'is', null)
      .where((eb) =>
        eb.or([
          eb('r.expires_at', 'is', null),
          eb('r.expires_at', '>', sql<Date>`now()`),
        ]),
      )
      .where('u.status', '=', 'active')
      .where('e.company_id', '=', companyId)
      .where('e.status', '<>', 'separated')
      .execute();
    return [...new Set(rows.map((r) => r.id))];
  }

  /** A named owner must be a Sales user of the company (or its Admin). */
  async assertSalesperson(companyId: string, userId: string) {
    if ((await this.salespeople(companyId)).includes(userId)) return;
    const admins = await this.access.usersWithSystemRole('admin', {
      companyId,
    });
    if (!admins.includes(userId))
      throw new BadRequestException(MSG.CRM_OWNER_INVALID);
  }
}
