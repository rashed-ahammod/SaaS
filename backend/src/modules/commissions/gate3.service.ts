/**
 * The Gate 3 report (WP31; spec §12: "pilots run their sales pipeline and one appraisal
 * cycle in the system").
 *
 * Gate 1 (two parallel payrolls) and Gate 2 (a real finance close) have their own tooling;
 * this is the same idea for Phase 3. It answers one question — has this pilot actually USED
 * Phase 3, or only had it installed? — with numbers taken from the pilot's own records, and
 * it says plainly which checks are not met yet.
 *
 * It decides nothing and signs nothing off: a human reads it and decides whether the gate is
 * passed, exactly as with Gate 1's comparison report.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';

export interface GateCheck {
  key: string;
  /** What has to be true, in the words of spec §12. */
  what: string;
  met: boolean;
  /** The numbers behind the answer. */
  detail: Record<string, unknown>;
}

@Injectable()
export class Gate3Service {
  constructor(
    private readonly db: DatabaseService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  /** @param days how far back "ran it" counts; the default is one quarter. */
  async report(companyId: string, days = 90) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('gate3.view', { companyId });
    const today = todayInDhaka(this.clock.now());
    const since = addDays(today, -Math.min(Math.max(days, 7), 730));
    const sinceAt = new Date(`${since}T00:00:00+06:00`);

    const checks: GateCheck[] = [
      await this.pipeline(companyId, since),
      await this.quotedAndInvoiced(companyId, since),
      await this.collected(companyId, since),
      await this.appraisalCycle(companyId),
      await this.commission(companyId),
      await this.support(companyId, sinceAt),
      await this.recruitment(companyId, since),
    ];
    return {
      companyId,
      from: since,
      to: today,
      checks,
      met: checks.filter((c) => c.met).length,
      total: checks.length,
      /** Every check met: a human still decides whether the gate is passed. */
      allMet: checks.every((c) => c.met),
    };
  }

  // ----------------------------------------------------------------- checks

  private async pipeline(
    companyId: string,
    since: BusinessDate,
  ): Promise<GateCheck> {
    const leads = await this.countCreatedSince('leads', companyId, since);
    const opportunities = await this.db.tx
      .selectFrom('opportunities')
      .select([
        (eb) => eb.fn.countAll<string>().as('n'),
        (eb) =>
          eb.fn
            .count<string>('id')
            .filterWhere('state', '=', 'won')
            .as('won'),
        (eb) =>
          eb.fn
            .count<string>('id')
            .filterWhere('state', '=', 'lost')
            .as('lost'),
      ])
      .where('company_id', '=', companyId)
      .where('created_at', '>=', new Date(`${since}T00:00:00+06:00`))
      .executeTakeFirst();
    const closed =
      Number(opportunities?.won ?? 0) + Number(opportunities?.lost ?? 0);
    return {
      key: 'pipeline',
      what: 'Leads were captured and opportunities were worked and closed, not only created',
      met: leads > 0 && Number(opportunities?.n ?? 0) > 0 && closed > 0,
      detail: {
        leads,
        opportunities: Number(opportunities?.n ?? 0),
        won: Number(opportunities?.won ?? 0),
        lost: Number(opportunities?.lost ?? 0),
      },
    };
  }

  private async quotedAndInvoiced(
    companyId: string,
    since: BusinessDate,
  ): Promise<GateCheck> {
    const quotations = await this.countSince(
      'sales_quotations',
      'quote_date',
      companyId,
      since,
    );
    const orders = await this.countSince(
      'sales_orders',
      'order_date',
      companyId,
      since,
    );
    const invoices = await this.countSince(
      'sales_invoices',
      'invoice_date',
      companyId,
      since,
    );
    return {
      key: 'quote_to_invoice',
      what: 'A quotation became an order and an order became an invoice in the system',
      met: quotations > 0 && orders > 0 && invoices > 0,
      detail: { quotations, orders, invoices },
    };
  }

  private async collected(
    companyId: string,
    since: BusinessDate,
  ): Promise<GateCheck> {
    const receipts = await this.countSince(
      'customer_receipts',
      'receipt_date',
      companyId,
      since,
    );
    const open = await this.db.tx
      .selectFrom('receivable_items')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('company_id', '=', companyId)
      .where(sql<boolean>`received + credited < amount`)
      .executeTakeFirst();
    return {
      key: 'collections',
      what: 'Money received from customers was recorded against their invoices',
      met: receipts > 0,
      detail: { receipts, openItems: Number(open?.n ?? 0) },
    };
  }

  private async appraisalCycle(companyId: string): Promise<GateCheck> {
    const cycles = await this.db.tx
      .selectFrom('appraisal_cycles')
      .select(['id', 'name', 'state'])
      .where('company_id', '=', companyId)
      .execute();
    const far = cycles.filter((c) =>
      ['calibration', 'proposals', 'closed'].includes(c.state),
    );
    const appraisals = cycles.length
      ? await this.db.tx
          .selectFrom('appraisals')
          .select([
            (eb) => eb.fn.countAll<string>().as('n'),
            (eb) =>
              eb.fn
                .count<string>('id')
                .filterWhere('calibrated_rating', 'is not', null)
                .as('calibrated'),
          ])
          .where(
            'cycle_id',
            'in',
            cycles.map((c) => c.id),
          )
          .executeTakeFirst()
      : undefined;
    const calibrated = Number(appraisals?.calibrated ?? 0);
    return {
      key: 'appraisal_cycle',
      what: 'One appraisal cycle was run to calibration, with ratings calibrated across departments',
      met: far.length > 0 && calibrated > 0,
      detail: {
        cycles: cycles.map((c) => ({ name: c.name, state: c.state })),
        appraisals: Number(appraisals?.n ?? 0),
        calibrated,
      },
    };
  }

  private async commission(companyId: string): Promise<GateCheck> {
    const rule = await this.db.tx
      .selectFrom('commission_rules')
      .select(['code', 'basis'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    const posted = await this.db.tx
      .selectFrom('commission_runs')
      .select(['period', 'total'])
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .orderBy('period', 'desc')
      .limit(6)
      .execute();
    return {
      key: 'commission',
      what: 'Commission was calculated from sales and posted into payroll',
      met: !!rule && posted.length > 0,
      detail: {
        scheme: rule ? { code: rule.code, basis: rule.basis } : null,
        postedMonths: posted.map((p) => p.period),
      },
    };
  }

  private async support(companyId: string, sinceAt: Date): Promise<GateCheck> {
    const tickets = await this.db.tx
      .selectFrom('support_tickets')
      .select([
        (eb) => eb.fn.countAll<string>().as('n'),
        (eb) =>
          eb.fn
            .count<string>('id')
            .filterWhere('resolved_at', 'is not', null)
            .as('resolved'),
        (eb) =>
          eb.fn
            .count<string>('id')
            .filterWhere('resolution_breached_at', 'is not', null)
            .as('breached'),
      ])
      .where('company_id', '=', companyId)
      .where('created_at', '>=', sinceAt)
      .executeTakeFirst();
    const raised = Number(tickets?.n ?? 0);
    return {
      key: 'support',
      what: 'Customer tickets were raised and resolved against the SLA',
      met: raised > 0 && Number(tickets?.resolved ?? 0) > 0,
      detail: {
        raised,
        resolved: Number(tickets?.resolved ?? 0),
        slaMissed: Number(tickets?.breached ?? 0),
      },
    };
  }

  private async recruitment(
    companyId: string,
    since: BusinessDate,
  ): Promise<GateCheck> {
    const openings = await this.countCreatedSince(
      'job_openings',
      companyId,
      since,
    );
    const hired = await this.db.tx
      .selectFrom('applications')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('company_id', '=', companyId)
      .where('state', '=', 'hired')
      .executeTakeFirst();
    return {
      key: 'recruitment',
      what: 'A post was recruited for in the system (a hire is not required for the gate)',
      met: openings > 0,
      detail: { openings, hired: Number(hired?.n ?? 0) },
    };
  }

  // ---------------------------------------------------------------- helpers

  /** How many rows of a table a company has since a business date in a date column. */
  private async countSince(
    table: 'sales_quotations' | 'sales_orders' | 'sales_invoices' | 'customer_receipts',
    column: 'quote_date' | 'order_date' | 'invoice_date' | 'receipt_date',
    companyId: string,
    since: BusinessDate,
  ): Promise<number> {
    const row = await this.db.tx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('company_id', '=', companyId)
      .where(column as never, '>=', since as never)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  /** The same, for tables whose only date is created_at. */
  private async countCreatedSince(
    table: 'leads' | 'job_openings',
    companyId: string,
    since: BusinessDate,
  ): Promise<number> {
    const row = await this.db.tx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('company_id', '=', companyId)
      .where('created_at', '>=', new Date(`${since}T00:00:00+06:00`))
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }
}
