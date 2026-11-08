/**
 * Payables reports and the sub-ledger check (spec §6.6 "aged ... payables"; WP15
 * acceptance "payables control account = sub-ledger every night").
 *
 *   aging       open bills as of a date by days past due: not due, 1-30, 31-60,
 *               61-90, over 90 (payments dated after the date are not counted)
 *   statement   a vendor's account in the books: opening, every posting, balance
 *   check       (nightly, in GET /companies/:id/ledger/checks) the payables control
 *               account equals the open bills, in total and vendor by vendor
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { sql } from 'kysely';
import {
  businessDate,
  daysBetween,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VendorsService } from './vendors.service.js';

const BUCKETS = [
  'notDue',
  'days1to30',
  'days31to60',
  'days61to90',
  'over90',
] as const;
type Bucket = (typeof BUCKETS)[number];

@Injectable()
export class PayablesReportsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly vendors: VendorsService,
    private readonly ledgerReports: LedgerReportsService,
  ) {}

  onModuleInit() {
    this.ledgerReports.registerCheck((companyId) =>
      this.controlCheck(companyId),
    );
  }

  // ================================================================ aging

  async aging(companyId: string, asOf: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    const bills = await this.db.tx
      .selectFrom('vendor_bills as b')
      .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
      .select([
        'b.id',
        'b.vendor_id',
        'v.code',
        'v.name',
        'b.bill_no',
        'b.bill_date',
        'b.due_date',
        'b.net_payable',
      ])
      .where('b.company_id', '=', companyId)
      .where('b.state', '=', 'approved')
      .where('b.bill_date', '<=', asOf)
      .execute();
    const paid = await this.paidAsOf(
      bills.map((b) => b.id),
      asOf,
    );

    const zero = () =>
      Object.fromEntries(BUCKETS.map((k) => [k, Money.zero()])) as Record<
        Bucket,
        Money
      >;
    const byVendor = new Map<
      string,
      {
        vendorId: string;
        code: string;
        name: string;
        buckets: Record<Bucket, Money>;
        bills: number;
      }
    >();
    const totals = zero();
    for (const b of bills) {
      const open = Money.of(b.net_payable).minus(paid.get(b.id) ?? '0');
      if (!open.isPositive()) continue;
      const late = daysBetween(businessDate(b.due_date), businessDate(asOf));
      const bucket: Bucket =
        late <= 0
          ? 'notDue'
          : late <= 30
            ? 'days1to30'
            : late <= 60
              ? 'days31to60'
              : late <= 90
                ? 'days61to90'
                : 'over90';
      const row = byVendor.get(b.vendor_id) ?? {
        vendorId: b.vendor_id,
        code: b.code,
        name: b.name,
        buckets: zero(),
        bills: 0,
      };
      row.buckets[bucket] = row.buckets[bucket].plus(open);
      row.bills += 1;
      byVendor.set(b.vendor_id, row);
      totals[bucket] = totals[bucket].plus(open);
    }
    const asStrings = (b: Record<Bucket, Money>) => ({
      ...Object.fromEntries(BUCKETS.map((k) => [k, b[k].toDb()])),
      total: Money.sum(BUCKETS.map((k) => b[k])).toDb(),
    });
    return {
      asOf,
      vendors: [...byVendor.values()]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((r) => ({
          vendorId: r.vendorId,
          code: r.code,
          name: r.name,
          bills: r.bills,
          ...asStrings(r.buckets),
        })),
      totals: asStrings(totals),
    };
  }

  /** Paid on each bill by payments dated on or before the date (still paid today). */
  private async paidAsOf(
    billIds: string[],
    asOf: string,
  ): Promise<Map<string, string>> {
    if (!billIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('vendor_payment_allocations as a')
      .innerJoin('vendor_payments as p', 'p.id', 'a.payment_id')
      .select(['a.bill_id', sql<string>`sum(a.amount)`.as('amount')])
      .where('a.bill_id', 'in', billIds)
      .where('p.state', '=', 'paid')
      .where('p.payment_date', '<=', asOf)
      .groupBy('a.bill_id')
      .execute();
    return new Map(rows.map((r) => [r.bill_id, r.amount]));
  }

  // ============================================================ statement

  async statement(vendorId: string, to: string, from?: string) {
    const vendor = await this.vendors.find(vendorId);
    this.access.assert('payables.view', { companyId: vendor.company_id });
    const start = from ?? '1900-01-01';
    const base = () =>
      this.db.tx
        .selectFrom('voucher_lines as l')
        .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
        .innerJoin('accounts as a', 'a.id', 'l.account_id')
        .where('v.company_id', '=', vendor.company_id)
        .where('v.state', '=', 'posted')
        .where('a.role', '=', 'payables')
        .where('l.party_type', '=', 'vendor')
        .where('l.party_id', '=', vendorId);
    const opening = await base()
      .select(sql<string>`coalesce(sum(l.credit - l.debit), 0)`.as('balance'))
      .where('v.voucher_date', '<', start)
      .executeTakeFirstOrThrow();
    const lines = await base()
      .select([
        'v.id',
        'v.number',
        'v.voucher_date',
        'v.voucher_type',
        'v.narration',
        'v.source_type',
        'l.debit',
        'l.credit',
      ])
      .where('v.voucher_date', '>=', start)
      .where('v.voucher_date', '<=', to)
      .orderBy('v.voucher_date')
      .orderBy('v.number')
      .execute();
    let balance = Money.of(opening.balance);
    return {
      vendor: { id: vendor.id, code: vendor.code, name: vendor.name },
      from: from ?? null,
      to,
      opening: balance.toDb(),
      lines: lines.map((l) => {
        balance = balance.plus(l.credit).minus(l.debit);
        return {
          voucherId: l.id,
          number: l.number,
          date: l.voucher_date,
          type: l.voucher_type,
          narration: l.narration,
          source: l.source_type,
          debit: l.debit,
          credit: l.credit,
          balance: balance.toDb(),
        };
      }),
      closing: balance.toDb(),
    };
  }

  // ================================================================ check

  /** The payables control account equals the open bills (total and per vendor). */
  private async controlCheck(companyId: string) {
    const problems: Array<{ check: string; detail: string }> = [];
    const ledger = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select([
        'l.party_type',
        'l.party_id',
        sql<string>`sum(l.credit - l.debit)`.as('balance'),
      ])
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('a.role', '=', 'payables')
      .groupBy(['l.party_type', 'l.party_id'])
      .execute();
    const bills = await this.db.tx
      .selectFrom('vendor_bills')
      .select([
        'vendor_id',
        sql<string>`sum(net_payable - paid_amount)`.as('open'),
      ])
      .where('company_id', '=', companyId)
      .where('state', '=', 'approved')
      .groupBy('vendor_id')
      .execute();

    const books = Money.sum(ledger.map((r) => r.balance));
    const open = Money.sum(bills.map((r) => r.open));
    if (!books.equals(open))
      problems.push({
        check: 'payables_control',
        detail: `payables account ${books.toDb()} <> open vendor bills ${open.toDb()}`,
      });

    const withoutVendor = ledger.filter(
      (r) => r.party_type !== 'vendor' && !Money.of(r.balance).isZero(),
    );
    if (withoutVendor.length)
      problems.push({
        check: 'payables_without_vendor',
        detail: `payables account has ${Money.sum(withoutVendor.map((r) => r.balance)).toDb()} not linked to a vendor`,
      });

    const ledgerByVendor = new Map(
      ledger
        .filter((r) => r.party_type === 'vendor')
        .map((r) => [r.party_id!, Money.of(r.balance)]),
    );
    const billsByVendor = new Map(
      bills.map((r) => [r.vendor_id, Money.of(r.open)]),
    );
    for (const vendorId of new Set([
      ...ledgerByVendor.keys(),
      ...billsByVendor.keys(),
    ])) {
      const a = ledgerByVendor.get(vendorId) ?? Money.zero();
      const b = billsByVendor.get(vendorId) ?? Money.zero();
      if (!a.equals(b))
        problems.push({
          check: 'payables_vendor_mismatch',
          detail: `vendor ${vendorId}: books ${a.toDb()} <> open bills ${b.toDb()}`,
        });
    }
    return problems;
  }
}
