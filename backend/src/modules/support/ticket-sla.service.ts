/**
 * The ticket SLA clock (WP28; spec §5 "SLA counted in working hours, excluding weekends
 * and holidays", acceptance: "a breach is raised on time from the SLA clock").
 *
 *   policies(companyId)        the company's hours per priority; the shipped defaults are
 *                              written the first time they are needed, so a ticket always
 *                              has a deadline
 *   deadlines(...)             first response and resolution deadlines, in working hours on
 *                              the assignee's branch calendar (the same arithmetic as
 *                              approval SLAs, ADR 0005)
 *   pushForWaiting(...)        the resolution deadline moves out by the working hours the
 *                              ticket waited for the customer: that delay is not the team's
 *   processDue()               the job: tickets past a deadline get ticket.sla_breached,
 *                              once per ticket per clock (UPDATE ... WHERE breached_at IS NULL)
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import {
  todayInDhaka,
  toBusinessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import {
  addWorkingHours,
  workingHoursBetween,
} from '../../platform/dates/working-time.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { TicketPriority } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { WorkCalendarService } from '../calendar/work-calendar.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { DEFAULT_SLA, hours, TICKET_PRIORITIES } from './support-rules.js';
import type { SlaPolicyDto } from './dto/support.dto.js';

export interface Deadlines {
  firstResponseDueAt: Date;
  resolutionDueAt: Date;
}

@Injectable()
export class TicketSlaService {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly calendar: WorkCalendarService,
    private readonly directory: EmployeeDirectory,
    private readonly outbox: OutboxService,
    private readonly org: OrgLookupService,
  ) {}

  // ================================================================ policy

  /** The company's SLA hours per priority, writing the shipped defaults if it has none. */
  async policies(
    companyId: string,
  ): Promise<
    Record<TicketPriority, { firstResponseHours: number; resolutionHours: number }>
  > {
    // a company of another tenant does not exist for this transaction (RLS), so this is
    // also what refuses the route to someone else's company
    await this.org.assertCompanyExists(companyId);
    const rows = await this.db.tx
      .selectFrom('support_sla_policies')
      .select(['priority', 'first_response_hours', 'resolution_hours'])
      .where('company_id', '=', companyId)
      .execute();
    const found = new Map(rows.map((r) => [r.priority, r]));
    const missing = TICKET_PRIORITIES.filter((p) => !found.has(p));
    if (missing.length) {
      await this.db.tx
        .insertInto('support_sla_policies')
        .values(
          missing.map((priority) => ({
            company_id: companyId,
            priority,
            first_response_hours: String(DEFAULT_SLA[priority].firstResponseHours),
            resolution_hours: String(DEFAULT_SLA[priority].resolutionHours),
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    }
    const out = {} as Record<
      TicketPriority,
      { firstResponseHours: number; resolutionHours: number }
    >;
    for (const priority of TICKET_PRIORITIES) {
      const row = found.get(priority);
      out[priority] = row
        ? {
            firstResponseHours: hours(row.first_response_hours),
            resolutionHours: hours(row.resolution_hours),
          }
        : { ...DEFAULT_SLA[priority] };
    }
    return out;
  }

  async setPolicies(companyId: string, dto: SlaPolicyDto) {
    await this.org.assertCompanyExists(companyId);
    for (const row of dto.rows) {
      if (row.resolutionHours < row.firstResponseHours)
        throw new BadRequestException(MSG.SLA_POLICY_INVALID);
      await this.db.tx
        .insertInto('support_sla_policies')
        .values({
          company_id: companyId,
          priority: row.priority,
          first_response_hours: row.firstResponseHours.toFixed(2),
          resolution_hours: row.resolutionHours.toFixed(2),
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'company_id', 'priority']).doUpdateSet({
            first_response_hours: row.firstResponseHours.toFixed(2),
            resolution_hours: row.resolutionHours.toFixed(2),
            updated_at: new Date(),
            updated_by: sql`app_current_user_id()`,
          }),
        )
        .execute();
    }
    return this.policies(companyId);
  }

  // ============================================================== deadlines

  /** Working-day checker on the assignee's branch (a company-wide ticket: the HQ calendar). */
  async checkerFor(
    assigneeId: string | null,
    from: BusinessDate,
  ): Promise<(date: BusinessDate) => boolean> {
    const branchId = assigneeId ? await this.branchOf(assigneeId) : null;
    return this.calendar.workingDayChecker(branchId, from);
  }

  async deadlines(
    companyId: string,
    priority: TicketPriority,
    from: Date,
    assigneeId: string | null,
  ): Promise<Deadlines> {
    const policy = (await this.policies(companyId))[priority];
    const isWorkingDay = await this.checkerFor(assigneeId, toBusinessDate(from));
    return {
      firstResponseDueAt: addWorkingHours(
        from,
        policy.firstResponseHours,
        isWorkingDay,
      ),
      resolutionDueAt: addWorkingHours(
        from,
        policy.resolutionHours,
        isWorkingDay,
      ),
    };
  }

  /**
   * The customer answered (or the team gave up waiting): the resolution deadline moves out
   * by the working hours spent waiting. The first-response clock is never pushed: it has
   * already been met by the time a ticket can wait for the customer.
   */
  async pushForWaiting(ticket: {
    assignee_id: string | null;
    waiting_since: Date | null;
    resolution_due_at: Date;
  }): Promise<Date> {
    if (!ticket.waiting_since) return ticket.resolution_due_at;
    const now = this.clock.now();
    const isWorkingDay = await this.checkerFor(
      ticket.assignee_id,
      toBusinessDate(ticket.waiting_since),
    );
    const waited = workingHoursBetween(ticket.waiting_since, now, isWorkingDay);
    if (waited <= 0) return ticket.resolution_due_at;
    return addWorkingHours(ticket.resolution_due_at, waited, isWorkingDay);
  }

  private async branchOf(userId: string): Promise<string | null> {
    const user = await this.db.tx
      .selectFrom('users')
      .select('employee_id')
      .where('id', '=', userId)
      .executeTakeFirst();
    if (!user?.employee_id) return null;
    const placement = await this.directory.currentOrFirstPlacement(
      user.employee_id,
    );
    return placement?.branchId ?? null;
  }

  // ==================================================================== job

  /**
   * Tickets whose deadline has passed: record the breach and publish
   * ticket.sla_breached. Each clock of each ticket is reported once, because the
   * UPDATE only matches a row whose breach column is still NULL.
   */
  async processDue(): Promise<{ firstResponse: number; resolution: number }> {
    const now = this.clock.now();
    const result = { firstResponse: 0, resolution: 0 };

    const late = await this.db.tx
      .selectFrom('support_tickets')
      .select([
        'id',
        'company_id',
        'number',
        'customer_id',
        'priority',
        'assignee_id',
        'first_response_due_at',
        'resolution_due_at',
        'first_response_at',
        'first_response_breached_at',
        'resolution_breached_at',
        'resolved_at',
        'state',
      ])
      .where('state', 'in', ['new', 'open', 'waiting_customer'])
      .where((eb) =>
        eb.or([
          eb.and([
            eb('first_response_at', 'is', null),
            eb('first_response_breached_at', 'is', null),
            eb('first_response_due_at', '<=', now),
          ]),
          eb.and([
            eb('resolved_at', 'is', null),
            eb('resolution_breached_at', 'is', null),
            eb('resolution_due_at', '<=', now),
          ]),
        ]),
      )
      .execute();

    for (const ticket of late) {
      const clocks: Array<'first_response' | 'resolution'> = [];
      if (
        !ticket.first_response_at &&
        !ticket.first_response_breached_at &&
        ticket.first_response_due_at <= now
      )
        clocks.push('first_response');
      if (
        !ticket.resolved_at &&
        !ticket.resolution_breached_at &&
        ticket.resolution_due_at <= now
      )
        clocks.push('resolution');

      for (const clock of clocks) {
        const column =
          clock === 'first_response'
            ? 'first_response_breached_at'
            : 'resolution_breached_at';
        const updated = await this.db.tx
          .updateTable('support_tickets')
          .set({ [column]: now })
          .where('id', '=', ticket.id)
          .where(column, 'is', null)
          .executeTakeFirst();
        if (updated.numUpdatedRows === 0n) continue; // someone else reported it

        const dueAt =
          clock === 'first_response'
            ? ticket.first_response_due_at
            : ticket.resolution_due_at;
        await this.outbox.add({
          type: 'ticket.sla_breached',
          entityId: ticket.id,
          payload: {
            ticketId: ticket.id,
            companyId: ticket.company_id,
            number: ticket.number,
            customerId: ticket.customer_id,
            priority: ticket.priority,
            assigneeId: ticket.assignee_id,
            clock,
            dueAt: dueAt.toISOString(),
          },
        });
        if (clock === 'first_response') result.firstResponse += 1;
        else result.resolution += 1;
      }
    }
    return result;
  }

  today(): BusinessDate {
    return todayInDhaka(this.clock.now());
  }
}
