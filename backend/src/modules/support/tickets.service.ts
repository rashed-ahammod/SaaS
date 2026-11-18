/**
 * Support tickets (Phase 3 WP28; spec §6.8 step 7 "tickets with priority and SLA, linked to
 * the customer").
 *
 *   create       customer + contact + category + priority (the category's by default); the
 *                SLA deadlines are set from the clock at once, and the ticket goes to the
 *                customer's account manager unless someone else is named
 *   message      a reply the customer sees, an internal note, or what the customer sent back.
 *                The first reply stops the response clock. A customer message while the
 *                ticket waits for them brings it back to "open" and moves the resolution
 *                deadline out by the hours waited.
 *   assign       hand it over (support.manage), to someone who may work tickets
 *   priority     changed with a reason; the deadlines are recomputed from the original clock,
 *                and a breach already recorded stays recorded
 *   wait         ask the customer something: the resolution clock stops
 *   resolve      with a resolution note (the database refuses a resolved ticket without one)
 *   close        the customer accepted it
 *   reopen       a resolved or closed ticket, with a reason; the clock starts again from now
 *
 * What the customer wrote (description, customer messages) is outside content: stored and
 * shown as text, never acted on (spec §8 guardrail 9).
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { fiscalYearOf, todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  SupportTicket,
  TicketPriority,
  TicketState,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { CustomersService } from '../crm/customers.service.js';
import { SupportAccess } from './support-access.js';
import { canMove, OPEN_STATES } from './support-rules.js';
import { TicketSlaService } from './ticket-sla.service.js';
import type {
  AssignTicketDto,
  PriorityDto,
  ReopenTicketDto,
  ResolveTicketDto,
  TicketDto,
  TicketMessageDto,
  TicketQueryDto,
  WaitDto,
} from './dto/support.dto.js';

@Injectable()
export class TicketsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly support: SupportAccess,
    private readonly sla: TicketSlaService,
    private readonly customers: CustomersService,
  ) {}

  // ================================================================== lists

  async list(companyId: string, query: TicketQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const scope = await this.support.listScope(companyId);
    let q = this.db.tx
      .selectFrom('support_tickets as t')
      .innerJoin('customers as c', 'c.id', 't.customer_id')
      .innerJoin('support_categories as g', 'g.id', 't.category_id')
      .select([
        't.id',
        't.number',
        't.subject',
        't.priority',
        't.state',
        't.assignee_id',
        't.first_response_due_at',
        't.resolution_due_at',
        't.first_response_at',
        't.first_response_breached_at',
        't.resolution_breached_at',
        't.resolved_at',
        't.created_at',
        'c.id as customer_id',
        'c.name as customer_name',
        'g.name as category_name',
      ])
      .where('t.company_id', '=', companyId)
      .orderBy('t.created_at', 'desc')
      .limit(500);

    if (!scope.all)
      q = q.where((eb) =>
        eb.or([
          eb('t.assignee_id', 'in', scope.assigneeIds),
          eb('c.account_manager_id', 'in', scope.assigneeIds),
        ]),
      );
    if (query.customerId) q = q.where('t.customer_id', '=', query.customerId);
    if (query.assigneeId) q = q.where('t.assignee_id', '=', query.assigneeId);
    if (query.priority) q = q.where('t.priority', '=', query.priority);
    if (query.state === 'open_only')
      q = q.where('t.state', 'in', OPEN_STATES);
    else if (query.state === 'breached')
      q = q.where((eb) =>
        eb.or([
          eb('t.first_response_breached_at', 'is not', null),
          eb('t.resolution_breached_at', 'is not', null),
        ]),
      );
    else if (query.state) q = q.where('t.state', '=', query.state);
    if (query.q) {
      const like = `%${query.q}%`;
      q = q.where((eb) =>
        eb.or([
          eb('t.number', 'ilike', like),
          eb('t.subject', 'ilike', like),
          eb('c.name', 'ilike', like),
        ]),
      );
    }
    const rows = await q.execute();
    return { tickets: rows.map((r) => this.toListRow(r)) };
  }

  async get(ticketId: string) {
    const ticket = await this.find(ticketId);
    await this.support.assertSee(ticket.company_id, ticket);
    const [customer, category, messages] = await Promise.all([
      this.db.tx
        .selectFrom('customers')
        .select(['id', 'code', 'name', 'name_bn', 'phone', 'account_manager_id'])
        .where('id', '=', ticket.customer_id)
        .executeTakeFirst(),
      this.db.tx
        .selectFrom('support_categories')
        .select(['id', 'code', 'name', 'name_bn'])
        .where('id', '=', ticket.category_id)
        .executeTakeFirst(),
      this.db.tx
        .selectFrom('support_ticket_messages')
        .select(['id', 'kind', 'body', 'author_id', 'created_at'])
        .where('ticket_id', '=', ticketId)
        .orderBy('created_at')
        .execute(),
    ]);
    const contact = ticket.contact_id
      ? await this.db.tx
          .selectFrom('customer_contacts')
          .select(['id', 'name', 'designation', 'phone'])
          .where('id', '=', ticket.contact_id)
          .executeTakeFirst()
      : null;
    return {
      ...this.toTicket(ticket),
      customer: customer ?? null,
      contact: contact ?? null,
      category: category ?? null,
      messages: messages.map((m) => ({
        id: m.id,
        kind: m.kind,
        body: m.body,
        authorId: m.author_id,
        at: m.created_at,
      })),
    };
  }

  /** The tickets on my desk, worst SLA first (the portal's "my tickets"). */
  async mine(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const me = this.access.current();
    if (!me.userId) throw new ForbiddenException(MSG.FORBIDDEN);
    const rows = await this.db.tx
      .selectFrom('support_tickets as t')
      .innerJoin('customers as c', 'c.id', 't.customer_id')
      .innerJoin('support_categories as g', 'g.id', 't.category_id')
      .select([
        't.id',
        't.number',
        't.subject',
        't.priority',
        't.state',
        't.assignee_id',
        't.first_response_due_at',
        't.resolution_due_at',
        't.first_response_at',
        't.first_response_breached_at',
        't.resolution_breached_at',
        't.resolved_at',
        't.created_at',
        'c.id as customer_id',
        'c.name as customer_name',
        'g.name as category_name',
      ])
      .where('t.company_id', '=', companyId)
      .where('t.assignee_id', '=', me.userId)
      .where('t.state', 'in', OPEN_STATES)
      .orderBy('t.resolution_due_at')
      .execute();
    return { tickets: rows.map((r) => this.toListRow(r)) };
  }

  // ============================================================= new ticket

  async create(companyId: string, dto: TicketDto) {
    await this.org.assertCompanyExists(companyId);
    const customer = await this.customers.find(dto.customerId);
    if (customer.company_id !== companyId)
      throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);

    const category = await this.db.tx
      .selectFrom('support_categories')
      .selectAll()
      .where('id', '=', dto.categoryId)
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!category)
      throw new NotFoundException(MSG.TICKET_CATEGORY_NOT_FOUND);

    if (dto.contactId) {
      const contact = await this.db.tx
        .selectFrom('customer_contacts')
        .select('id')
        .where('id', '=', dto.contactId)
        .where('customer_id', '=', dto.customerId)
        .executeTakeFirst();
      if (!contact) throw new BadRequestException(MSG.TICKET_CONTACT_INVALID);
    }

    // raising a ticket: support.manage, or a salesperson for their own customer
    const assigneeId =
      dto.assigneeId ?? customer.account_manager_id ?? this.access.current().userId;
    if (!(await this.support.canWork(companyId, {
      assignee_id: dto.assigneeId ?? customer.account_manager_id,
      customer_id: customer.id,
    })))
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (dto.assigneeId) {
      await this.support.assertManage(companyId, customer.account_manager_id);
      if (!(await this.support.canBeAssigned(companyId, dto.assigneeId)))
        throw new BadRequestException(MSG.TICKET_ASSIGNEE_INVALID);
    }

    const priority: TicketPriority = dto.priority ?? category.default_priority;
    const from = this.clock.now();
    const due = await this.sla.deadlines(
      companyId,
      priority,
      from,
      assigneeId ?? null,
    );

    const ticket = await this.db.tx
      .insertInto('support_tickets')
      .values({
        company_id: companyId,
        number: await this.nextNumber(companyId),
        customer_id: customer.id,
        contact_id: dto.contactId ?? null,
        category_id: category.id,
        subject: dto.subject,
        description: dto.description,
        priority,
        source: dto.source ?? 'phone',
        state: 'new',
        assignee_id: assigneeId ?? null,
        sla_from: from,
        first_response_due_at: due.firstResponseDueAt,
        resolution_due_at: due.resolutionDueAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await this.audit.record({
      action: 'ticket.created',
      entity: 'support_ticket',
      entityId: ticket.id,
      after: {
        number: ticket.number,
        customerId: ticket.customer_id,
        priority,
        assigneeId: ticket.assignee_id,
      },
    });
    await this.outbox.add({
      type: 'ticket.created',
      entityId: ticket.id,
      payload: {
        ticketId: ticket.id,
        companyId,
        number: ticket.number,
        customerId: ticket.customer_id,
        categoryCode: category.code,
        priority,
        assigneeId: ticket.assignee_id,
        createdBy: this.access.current().userId,
      },
    });
    return this.get(ticket.id);
  }

  // ================================================================ working

  async addMessage(ticketId: string, dto: TicketMessageDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertWork(ticket.company_id, ticket);
    if (ticket.state === 'closed')
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);

    await this.db.tx
      .insertInto('support_ticket_messages')
      .values({ ticket_id: ticketId, kind: dto.kind, body: dto.body })
      .execute();

    const now = this.clock.now();
    const patch: Record<string, unknown> = {};

    // the first reply to the customer stops the response clock
    if (dto.kind === 'reply' && !ticket.first_response_at)
      patch.first_response_at = now;
    // a reply moves a new ticket into work
    if (dto.kind === 'reply' && ticket.state === 'new') patch.state = 'open';
    // the customer answered: the team owns it again, and the wait is given back
    if (dto.kind === 'customer' && ticket.state === 'waiting_customer') {
      patch.state = 'open';
      patch.waiting_since = null;
      patch.resolution_due_at = await this.sla.pushForWaiting(ticket);
    }
    if (Object.keys(patch).length) await this.patch(ticketId, patch);

    await this.audit.record({
      action: `ticket.${dto.kind === 'note' ? 'note_added' : 'message_added'}`,
      entity: 'support_ticket',
      entityId: ticketId,
      after: { kind: dto.kind },
    });
    return this.get(ticketId);
  }

  async assign(ticketId: string, dto: AssignTicketDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertManage(
      ticket.company_id,
      await this.support.ownerOf(ticket),
    );
    if (!OPEN_STATES.includes(ticket.state))
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);
    if (!(await this.support.canBeAssigned(ticket.company_id, dto.assigneeId)))
      throw new BadRequestException(MSG.TICKET_ASSIGNEE_INVALID);

    await this.patch(ticketId, { assignee_id: dto.assigneeId });
    if (dto.note)
      await this.db.tx
        .insertInto('support_ticket_messages')
        .values({ ticket_id: ticketId, kind: 'note', body: dto.note })
        .execute();

    await this.audit.record({
      action: 'ticket.assigned',
      entity: 'support_ticket',
      entityId: ticketId,
      before: { assigneeId: ticket.assignee_id },
      after: { assigneeId: dto.assigneeId },
    });
    await this.outbox.add({
      type: 'ticket.assigned',
      entityId: ticketId,
      payload: {
        ticketId,
        companyId: ticket.company_id,
        number: ticket.number,
        customerId: ticket.customer_id,
        priority: ticket.priority,
        assigneeId: dto.assigneeId,
        assignedBy: this.access.current().userId,
      },
    });
    return this.get(ticketId);
  }

  /**
   * A new priority means new deadlines, counted from the ticket's own clock (so raising the
   * priority of an old ticket can put it past due at once, which is the point). A breach
   * already recorded is not undone: it happened.
   */
  async setPriority(ticketId: string, dto: PriorityDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertWork(ticket.company_id, ticket);
    if (!OPEN_STATES.includes(ticket.state))
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);
    if (ticket.priority === dto.priority) return this.get(ticketId);

    const due = await this.sla.deadlines(
      ticket.company_id,
      dto.priority,
      ticket.sla_from,
      ticket.assignee_id,
    );
    await this.patch(ticketId, {
      priority: dto.priority,
      first_response_due_at: due.firstResponseDueAt,
      resolution_due_at: due.resolutionDueAt,
    });
    await this.db.tx
      .insertInto('support_ticket_messages')
      .values({
        ticket_id: ticketId,
        kind: 'note',
        body: `Priority ${ticket.priority} -> ${dto.priority}: ${dto.reason}`,
      })
      .execute();
    await this.audit.record({
      action: 'ticket.priority_changed',
      entity: 'support_ticket',
      entityId: ticketId,
      before: { priority: ticket.priority },
      after: { priority: dto.priority, reason: dto.reason },
    });
    return this.get(ticketId);
  }

  /** Asked the customer something: the resolution clock stops until they answer. */
  async waitForCustomer(ticketId: string, dto: WaitDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertWork(ticket.company_id, ticket);
    if (!canMove(ticket.state, 'waiting_customer'))
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);

    const now = this.clock.now();
    await this.db.tx
      .insertInto('support_ticket_messages')
      .values({ ticket_id: ticketId, kind: 'reply', body: dto.question })
      .execute();
    await this.patch(ticketId, {
      state: 'waiting_customer',
      waiting_since: now,
      ...(ticket.first_response_at ? {} : { first_response_at: now }),
    });
    await this.audit.record({
      action: 'ticket.waiting_customer',
      entity: 'support_ticket',
      entityId: ticketId,
      after: { since: now.toISOString() },
    });
    return this.get(ticketId);
  }

  async resolve(ticketId: string, dto: ResolveTicketDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertWork(ticket.company_id, ticket);
    if (!canMove(ticket.state, 'resolved'))
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);

    const now = this.clock.now();
    await this.patch(ticketId, {
      state: 'resolved',
      resolved_at: now,
      resolution_note: dto.resolution,
      waiting_since: null,
      ...(ticket.first_response_at ? {} : { first_response_at: now }),
    });
    await this.db.tx
      .insertInto('support_ticket_messages')
      .values({ ticket_id: ticketId, kind: 'reply', body: dto.resolution })
      .execute();
    await this.audit.record({
      action: 'ticket.resolved',
      entity: 'support_ticket',
      entityId: ticketId,
      before: { state: ticket.state },
      after: { resolution: dto.resolution },
    });
    return this.get(ticketId);
  }

  async close(ticketId: string) {
    const ticket = await this.find(ticketId);
    await this.support.assertWork(ticket.company_id, ticket);
    if (!canMove(ticket.state, 'closed'))
      throw new BadRequestException(MSG.TICKET_WRONG_STATE);
    await this.patch(ticketId, {
      state: 'closed',
      closed_at: this.clock.now(),
    });
    await this.audit.record({
      action: 'ticket.closed',
      entity: 'support_ticket',
      entityId: ticketId,
      after: { state: 'closed' },
    });
    return this.get(ticketId);
  }

  /** The problem came back: the same ticket, a fresh clock, and the count kept. */
  async reopen(ticketId: string, dto: ReopenTicketDto) {
    const ticket = await this.find(ticketId);
    await this.support.assertManage(
      ticket.company_id,
      await this.support.ownerOf(ticket),
    );
    if (!canMove(ticket.state, 'open'))
      throw new BadRequestException(MSG.TICKET_NOT_REOPENABLE);

    const from = this.clock.now();
    const due = await this.sla.deadlines(
      ticket.company_id,
      ticket.priority,
      from,
      ticket.assignee_id,
    );
    await this.patch(ticketId, {
      state: 'open',
      sla_from: from,
      first_response_due_at: due.firstResponseDueAt,
      resolution_due_at: due.resolutionDueAt,
      first_response_at: null,
      first_response_breached_at: null,
      resolution_breached_at: null,
      resolved_at: null,
      resolution_note: null,
      closed_at: null,
      waiting_since: null,
      reopened_count: ticket.reopened_count + 1,
    });
    await this.db.tx
      .insertInto('support_ticket_messages')
      .values({
        ticket_id: ticketId,
        kind: 'note',
        body: `Reopened: ${dto.reason}`,
      })
      .execute();
    await this.audit.record({
      action: 'ticket.reopened',
      entity: 'support_ticket',
      entityId: ticketId,
      before: { state: ticket.state },
      after: { reason: dto.reason, reopenedCount: ticket.reopened_count + 1 },
    });
    await this.outbox.add({
      type: 'ticket.created',
      entityId: ticketId,
      payload: {
        ticketId,
        companyId: ticket.company_id,
        number: ticket.number,
        customerId: ticket.customer_id,
        priority: ticket.priority,
        assigneeId: ticket.assignee_id,
        reopened: true,
      },
    });
    return this.get(ticketId);
  }

  // ================================================================ helpers

  async find(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.db.tx
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', ticketId)
      .executeTakeFirst();
    if (!ticket) throw new NotFoundException(MSG.TICKET_NOT_FOUND);
    return ticket;
  }

  /** Tickets of one customer, for the Customer 360 page. */
  async ofCustomer(customerId: string) {
    const rows = await this.db.tx
      .selectFrom('support_tickets as t')
      .innerJoin('support_categories as g', 'g.id', 't.category_id')
      .select([
        't.id',
        't.number',
        't.subject',
        't.priority',
        't.state',
        't.resolution_due_at',
        't.resolution_breached_at',
        't.resolved_at',
        't.created_at',
        'g.name as category_name',
      ])
      .where('t.customer_id', '=', customerId)
      .orderBy('t.created_at', 'desc')
      .limit(50)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      subject: r.subject,
      priority: r.priority,
      state: r.state,
      categoryName: r.category_name,
      resolutionDueAt: r.resolution_due_at,
      breached: !!r.resolution_breached_at,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    }));
  }

  private async patch(ticketId: string, values: Record<string, unknown>) {
    await this.db.tx
      .updateTable('support_tickets')
      .set({ ...values, version: sql`version + 1` } as never)
      .where('id', '=', ticketId)
      .execute();
  }

  private async nextNumber(companyId: string): Promise<string> {
    const fy = fiscalYearOf(todayInDhaka(this.clock.now()), '07-01');
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'ticket',
        fiscal_year_code: fy,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `T/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toTicket(t: SupportTicket) {
    return {
      id: t.id,
      number: t.number,
      companyId: t.company_id,
      customerId: t.customer_id,
      categoryId: t.category_id,
      subject: t.subject,
      description: t.description,
      priority: t.priority,
      source: t.source,
      state: t.state,
      assigneeId: t.assignee_id,
      sla: {
        from: t.sla_from,
        firstResponseDueAt: t.first_response_due_at,
        resolutionDueAt: t.resolution_due_at,
        firstResponseAt: t.first_response_at,
        firstResponseBreached: !!t.first_response_breached_at,
        resolutionBreached: !!t.resolution_breached_at,
        waitingSince: t.waiting_since,
      },
      resolvedAt: t.resolved_at,
      resolutionNote: t.resolution_note,
      closedAt: t.closed_at,
      reopenedCount: t.reopened_count,
      createdAt: t.created_at,
      version: t.version,
    };
  }

  private toListRow(r: {
    id: string;
    number: string;
    subject: string;
    priority: TicketPriority;
    state: TicketState;
    assignee_id: string | null;
    customer_id: string;
    customer_name: string;
    category_name: string;
    first_response_due_at: Date;
    resolution_due_at: Date;
    first_response_at: Date | null;
    first_response_breached_at: Date | null;
    resolution_breached_at: Date | null;
    resolved_at: Date | null;
    created_at: Date;
  }) {
    return {
      id: r.id,
      number: r.number,
      subject: r.subject,
      priority: r.priority,
      state: r.state,
      assigneeId: r.assignee_id,
      customerId: r.customer_id,
      customerName: r.customer_name,
      categoryName: r.category_name,
      firstResponseDueAt: r.first_response_due_at,
      resolutionDueAt: r.resolution_due_at,
      firstResponseAt: r.first_response_at,
      breached:
        !!r.first_response_breached_at || !!r.resolution_breached_at,
      resolvedAt: r.resolved_at,
      createdAt: r.created_at,
    };
  }
}
