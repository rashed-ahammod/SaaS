/**
 * Month-end close (WP22): a checklist, then the period is closed.
 *
 *   checklist(company, period)   what must be true before the month closes:
 *     automatic (worked out now)
 *       vouchers_finished   no draft or waiting voucher dated in the month
 *       books_checks        the nightly checks pass (books balance, payroll posted, every
 *                           sub-ledger equals its control account)
 *       bank_reconciled     every bank account reconciles at the month end
 *       depreciation        the month's depreciation is posted (when there are assets)
 *       payroll_posted      the month's approved payroll is in the books
 *       vat_ready           the month's VAT return data ties to the ledger
 *     by a person (ticked with a note)
 *       accruals, prepayments, petty_cash, stock_count (when there are stores), asset_additions
 *   tick / untick(key)          a person's item
 *   close(company, period)      only when every item is done; then the ledger closes the
 *                               period (it takes only reversals afterwards)
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { BankService } from '../bank/bank.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VatReturnsService } from '../vat/vat-returns.service.js';

export const MANUAL_ITEMS = [
  'accruals',
  'prepayments',
  'petty_cash',
  'stock_count',
  'asset_additions',
] as const;
export type ManualItem = (typeof MANUAL_ITEMS)[number];

export interface ChecklistItem {
  key: string;
  kind: 'auto' | 'manual';
  ok: boolean;
  /** not relevant this month (e.g. no assets): counts as done */
  notApplicable?: boolean;
  detail: string | null;
  doneBy?: string | null;
  doneAt?: Date | null;
}

export const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

@Injectable()
export class MonthCloseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly reports: LedgerReportsService,
    private readonly setup: LedgerSetupService,
    private readonly bank: BankService,
    private readonly vatReturns: VatReturnsService,
  ) {}

  async checklist(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const p = await this.db.tx
      .selectFrom('accounting_periods')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .executeTakeFirst();
    if (!p) throw new BadRequestException(MSG.PERIOD_NOT_FOUND);
    const from = p.starts_on;
    const to = p.ends_on;
    const items: ChecklistItem[] = [];

    // vouchers finished
    const unfinished = await this.db.tx
      .selectFrom('vouchers')
      .select(['number', 'state'])
      .where('company_id', '=', companyId)
      .where('state', 'in', ['draft', 'in_approval'])
      .where('voucher_date', '>=', from)
      .where('voucher_date', '<=', to)
      .execute();
    items.push({
      key: 'vouchers_finished',
      kind: 'auto',
      ok: !unfinished.length,
      detail: unfinished.length
        ? unfinished.map((v) => `${v.number} (${v.state})`).join(', ')
        : null,
    });

    // the nightly checks
    const checks = await this.reports.checks(companyId, { skipAccess: true });
    items.push({
      key: 'books_checks',
      kind: 'auto',
      ok: checks.ok,
      detail:
        checks.problems.map((x) => `${x.check}: ${x.detail}`).join('; ') ||
        null,
    });

    // bank accounts reconciled at the month end
    const banks = await this.db.tx
      .selectFrom('company_bank_accounts')
      .select(['id', 'bank_name', 'account_no'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .where('reconcile_from', '<=', to)
      .execute();
    const unreconciled: string[] = [];
    for (const b of banks) {
      const r = await this.bank.reconciliation(b.id, to);
      if (!r.reconciled)
        unreconciled.push(
          `${b.bank_name} ${b.account_no}: difference ${r.difference ?? 'no statement'}`,
        );
      else if (!r.lastStatementDate || r.lastStatementDate < from)
        unreconciled.push(
          `${b.bank_name} ${b.account_no}: no statement for the month`,
        );
    }
    items.push({
      key: 'bank_reconciled',
      kind: 'auto',
      ok: !unreconciled.length,
      notApplicable: !banks.length,
      detail: unreconciled.join('; ') || null,
    });

    // depreciation of the month
    const assets = await this.db.tx
      .selectFrom('assets')
      .select('id')
      .where('company_id', '=', companyId)
      .where('in_service_date', '<=', to)
      .where('state', '<>', 'disposed')
      .limit(1)
      .executeTakeFirst();
    const run = assets
      ? await this.db.tx
          .selectFrom('depreciation_runs')
          .select('id')
          .where('company_id', '=', companyId)
          .where('period', '=', period)
          .where('state', '=', 'posted')
          .executeTakeFirst()
      : undefined;
    items.push({
      key: 'depreciation',
      kind: 'auto',
      ok: !assets || !!run,
      notApplicable: !assets,
      detail: assets && !run ? `Run the depreciation for ${period}` : null,
    });

    // payroll of the month in the books
    const runs = await this.db.tx
      .selectFrom('payroll_runs as r')
      .leftJoin('vouchers as v', (j) =>
        j
          .onRef('v.source_id', '=', 'r.id')
          .on('v.state', '=', 'posted')
          .on('v.reversal_of', 'is', null),
      )
      .select(['r.run_type', 'v.number'])
      .where('r.company_id', '=', companyId)
      .where('r.period', '=', period)
      .where('r.state', 'in', ['approved', 'disbursed'])
      .execute();
    const notPosted = runs.filter((r) => !r.number);
    items.push({
      key: 'payroll_posted',
      kind: 'auto',
      ok: !notPosted.length,
      notApplicable: !runs.length,
      detail:
        notPosted.map((r) => `${r.run_type} run not posted`).join(', ') || null,
    });

    // VAT return data ties to the ledger
    const vat = await this.vatReturns.preview(companyId, period);
    items.push({
      key: 'vat_ready',
      kind: 'auto',
      ok: vat.tied,
      detail: vat.tied
        ? null
        : vat.ties
            .filter((x) => !Money.of(x.difference).isZero())
            .map((x) => `${x.key}: difference ${x.difference}`)
            .join('; '),
    });

    // a person's ticks
    const ticks = await this.db.tx
      .selectFrom('month_close_items as i')
      .leftJoin('users as u', 'u.id', 'i.done_by')
      .select(['i.key', 'i.note', 'i.done_at', 'u.email'])
      .where('i.company_id', '=', companyId)
      .where('i.period', '=', period)
      .execute();
    const stores = await this.db.tx
      .selectFrom('stores')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    for (const key of MANUAL_ITEMS) {
      const t = ticks.find((x) => x.key === key);
      const notApplicable = key === 'stock_count' && !stores;
      items.push({
        key,
        kind: 'manual',
        ok: notApplicable || !!t,
        notApplicable,
        detail: t?.note ?? null,
        doneBy: t?.email ?? null,
        doneAt: t?.done_at ?? null,
      });
    }

    return {
      period,
      from,
      to,
      state: p.state,
      items,
      ready: items.every((i) => i.ok),
    };
  }

  async tick(companyId: string, period: string, key: string, note: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.periods.close', { companyId });
    if (!MANUAL_ITEMS.includes(key as ManualItem))
      throw new BadRequestException(MSG.MONTH_CLOSE_ITEM_UNKNOWN);
    await this.assertOpen(companyId, period);
    await this.db.tx
      .insertInto('month_close_items')
      .values({ company_id: companyId, period, key, note })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'company_id', 'period', 'key']).doNothing(),
      )
      .execute();
    await this.audit.record({
      action: 'month_close.ticked',
      entity: 'company',
      entityId: companyId,
      after: { period, key, note },
    });
    return this.checklist(companyId, period);
  }

  async untick(companyId: string, period: string, key: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.periods.close', { companyId });
    await this.assertOpen(companyId, period);
    await this.db.tx
      .deleteFrom('month_close_items')
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .where('key', '=', key)
      .execute();
    await this.audit.record({
      action: 'month_close.unticked',
      entity: 'company',
      entityId: companyId,
      after: { period, key },
    });
    return this.checklist(companyId, period);
  }

  async close(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.periods.close', { companyId });
    const list = await this.checklist(companyId, period);
    if (list.state === 'closed') throw new ConflictException(MSG.PERIOD_CLOSED);
    if (!list.ready) {
      throw new ConflictException({
        message: MSG.MONTH_CLOSE_NOT_READY,
        details: {
          problems: list.items
            .filter((i) => !i.ok)
            .map((i) => (i.detail ? `${i.key}: ${i.detail}` : i.key)),
        },
      });
    }
    await this.setup.closePeriod(companyId, period);
    await this.audit.record({
      action: 'month_close.closed',
      entity: 'company',
      entityId: companyId,
      after: {
        period,
        items: list.items.map((i) => `${i.key}:${i.ok ? 'ok' : 'no'}`),
      },
    });
    return this.checklist(companyId, period);
  }

  /** The months closed so far (latest first). */
  async closedPeriods(companyId: string) {
    const rows = await this.db.tx
      .selectFrom('accounting_periods')
      .select(['period', 'closed_at'])
      .where('company_id', '=', companyId)
      .where('state', '=', 'closed')
      .orderBy('period', 'desc')
      .execute();
    return rows;
  }

  private async assertOpen(companyId: string, period: string) {
    const p = await this.db.tx
      .selectFrom('accounting_periods')
      .select('state')
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .executeTakeFirst();
    if (!p) throw new BadRequestException(MSG.PERIOD_NOT_FOUND);
    if (p.state === 'closed') throw new ConflictException(MSG.PERIOD_CLOSED);
  }
}
