/**
 * Notifications (WP10, spec §9): the core decides who gets what; n8n carries it.
 *
 *   plan(eventId)    turn one outbox event into messages: recipients, language,
 *                    text, channels. Stored ONCE: a second plan of the same event
 *                    finds the event in notification_events and does nothing, and
 *                    the unique key (event, kind, recipient, channel) is the
 *                    last line of defence.
 *   claim(eventId)   for n8n: plan if needed, then hand out the e-mail / SMS
 *                    messages not sent yet. Sent ones are never handed out again,
 *                    so replaying an event (dispatcher retry, admin replay, n8n
 *                    re-run) cannot send a duplicate. A claim older than 10 minutes
 *                    (n8n stopped half way) and failed ones (< 5 attempts) come back.
 *   report(id, ...)  n8n's result per message (provider, message id, error).
 *   inbox            in-app messages for the signed-in user (employee app bell).
 *
 * In-app messages are delivered here directly (status sent), and the worker
 * plans recent events even when n8n is not configured, so the in-app inbox
 * works on its own.
 *
 * Reads facts from other modules' tables read-only (approval requests, users,
 * employees, attendance days, payroll results) to build the texts; it writes
 * only its own tables.
 */
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../../config/config.js';
import { Clock } from '../../platform/clock.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Notification } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { PayrollRunsService } from '../payroll/payroll-runs.service.js';
import type { ReportResultDto } from './dto/notifications.dto.js';
import {
  CHANNELS,
  TEMPLATES,
  type Kind,
  type Lang,
  type Text,
} from './templates.js';

const CLAIM_TIMEOUT_MINUTES = 10;
const MAX_ATTEMPTS = 5;

/** Events that produce messages. Everything else is planned as "nothing to send". */
export const NOTIFIED_EVENTS = [
  'approval.pending',
  'approval.sla_breached',
  'payroll.disbursed',
  'attendance.daily_closed',
  'leave.approved',
  'leave.rejected',
  'employee.probation_ending',
  'budget.threshold_reached',
  'compliance.due_soon',
  'compliance.overdue',
  'lead.created',
  'lead.assigned',
  'invoice.overdue',
];

interface Recipient {
  key: string; // user:<id> | employee:<id>
  userId: string | null;
  employeeId: string | null;
  email: string | null;
  phone: string | null;
  language: Lang;
}

interface Planned {
  kind: Kind;
  recipient: Recipient;
  text: Text;
  link: string;
  attachment?: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly org: OrgLookupService,
    private readonly payroll: PayrollRunsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: AccessService,
  ) {}

  // =================================================================== plan

  /** Turn an outbox event into messages, once. Returns how many messages exist for it. */
  async plan(eventId: string): Promise<number> {
    const done = await this.db.tx
      .selectFrom('notification_events')
      .select('messages')
      .where('event_id', '=', eventId)
      .executeTakeFirst();
    if (done) return done.messages;

    const event = await this.db.tx
      .selectFrom('outbox_events')
      .select(['id', 'type', 'payload'])
      .where('id', '=', eventId)
      .executeTakeFirst();
    if (!event) throw new NotFoundException('Event not found');

    // who gets what
    const planned = NOTIFIED_EVENTS.includes(event.type)
      ? await this.messagesFor(
          event.type,
          event.payload as Record<string, unknown>,
        )
      : [];
    let count = 0;
    for (const p of planned) {
      for (const channel of CHANNELS[p.kind]) {
        const address =
          channel === 'email'
            ? p.recipient.email
            : channel === 'sms'
              ? p.recipient.phone
              : null;
        if (channel === 'in_app' ? !p.recipient.userId : !address) continue; // no inbox / no address: that channel is skipped
        if (channel === 'sms' && !p.text.sms) continue;
        const inserted = await this.db.tx
          .insertInto('notifications')
          .values({
            event_id: event.id,
            event_type: event.type,
            kind: p.kind,
            recipient_key: p.recipient.key,
            user_id: p.recipient.userId,
            employee_id: p.recipient.employeeId,
            channel,
            address,
            language: p.recipient.language,
            subject: p.text.subject,
            // SMS: the short text; in-app for a message with an attachment: the short text too (nothing is attached there)
            body:
              channel === 'sms' ||
              (channel === 'in_app' && p.attachment && p.text.sms)
                ? p.text.sms
                : p.text.body,
            link: p.link,
            attachment:
              channel === 'email' && p.attachment
                ? JSON.stringify(p.attachment)
                : null,
            // in-app is delivered by storing it
            status: channel === 'in_app' ? 'sent' : 'queued',
            sent_at: channel === 'in_app' ? this.clock.now() : null,
          })
          .onConflict((oc) =>
            oc
              .columns([
                'tenant_id',
                'event_id',
                'kind',
                'recipient_key',
                'channel',
              ])
              .doNothing(),
          )
          .returning('id')
          .executeTakeFirst();
        if (inserted) count++;
      }
    }
    await this.db.tx
      .insertInto('notification_events')
      .values({ event_id: event.id, event_type: event.type, messages: count })
      .onConflict((oc) => oc.columns(['tenant_id', 'event_id']).doNothing())
      .execute();
    return count;
  }

  // =================================================================== n8n relay

  /**
   * For n8n (event callback token): the e-mail / SMS messages of the event that
   * still need sending. Each message handed out is marked "sending".
   */
  async claim(eventId: string) {
    await this.plan(eventId);
    const now = this.clock.now();
    const stale = new Date(now.getTime() - CLAIM_TIMEOUT_MINUTES * 60_000);
    const rows = await this.db.tx
      .updateTable('notifications')
      .set({ status: 'sending', claimed_at: now, attempts: sql`attempts + 1` })
      .where('event_id', '=', eventId)
      .where('channel', '<>', 'in_app')
      .where((eb) =>
        eb.or([
          eb('status', '=', 'queued'),
          eb.and([eb('status', '=', 'sending'), eb('claimed_at', '<', stale)]),
          eb.and([
            eb('status', '=', 'failed'),
            eb('attempts', '<', MAX_ATTEMPTS),
          ]),
        ]),
      )
      .returningAll()
      .execute();
    return {
      eventId,
      messages: rows
        .sort(
          (a, b) =>
            a.channel.localeCompare(b.channel) ||
            a.recipient_key.localeCompare(b.recipient_key),
        )
        .map((n) => ({
          id: n.id,
          kind: n.kind,
          channel: n.channel,
          to: n.address,
          language: n.language,
          subject: n.subject,
          text: n.body,
          link: n.link,
          // n8n downloads it with the same token: GET /notifications/<id>/attachment
          attachment: n.attachment
            ? {
                path: `/notifications/${n.id}/attachment`,
                fileName: `payslip-${n.id.slice(0, 8)}.pdf`,
              }
            : null,
        })),
    };
  }

  /** n8n reports what the e-mail / SMS provider said. Reporting twice is harmless. */
  async report(notificationId: string, dto: ReportResultDto) {
    const n = await this.findForEvent(notificationId);
    if (n.status === 'sent') return { id: n.id, status: n.status }; // already final
    await this.db.tx
      .updateTable('notifications')
      .set(
        dto.status === 'sent'
          ? {
              status: 'sent',
              sent_at: this.clock.now(),
              provider: dto.provider,
              provider_message_id: dto.providerMessageId ?? null,
              last_error: dto.error ?? null,
            }
          : {
              status: 'failed',
              provider: dto.provider,
              last_error: (dto.error ?? 'failed').slice(0, 1000),
            },
      )
      .where('id', '=', n.id)
      .execute();
    return { id: n.id, status: dto.status };
  }

  /** The payslip PDF for a payslip e-mail (protected with the employee's password). */
  async attachment(notificationId: string) {
    const n = await this.findForEvent(notificationId);
    const a = n.attachment as {
      type?: string;
      runId?: string;
      employeeId?: string;
    } | null;
    if (a?.type !== 'payslip' || !a.runId || !a.employeeId)
      throw new NotFoundException('No attachment');
    return this.payroll.payslipPdfForDelivery(
      a.runId,
      a.employeeId,
      n.language,
    );
  }

  // =================================================================== in-app inbox

  async inbox(unreadOnly: boolean) {
    const userId = requestContext.get().userId!;
    let q = this.db.tx
      .selectFrom('notifications')
      .select([
        'id',
        'kind',
        'subject',
        'body',
        'link',
        'created_at',
        'read_at',
      ])
      .where('user_id', '=', userId)
      .where('channel', '=', 'in_app');
    if (unreadOnly) q = q.where('read_at', 'is', null);
    const rows = await q.orderBy('created_at', 'desc').limit(50).execute();
    const unread = await this.db.tx
      .selectFrom('notifications')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('user_id', '=', userId)
      .where('channel', '=', 'in_app')
      .where('read_at', 'is', null)
      .executeTakeFirstOrThrow();
    return {
      unread: unread.n,
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        title: r.subject,
        text: r.body,
        link: r.link,
        createdAt: r.created_at,
        read: !!r.read_at,
      })),
    };
  }

  async markRead(id: string | 'all') {
    const userId = requestContext.get().userId!;
    // one message: it must be the user's own in-app message (already read is fine, someone else's is not found)
    if (id !== 'all') {
      const own = await this.db.tx
        .selectFrom('notifications')
        .select('id')
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('channel', '=', 'in_app')
        .executeTakeFirst();
      if (!own) throw new NotFoundException(MSG.NOT_FOUND);
    }
    let q = this.db.tx
      .updateTable('notifications')
      .set({ read_at: this.clock.now() })
      .where('user_id', '=', userId)
      .where('channel', '=', 'in_app')
      .where('read_at', 'is', null);
    if (id !== 'all') q = q.where('id', '=', id);
    const res = await q.executeTakeFirst();
    return { marked: Number(res.numUpdatedRows) };
  }

  // =================================================================== monitoring

  /** Integrations admin: e-mail / SMS that did not go out (spec §10: delivery status logged). */
  async deliveries(status?: 'queued' | 'sending' | 'sent' | 'failed') {
    let q = this.db.tx
      .selectFrom('notifications')
      .select([
        'id',
        'event_type',
        'kind',
        'channel',
        'status',
        'attempts',
        'provider',
        'provider_message_id',
        'last_error',
        'created_at',
        'sent_at',
      ])
      .where('channel', '<>', 'in_app');
    if (status) q = q.where('status', '=', status);
    return q.orderBy('created_at', 'desc').limit(200).execute();
  }

  // =================================================================== worker

  /**
   * Plan recent events that nobody planned yet (n8n absent, or slow), so in-app
   * messages appear anyway. Runs per tenant from the worker.
   */
  async planRecent(): Promise<number> {
    const rows = await this.db.tx
      .selectFrom('outbox_events as o')
      .leftJoin('notification_events as n', 'n.event_id', 'o.id')
      .select('o.id')
      .where('o.type', 'in', NOTIFIED_EVENTS)
      .where('o.created_at', '>', sql<Date>`now() - interval '2 days'`)
      .where('n.event_id', 'is', null)
      .orderBy('o.seq')
      .limit(200)
      .execute();
    for (const r of rows) await this.plan(r.id);
    return rows.length;
  }

  // =================================================================== who gets what

  private async messagesFor(
    type: string,
    p: Record<string, unknown>,
  ): Promise<Planned[]> {
    const app = this.config.notifications.publicAppUrl;
    switch (type) {
      case 'approval.pending': {
        const summary = await this.approvalSummary(String(p.requestId));
        const to = await this.userRecipient(String(p.approverUserId));
        const link = `${app}/approvals/${p.requestId}`;
        const kind: Kind = p.reminder
          ? 'approval_reminder'
          : 'approval_request';
        return to && summary
          ? [
              {
                kind,
                recipient: to,
                link,
                text: TEMPLATES[kind](to.language, { summary, link }),
              },
            ]
          : [];
      }
      case 'approval.sla_breached': {
        const summary = await this.approvalSummary(String(p.requestId));
        if (!summary) return [];
        const link = `${app}/approvals/${p.requestId}`;
        const out: Planned[] = [];
        const target = p.escalatedToUserId
          ? await this.userRecipient(String(p.escalatedToUserId))
          : null;
        if (target)
          out.push({
            kind: 'approval_escalated',
            recipient: target,
            link,
            text: TEMPLATES.approval_escalated(target.language, {
              summary,
              link,
            }),
          });
        const late = await this.userRecipient(String(p.lateApproverUserId));
        if (late && target)
          out.push({
            kind: 'approval_passed_on',
            recipient: late,
            link,
            text: TEMPLATES.approval_passed_on(late.language, {
              summary,
              link,
            }),
          });
        return out;
      }
      case 'payroll.disbursed':
        return this.payslipMessages(String(p.runId));
      case 'attendance.daily_closed':
        return this.digestMessages(String(p.companyId), String(p.date));
      case 'leave.approved':
      case 'leave.rejected': {
        const to = await this.employeeRecipient(String(p.employeeId));
        if (!to?.userId) return [];
        const link = `${app}/leave`;
        return [
          {
            kind: 'leave_decision',
            recipient: to,
            link,
            text: TEMPLATES.leave_decision(to.language, {
              approved: type === 'leave.approved',
              from: String(p.from),
              to: String(p.to),
              link,
            }),
          },
        ];
      }
      case 'employee.probation_ending':
        return this.probationMessages(
          String(p.employeeId),
          String(p.probationEndDate),
        );
      case 'budget.threshold_reached':
        return this.budgetMessages(p);
      case 'compliance.due_soon':
      case 'compliance.overdue':
        return this.complianceMessages(p, type === 'compliance.overdue');
      case 'lead.created':
      case 'lead.assigned':
        return this.leadMessages(p);
      case 'invoice.overdue':
        return this.overdueMessages(p);
    }
    return [];
  }

  private async payslipMessages(runId: string): Promise<Planned[]> {
    const run = await this.db.tx
      .selectFrom('payroll_runs')
      .select(['id', 'company_id', 'period', 'run_type', 'bonus_name'])
      .where('id', '=', runId)
      .executeTakeFirst();
    if (!run) return [];
    const company = await this.org.companyNames(run.company_id);
    const people = await this.db.tx
      .selectFrom('payroll_run_employees as r')
      .innerJoin('employees as e', 'e.id', 'r.employee_id')
      .select(['r.employee_id', 'r.net', 'e.date_of_birth'])
      .where('r.run_id', '=', run.id)
      .where('r.net', '>', '0')
      .execute();
    const link = `${this.config.notifications.publicAppUrl}/payslips/${run.id}`;
    const out: Planned[] = [];
    for (const person of people) {
      const to = await this.employeeRecipient(person.employee_id);
      if (!to) continue;
      const hint = person.date_of_birth
        ? to.language === 'bn'
          ? 'জন্মতারিখ (DDMMYYYY)'
          : 'date of birth (DDMMYYYY)'
        : to.language === 'bn'
          ? 'কর্মী কোড'
          : 'employee code';
      const what =
        run.run_type === 'bonus'
          ? run.bonus_name
          : run.run_type === 'final_settlement'
            ? to.language === 'bn'
              ? 'চূড়ান্ত নিষ্পত্তি'
              : 'final settlement'
            : null;
      out.push({
        kind: 'payslip_ready',
        recipient: to,
        link,
        text: TEMPLATES.payslip_ready(to.language, {
          company: company.shortName ?? company.legalName,
          period: run.period,
          what,
          net: person.net,
          passwordHint: hint,
          link,
        }),
        attachment: {
          type: 'payslip',
          runId: run.id,
          employeeId: person.employee_id,
        },
      });
    }
    return out;
  }

  /** 80 %: the Dept Head; 100 %: the Dept Head and the company's Admins. */
  private async budgetMessages(p: Record<string, unknown>): Promise<Planned[]> {
    const department = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'name', 'head_employee_id'])
      .where('id', '=', String(p.departmentId))
      .executeTakeFirst();
    if (!department) return [];
    const account = p.accountId
      ? await this.db.tx
          .selectFrom('accounts')
          .select(['code', 'name_en'])
          .where('id', '=', String(p.accountId))
          .executeTakeFirst()
      : undefined;
    const recipients: Recipient[] = [];
    if (department.head_employee_id) {
      const head = await this.employeeRecipient(department.head_employee_id);
      if (head?.userId) recipients.push(head);
    }
    if (Number(p.level) >= 100) {
      for (const userId of await this.access.usersWithSystemRole('admin', {
        companyId: String(p.companyId),
        departmentId: department.id,
      })) {
        if (recipients.some((r) => r.userId === userId)) continue;
        const admin = await this.userRecipient(userId);
        if (admin) recipients.push(admin);
      }
    }
    const link = `${this.config.notifications.publicAppUrl}/portal/budgets/${p.budgetId}`;
    return recipients.map((to) => ({
      kind: 'budget_alert' as const,
      recipient: to,
      link,
      text: TEMPLATES.budget_alert(to.language, {
        department: department.name,
        account: account ? `${account.code} ${account.name_en}` : null,
        percent: String(p.percent ?? '0'),
        used: String(p.used ?? '0'),
        budget: String(p.budget ?? '0'),
        level: Number(p.level),
        link,
      }),
    }));
  }

  /** A filing or deposit falls due: the company's Accounts users; once overdue also its Admins. */
  private async complianceMessages(
    p: Record<string, unknown>,
    overdue: boolean,
  ): Promise<Planned[]> {
    const companyId = String(p.companyId);
    const userIds = new Set(
      await this.access.usersWithSystemRole('accounts', { companyId }),
    );
    if (overdue)
      for (const id of await this.access.usersWithSystemRole('admin', {
        companyId,
      }))
        userIds.add(id);
    const link = `${this.config.notifications.publicAppUrl}/portal/compliance`;
    const out: Planned[] = [];
    for (const userId of userIds) {
      const to = await this.userRecipient(userId);
      if (!to) continue;
      const v = {
        title: String(p.title),
        dueDate: String(p.dueDate),
        daysLeft: Number(p.daysLeft),
        link,
      };
      out.push(
        overdue
          ? {
              kind: 'compliance_overdue' as const,
              recipient: to,
              link,
              text: TEMPLATES.compliance_overdue(to.language, v),
            }
          : {
              kind: 'compliance_due' as const,
              recipient: to,
              link,
              text: TEMPLATES.compliance_due(to.language, v),
            },
      );
    }
    return out;
  }

  /** A lead for a salesperson: new (from the website, Facebook, a colleague) or handed over. */
  private async leadMessages(p: Record<string, unknown>): Promise<Planned[]> {
    const lead = await this.db.tx
      .selectFrom('leads')
      .select([
        'id',
        'number',
        'name',
        'organisation',
        'district',
        'source',
        'owner_id',
      ])
      .where('id', '=', String(p.leadId))
      .executeTakeFirst();
    if (!lead) return [];
    const to = await this.userRecipient(lead.owner_id);
    // the one who entered it for themself needs no message
    if (!to || (p.createdBy && p.createdBy === lead.owner_id)) return [];
    const link = `${this.config.notifications.publicAppUrl}/portal/crm/leads/${lead.id}`;
    return [
      {
        kind: 'lead_assigned' as const,
        recipient: to,
        link,
        text: TEMPLATES.lead_assigned(to.language, {
          number: lead.number,
          who: [lead.name, lead.organisation].filter(Boolean).join(', '),
          district: lead.district,
          source: lead.source,
          link,
        }),
      },
    ];
  }

  /** WP27: from the escalation stage on, the customer's account manager (the customer's own reminder goes through n8n). */
  private async overdueMessages(
    p: Record<string, unknown>,
  ): Promise<Planned[]> {
    if (!p.escalate || !p.accountManagerId) return [];
    const to = await this.userRecipient(String(p.accountManagerId));
    if (!to) return [];
    const link = `${this.config.notifications.publicAppUrl}/portal/crm/customers/${String(p.customerId)}`;
    return [
      {
        kind: 'invoice_overdue' as const,
        recipient: to,
        link,
        text: TEMPLATES.invoice_overdue(to.language, {
          invoiceNo: String(p.invoiceNo),
          customer: String(p.customerName),
          outstanding: String(p.outstanding),
          daysLate: Number(p.daysLate),
          link,
        }),
      },
    ];
  }

  /** The head of the employee's current department (not the employee themself). */
  private async probationMessages(
    employeeId: string,
    endDate: string,
  ): Promise<Planned[]> {
    const onDate = endDate; // the placement in force on the last day of probation
    const row = await this.db.tx
      .selectFrom('employee_assignments as a')
      .innerJoin('departments as d', 'd.id', 'a.department_id')
      .innerJoin('employees as e', 'e.id', 'a.employee_id')
      .select([
        'd.head_employee_id',
        'e.full_name_en',
        'e.full_name_bn',
        'e.employee_code',
      ])
      .where('a.employee_id', '=', employeeId)
      .where('a.effective_from', '<=', onDate)
      .where((w) =>
        w.or([
          w('a.effective_to', 'is', null),
          w('a.effective_to', '>', onDate),
        ]),
      )
      .executeTakeFirst();
    if (!row?.head_employee_id || row.head_employee_id === employeeId)
      return [];
    const to = await this.employeeRecipient(row.head_employee_id);
    if (!to?.userId) return [];
    const link = `${this.config.notifications.publicAppUrl}/portal/lifecycle`;
    const name =
      to.language === 'bn'
        ? (row.full_name_bn ?? row.full_name_en)
        : row.full_name_en;
    return [
      {
        kind: 'probation_review',
        recipient: to,
        link,
        text: TEMPLATES.probation_review(to.language, {
          name,
          code: row.employee_code,
          endDate,
          link,
        }),
      },
    ];
  }

  /** Each Dept Head: absent, late, half-day and missing punches of their department (and below) for the day. */
  private async digestMessages(
    companyId: string,
    date: string,
  ): Promise<Planned[]> {
    const heads = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'name', 'head_employee_id'])
      .where('company_id', '=', companyId)
      .where('head_employee_id', 'is not', null)
      .where('is_active', '=', true)
      .execute();
    const link = `${this.config.notifications.publicAppUrl}/approvals`;
    const out: Planned[] = [];
    for (const dept of heads) {
      const to = await this.employeeRecipient(dept.head_employee_id!);
      if (!to?.userId) continue;
      const subtree = await this.org.departmentWithDescendants(dept.id);
      const days = await this.db.tx
        .selectFrom('attendance_days as d')
        .innerJoin('employees as e', 'e.id', 'd.employee_id')
        .select([
          'd.status',
          'd.late_minutes',
          'e.employee_code',
          'e.full_name_en',
          'e.full_name_bn',
        ])
        .where('d.work_date', '=', date)
        .where('d.department_id', 'in', subtree)
        .where('d.employee_id', '<>', dept.head_employee_id!)
        .orderBy('e.employee_code')
        .execute();
      const working = days.filter(
        (d) => d.status !== 'weekend' && d.status !== 'holiday',
      );
      if (working.length === 0) continue; // a day off for the whole department: nothing to report
      const lines = working
        .filter((d) =>
          ['absent', 'late', 'half_day', 'missing_punch'].includes(d.status),
        )
        .map((d) => ({
          name:
            to.language === 'bn'
              ? (d.full_name_bn ?? d.full_name_en)
              : d.full_name_en,
          code: d.employee_code,
          status: d.status,
          lateMinutes: d.late_minutes,
        }));
      out.push({
        kind: 'attendance_digest',
        recipient: to,
        link,
        text: TEMPLATES.attendance_digest(to.language, {
          date,
          department: dept.name,
          headcount: working.length,
          lines,
          link,
        }),
      });
    }
    return out;
  }

  private async approvalSummary(requestId: string): Promise<string | null> {
    const r = await this.db.tx
      .selectFrom('approval_requests')
      .select(['summary', 'state'])
      .where('id', '=', requestId)
      .executeTakeFirst();
    // decided meanwhile (e.g. a reminder for a request approved since): nothing to say
    return r && r.state === 'in_approval' ? r.summary : null;
  }

  private async userRecipient(userId: string): Promise<Recipient | null> {
    const u = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select([
        'u.id',
        'u.email',
        'u.phone',
        'u.preferred_language',
        'u.status',
        'u.employee_id',
        'e.phone as employee_phone',
      ])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!u || u.status !== 'active') return null;
    return {
      key: `user:${u.id}`,
      userId: u.id,
      employeeId: u.employee_id,
      email: u.email,
      phone: normalizePhone(u.phone ?? u.employee_phone),
      language: u.preferred_language,
    };
  }

  /** An employee, through their login when they have one (language, inbox), else by personal e-mail / phone. */
  private async employeeRecipient(
    employeeId: string,
  ): Promise<Recipient | null> {
    const user = await this.db.tx
      .selectFrom('users')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (user) return this.userRecipient(user.id);
    const e = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'personal_email', 'phone'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!e) return null;
    return {
      key: `employee:${e.id}`,
      userId: null,
      employeeId: e.id,
      email: e.personal_email,
      phone: normalizePhone(e.phone),
      language: 'bn',
    };
  }

  /** The message, which must belong to the event of the caller's token. */
  private async findForEvent(id: string): Promise<Notification> {
    const n = await this.db.tx
      .selectFrom('notifications')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!n) throw new NotFoundException('Notification not found');
    const eventId = requestContext.get().callbackEventId;
    if (!eventId || n.event_id !== eventId)
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (n.channel === 'in_app')
      throw new BadRequestException('In-app messages are not relayed');
    return n;
  }
}

/** Bangladeshi mobile numbers as +8801XXXXXXXXX (what SMS gateways expect); others unchanged. */
export function normalizePhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  return digits || null;
}
