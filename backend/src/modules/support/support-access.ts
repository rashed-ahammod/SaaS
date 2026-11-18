/**
 * Who may see and work a ticket (WP28; spec §4 scopes).
 *
 * A ticket belongs to the person it is assigned to, and before that to the customer's
 * account manager. The scope check runs on that person's employee record, exactly as it
 * does for a lead or a customer (CrmAccess), so:
 *
 *   Admin (company scope)        every ticket of the company
 *   Dept Head (department)       the tickets of their department's people
 *   Sales user (own scope)       the tickets assigned to them
 *   Auditor (company, read-only) every ticket, read-only
 *
 *   assertSee / assertWork       reading, or replying, resolving and assigning
 *   listScope(companyId)         for lists: everything, or the assignees the user may see
 */
import { ForbiddenException, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AccessService } from '../identity/access/access.service.js';
import { CrmAccess } from '../crm/crm-access.js';

export interface TicketScope {
  all: boolean;
  /** when not all: tickets assigned to these users (or unassigned ones of their customers) */
  assigneeIds: string[];
}

@Injectable()
export class SupportAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly crm: CrmAccess,
  ) {}

  /** The person a ticket hangs on: its assignee, else the customer's account manager. */
  async ownerOf(ticket: {
    assignee_id: string | null;
    customer_id: string;
  }): Promise<string | null> {
    if (ticket.assignee_id) return ticket.assignee_id;
    const customer = await this.db.tx
      .selectFrom('customers')
      .select('account_manager_id')
      .where('id', '=', ticket.customer_id)
      .executeTakeFirst();
    return customer?.account_manager_id ?? null;
  }

  async canSee(
    companyId: string,
    ticket: { assignee_id: string | null; customer_id: string },
  ): Promise<boolean> {
    const r = await this.crm.resourceOf(
      companyId,
      await this.ownerOf(ticket),
    );
    return (
      this.access.allows('support.view', r) ||
      this.access.allows('support.manage', r) ||
      this.access.allows('support.own', r)
    );
  }

  async canWork(
    companyId: string,
    ticket: { assignee_id: string | null; customer_id: string },
  ): Promise<boolean> {
    const r = await this.crm.resourceOf(
      companyId,
      await this.ownerOf(ticket),
    );
    return (
      this.access.allows('support.manage', r) ||
      this.access.allows('support.own', r)
    );
  }

  async assertSee(
    companyId: string,
    ticket: { assignee_id: string | null; customer_id: string },
  ) {
    if (!(await this.canSee(companyId, ticket)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  async assertWork(
    companyId: string,
    ticket: { assignee_id: string | null; customer_id: string },
  ) {
    if (!(await this.canWork(companyId, ticket)))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  /** Handing a ticket to someone else, reopening one, and the settings: support.manage. */
  async assertManage(companyId: string, ownerId: string | null) {
    const r = await this.crm.resourceOf(companyId, ownerId);
    if (!this.access.allows('support.manage', r))
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  async listScope(companyId: string): Promise<TicketScope> {
    const company = { companyId };
    if (
      this.access.allows('support.view', company) ||
      this.access.allows('support.manage', company)
    )
      return { all: true, assigneeIds: [] };

    const assigneeIds = new Set<string>();
    const me = this.access.current();
    if (me.userId && me.has('support.own')) assigneeIds.add(me.userId);
    const filter = this.access.scopeFilter('support.view');
    const departments = filter.all ? [] : filter.departmentIds;
    if (departments.length) {
      const today = todayInDhaka();
      const rows = await this.db.tx
        .selectFrom('users as u')
        .innerJoin('employee_assignments as a', 'a.employee_id', 'u.employee_id')
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
      rows.forEach((r) => assigneeIds.add(r.id));
    }
    if (!assigneeIds.size) throw new ForbiddenException(MSG.FORBIDDEN);
    return { all: false, assigneeIds: [...assigneeIds] };
  }

  /** Someone a ticket may be handed to: they must be able to work tickets themselves. */
  async canBeAssigned(companyId: string, userId: string): Promise<boolean> {
    const grants = await this.access.load(userId);
    const r = await this.crm.resourceOf(companyId, userId);
    return grants.allows('support.own', r) || grants.allows('support.manage', r);
  }
}
