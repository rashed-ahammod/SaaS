/**
 * The compliance calendar (WP21): returns, deposits and renewals and when they are due.
 *
 *   list(company, query)   the calendar, kept up to date first: the items of the months
 *                          around today (compliance-rules.ts) are added, and open items whose
 *                          filing or deposit the system can see are closed ("auto"):
 *                            vat_return          the month's return is filed
 *                            vds / tds_deposit   every withholding of the month is in a
 *                                                deposited challan (nothing withheld: not
 *                                                applicable once the month is over)
 *                            salary_tax_deposit  a salary tax challan of the month
 *                          The rest (returns filed elsewhere, renewals) a person closes.
 *   add / close            a company's own items (e.g. the fire licence); done or not
 *                          applicable, with the evidence
 *   remind()               the worker: one outbox event per item and stage, 7 days and 1 day
 *                          before (compliance.due_soon) and once overdue (compliance.overdue);
 *                          notifications go to Accounts (and the Admin when overdue), and n8n
 *                          delivers the e-mail / SMS
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ComplianceItem } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { daysLeft, dueItems, reminderStage } from './compliance-rules.js';
import type {
  CloseComplianceDto,
  ComplianceItemDto,
  ComplianceQueryDto,
} from './dto/vat.dto.js';

const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

@Injectable()
export class ComplianceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
  ) {}

  private today() {
    return todayInDhaka(this.clock.now());
  }

  async list(companyId: string, query: ComplianceQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('compliance.view', { companyId });
    await this.keepUpToDate(companyId);
    let q = this.db.tx
      .selectFrom('compliance_items')
      .selectAll()
      .where('company_id', '=', companyId);
    if (query.from) q = q.where('due_date', '>=', query.from);
    if (query.to) q = q.where('due_date', '<=', query.to);
    if (query.state) q = q.where('state', '=', query.state);
    const rows = await q.orderBy('due_date').orderBy('kind').execute();
    const today = this.today();
    return rows.map((r) => ({
      ...this.toItem(r),
      daysLeft: r.state === 'open' ? daysLeft(today, r.due_date) : null,
    }));
  }

  async add(companyId: string, dto: ComplianceItemDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('compliance.manage', { companyId });
    const row = await this.db.tx
      .insertInto('compliance_items')
      .values({
        company_id: companyId,
        kind: 'custom',
        period: `${dto.dueDate}-${randomUUID().slice(0, 8)}`,
        title: dto.title,
        due_date: dto.dueDate,
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'compliance_item.added',
      entity: 'compliance_item',
      entityId: row.id,
      after: { title: dto.title, dueDate: dto.dueDate },
    });
    return this.toItem(row);
  }

  async close(id: string, dto: CloseComplianceDto) {
    const item = await this.db.tx
      .selectFrom('compliance_items')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!item) throw new NotFoundException(MSG.COMPLIANCE_ITEM_NOT_FOUND);
    this.access.assert('compliance.manage', { companyId: item.company_id });
    const row = await this.db.tx
      .updateTable('compliance_items')
      .set({
        state: dto.state,
        done_on: dto.doneOn ?? this.today(),
        done_by: this.access.current().userId ?? null,
        evidence: dto.evidence,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'compliance_item.closed',
      entity: 'compliance_item',
      entityId: id,
      before: { state: item.state },
      after: { state: dto.state, evidence: dto.evidence },
    });
    return this.toItem(row);
  }

  /** The worker: the calendar up to date and the reminders due, for every company. */
  async remind(): Promise<number> {
    const today = this.today();
    let sent = 0;
    for (const companyId of await this.org.activeCompanyIds()) {
      await this.keepUpToDate(companyId);
      const open = await this.db.tx
        .selectFrom('compliance_items')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('state', '=', 'open')
        .execute();
      for (const item of open) {
        const stage = reminderStage(today, {
          dueDate: item.due_date,
          reminded7: item.reminded_7,
          reminded1: item.reminded_1,
          remindedOverdue: item.reminded_overdue,
        });
        if (!stage) continue;
        // a later stage covers the earlier ones (an item added close to its date)
        await this.db.tx
          .updateTable('compliance_items')
          .set(
            stage === 'overdue'
              ? { reminded_7: true, reminded_1: true, reminded_overdue: true }
              : stage === '1'
                ? { reminded_7: true, reminded_1: true }
                : { reminded_7: true },
          )
          .where('id', '=', item.id)
          .execute();
        await this.outbox.add({
          type:
            stage === 'overdue' ? 'compliance.overdue' : 'compliance.due_soon',
          entityId: item.id,
          payload: {
            itemId: item.id,
            companyId,
            kind: item.kind,
            title: item.title,
            dueDate: item.due_date,
            daysLeft: daysLeft(today, item.due_date),
          },
        });
        sent++;
      }
    }
    return sent;
  }

  // ================================================================ internals

  private async keepUpToDate(companyId: string) {
    const today = this.today();
    for (const d of dueItems(today)) {
      await this.db.tx
        .insertInto('compliance_items')
        .values({
          company_id: companyId,
          kind: d.kind,
          period: d.period,
          title: d.title,
          due_date: d.dueDate,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'company_id', 'kind', 'period']).doNothing(),
        )
        .execute();
    }
    const open = await this.db.tx
      .selectFrom('compliance_items')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('state', '=', 'open')
      .where('kind', 'in', [
        'vat_return',
        'vds_deposit',
        'tds_deposit',
        'salary_tax_deposit',
      ])
      .execute();
    for (const item of open) {
      const found = await this.evidence(companyId, item, today);
      if (!found) continue;
      await this.db.tx
        .updateTable('compliance_items')
        .set({ state: found.state, done_on: today, evidence: found.evidence })
        .where('id', '=', item.id)
        .execute();
    }
  }

  private async evidence(
    companyId: string,
    item: ComplianceItem,
    today: string,
  ): Promise<{ state: 'done' | 'not_applicable'; evidence: string } | null> {
    if (item.kind === 'vat_return') {
      const r = await this.db.tx
        .selectFrom('vat_returns')
        .select(['submitted_on', 'submission_ref'])
        .where('company_id', '=', companyId)
        .where('period', '=', item.period)
        .executeTakeFirst();
      return r
        ? {
            state: 'done',
            evidence: `auto: filed ${r.submitted_on}${r.submission_ref ? `, ${r.submission_ref}` : ''}`,
          }
        : null;
    }
    if (item.kind === 'salary_tax_deposit') {
      const c = await this.db.tx
        .selectFrom('salary_tax_challans')
        .select('challan_no')
        .where('company_id', '=', companyId)
        .where('period', '=', item.period)
        .where('state', '=', 'active')
        .execute();
      return c.length
        ? {
            state: 'done',
            evidence: `auto: challan ${c.map((x) => x.challan_no).join(', ')}`,
          }
        : null;
    }
    const taxType = item.kind === 'vds_deposit' ? 'vds' : 'tds';
    const withheld = await this.db.tx
      .selectFrom('tax_withholdings as w')
      .leftJoin('tax_challans as c', 'c.id', 'w.challan_id')
      .select(['w.id', 'c.challan_no', 'c.state'])
      .where('w.company_id', '=', companyId)
      .where('w.tax_type', '=', taxType)
      .where('w.period', '=', item.period)
      .where('w.state', '=', 'active')
      .execute();
    if (!withheld.length)
      return today > monthEnd(item.period)
        ? {
            state: 'not_applicable',
            evidence: 'auto: nothing withheld this month',
          }
        : null;
    if (withheld.some((w) => w.state !== 'deposited')) return null;
    return {
      state: 'done',
      evidence: `auto: challan ${[...new Set(withheld.map((w) => w.challan_no))].join(', ')}`,
    };
  }

  private toItem(r: ComplianceItem) {
    return {
      id: r.id,
      companyId: r.company_id,
      kind: r.kind,
      period: r.period,
      title: r.title,
      dueDate: r.due_date,
      state: r.state,
      doneOn: r.done_on,
      doneBy: r.done_by,
      evidence: r.evidence,
      note: r.note,
      version: r.version,
    };
  }
}
