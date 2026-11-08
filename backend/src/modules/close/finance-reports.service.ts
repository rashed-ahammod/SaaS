/**
 * Finance reports of WP22 (the trial balance, P&L and balance sheet are in the ledger module).
 *
 *   cashFlow(from, to)    the direct method, from the vouchers that touch cash and bank:
 *                         each one's money is attributed to its other lines, and they are
 *                         classed by account: investing (non-current assets, group 1200),
 *                         financing (equity, non-current liabilities, group 2200), operating
 *                         (everything else). Transfers between cash and bank are left out.
 *                         The opening balances voucher counts as opening cash, not a flow.
 *                         Opening cash + net flow = closing cash, checked.
 *   departmentCost(from, to)   expenses by department (cost centre) and expense group; what
 *                         carries no department shows as "not assigned"
 */
import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../platform/db/database.service.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';

type Activity = 'operating' | 'investing' | 'financing';

@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  async cashFlow(companyId: string, from: string, to: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en', 'type', 'parent_id', 'role'])
      .where('company_id', '=', companyId)
      .execute();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const isMoney = (id: string) =>
      ['cash', 'bank'].includes(byId.get(id)?.role ?? '');
    const under = (id: string, code: string) => {
      for (
        let a = byId.get(id);
        a;
        a = a.parent_id ? byId.get(a.parent_id) : undefined
      )
        if (a.code === code) return true;
      return false;
    };
    const activityOf = (id: string): Activity => {
      const a = byId.get(id)!;
      if (under(id, '1200')) return 'investing';
      if (a.type === 'equity' || under(id, '2200')) return 'financing';
      return 'operating';
    };
    const money = accounts.filter((a) => isMoney(a.id)).map((a) => a.id);
    const balanceAt = async (before: string, openingUpTo?: string) => {
      if (!money.length) return Money.zero();
      const rows = await this.db.tx
        .selectFrom('voucher_lines as l')
        .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
        .select(['l.debit', 'l.credit'])
        .where('v.company_id', '=', companyId)
        .where('v.state', '=', 'posted')
        .where((eb) =>
          openingUpTo
            ? eb.or([
                eb('v.voucher_date', '<', before),
                eb.and([
                  eb('v.is_opening', '=', true),
                  eb('v.voucher_date', '<=', openingUpTo),
                ]),
              ])
            : eb('v.voucher_date', '<', before),
        )
        .where('l.account_id', 'in', money)
        .execute();
      return Money.sum(rows.map((r) => Money.of(r.debit).minus(r.credit)));
    };
    const opening = await balanceAt(from, to);
    const nextDay = new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const closing = await balanceAt(nextDay);

    // every posted line of the vouchers in the range that touch money
    const lines = money.length
      ? await this.db.tx
          .selectFrom('voucher_lines as l')
          .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
          .select(['v.id as voucher_id', 'l.account_id', 'l.debit', 'l.credit'])
          .where('v.company_id', '=', companyId)
          .where('v.state', '=', 'posted')
          .where('v.voucher_date', '>=', from)
          .where('v.voucher_date', '<=', to)
          .where('v.is_opening', '=', false)
          .where(({ exists, selectFrom }) =>
            exists(
              selectFrom('voucher_lines as m')
                .select('m.id')
                .whereRef('m.voucher_id', '=', 'v.id')
                .where('m.account_id', 'in', money),
            ),
          )
          .execute()
      : [];
    const byVoucher = new Map<string, typeof lines>();
    for (const l of lines)
      byVoucher.set(l.voucher_id, [...(byVoucher.get(l.voucher_id) ?? []), l]);

    // inflow (+) / outflow (-) per counter account
    const flows = new Map<string, Money>();
    for (const vl of byVoucher.values()) {
      const others = vl.filter((l) => !isMoney(l.account_id));
      if (!others.length) continue; // a transfer between cash and bank
      const moneyNet = Money.sum(
        vl
          .filter((l) => isMoney(l.account_id))
          .map((l) => Money.of(l.debit).minus(l.credit)),
      );
      const othersNet = Money.sum(
        others.map((l) => Money.of(l.credit).minus(l.debit)),
      );
      // money and the other lines agree unless a voucher also moves non-money balances among
      // themselves; then each other line gets its share of the money
      for (const l of others) {
        const own = Money.of(l.credit).minus(l.debit);
        const share =
          othersNet.equals(moneyNet) || othersNet.isZero()
            ? own
            : own
                .times(moneyNet.dividedBy(othersNet.toString()).toString())
                .round();
        flows.set(
          l.account_id,
          (flows.get(l.account_id) ?? Money.zero()).plus(share),
        );
      }
    }
    const sections = (
      ['operating', 'investing', 'financing'] as Activity[]
    ).map((activity) => {
      const rows = [...flows.entries()]
        .filter(([id, m]) => activityOf(id) === activity && !m.isZero())
        .map(([id, m]) => ({
          accountId: id,
          code: byId.get(id)!.code,
          name: byId.get(id)!.name_en,
          inflow: (m.isPositive() ? m : Money.zero()).toDb(),
          outflow: (m.isNegative() ? m.negate() : Money.zero()).toDb(),
          net: m.toDb(),
        }))
        .sort((a, b) => a.code.localeCompare(b.code));
      return { activity, rows, net: Money.sum(rows.map((r) => r.net)).toDb() };
    });
    const net = Money.sum(sections.map((s) => s.net));
    return {
      from,
      to,
      openingCash: opening.toDb(),
      sections,
      netChange: net.toDb(),
      closingCash: closing.toDb(),
      // the statement explains the change in cash exactly (a rounding of shared vouchers shows here)
      difference: closing.minus(opening).minus(net).toDb(),
    };
  }

  async departmentCost(companyId: string, from: string, to: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'name_en', 'type', 'parent_id'])
      .where('company_id', '=', companyId)
      .execute();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const groupOf = (id: string) => {
      const a = byId.get(id)!;
      const parent = a.parent_id ? byId.get(a.parent_id) : undefined;
      return parent && parent.code !== '5000' ? parent : a;
    };
    const lines = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select(['l.account_id', 'l.department_id', 'l.debit', 'l.credit'])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('v.voucher_date', '>=', from)
      .where('v.voucher_date', '<=', to)
      .where('a.type', '=', 'expense')
      .execute();
    const departments = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'code', 'name'])
      .where('company_id', '=', companyId)
      .execute();
    const cells = new Map<string, Map<string, Money>>(); // department -> group -> amount
    const groups = new Map<string, { code: string; name: string }>();
    for (const l of lines) {
      const g = groupOf(l.account_id);
      groups.set(g.id, { code: g.code, name: g.name_en });
      const dept = l.department_id ?? 'none';
      const row = cells.get(dept) ?? new Map<string, Money>();
      row.set(
        g.id,
        (row.get(g.id) ?? Money.zero()).plus(Money.of(l.debit).minus(l.credit)),
      );
      cells.set(dept, row);
    }
    const groupList = [...groups.entries()]
      .map(([id, g]) => ({ id, ...g }))
      .sort((a, b) => a.code.localeCompare(b.code));
    const rows = [...cells.entries()]
      .map(([dept, row]) => {
        const d = departments.find((x) => x.id === dept);
        const amounts = Object.fromEntries(
          groupList.map((g) => [g.id, (row.get(g.id) ?? Money.zero()).toDb()]),
        );
        return {
          departmentId: d?.id ?? null,
          code: d?.code ?? null,
          name: d?.name ?? null,
          amounts,
          total: Money.sum(Object.values(amounts)).toDb(),
        };
      })
      .sort((a, b) => (a.code ?? 'ZZZ').localeCompare(b.code ?? 'ZZZ'));
    const totals = Object.fromEntries(
      groupList.map((g) => [
        g.id,
        Money.sum(rows.map((r) => r.amounts[g.id])).toDb(),
      ]),
    );
    return {
      from,
      to,
      groups: groupList,
      rows,
      totals,
      total: Money.sum(rows.map((r) => r.total)).toDb(),
    };
  }
}
