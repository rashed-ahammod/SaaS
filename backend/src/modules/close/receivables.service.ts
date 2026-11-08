/**
 * What customers owe (WP22, extended by WP26-WP27): the receivables sub-ledger. Its items are
 * the opening balances (the old system's unpaid invoices) and, from WP26, the customer
 * invoices; credit notes lower an item (credited), receipts and money on account pay it.
 *
 *   list / aging(asOf, by)   open items; aged by due date (current, 1-30, 31-60, 61-90, over
 *                        90 days) per customer or per account manager, counting every payment
 *                        (WP22 receipts, WP27 allocations and advance applications) and credit
 *                        note up to the date
 *   receipt(item)        money received against an item: a receipt voucher to the checker
 *                        (Dr cash / bank, Cr receivables); the item counts it once posted
 *   controlCheck         nightly (ledger checks): the receivables control account equals the
 *                        open items
 *
 * The receivables account is a control account: no manual voucher may touch it.
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { ReceivableItem, Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { ReceiptDto } from './dto/close.dto.js';

export const RECEIVABLE_RECEIPT_SOURCE = 'receivable_receipt';
const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'over_90'] as const;

@Injectable()
export class ReceivablesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly reports: LedgerReportsService,
    private readonly vouchers: VouchersService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(RECEIVABLE_RECEIPT_SOURCE, {
      onPosted: (v) => this.receiptState(v, 'posted'),
      onDropped: (v) => this.receiptState(v, 'cancelled'),
      onReversed: (v) => this.receiptState(v, 'reversed'),
    });
    this.reports.registerCheck((companyId) => this.controlCheck(companyId));
  }

  async list(companyId: string, openOnly: boolean) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('receivables.view', { companyId });
    let q = this.db.tx
      .selectFrom('receivable_items')
      .selectAll()
      .where('company_id', '=', companyId);
    if (openOnly) q = q.whereRef(sql`received + credited`, '<', sql`amount`);
    const rows = await q
      .orderBy('customer_name')
      .orderBy('invoice_date')
      .execute();
    const pending = await this.pendingByItem(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...this.toItem(r),
      pendingReceipts: pending.get(r.id) ?? '0.00',
    }));
  }

  async aging(
    companyId: string,
    asOf?: string,
    by: 'customer' | 'manager' = 'customer',
  ) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('receivables.view', { companyId });
    const date = asOf ?? todayInDhaka(this.clock.now());
    const items = await this.db.tx
      .selectFrom('receivable_items as i')
      .leftJoin('customers as c', 'c.id', 'i.customer_id')
      .leftJoin('users as u', 'u.id', 'c.account_manager_id')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .selectAll('i')
      .select(['c.code as customer_code', 'e.full_name_en as manager_name'])
      .where('i.company_id', '=', companyId)
      .where('i.invoice_date', '<=', date)
      .execute();
    // what was paid or credited up to the date, by item
    const got = new Map<string, Money>();
    const add = (rows: Array<{ item_id: string; s: string }>) =>
      rows.forEach((r) =>
        got.set(r.item_id, (got.get(r.item_id) ?? Money.zero()).plus(r.s)),
      );
    add(
      await this.db.tx
        .selectFrom('receivable_receipts')
        .select(['item_id', sql<string>`sum(amount)::text`.as('s')])
        .where('company_id', '=', companyId)
        .where('state', '=', 'posted')
        .where('receipt_date', '<=', date)
        .groupBy('item_id')
        .execute(),
    );
    add(
      await this.db.tx
        .selectFrom('customer_receipt_allocations as a')
        .innerJoin('customer_receipts as r', 'r.id', 'a.receipt_id')
        .select(['a.item_id', sql<string>`sum(a.amount)::text`.as('s')])
        .where('r.company_id', '=', companyId)
        .where('r.state', '=', 'posted')
        .where('r.receipt_date', '<=', date)
        .groupBy('a.item_id')
        .execute(),
    );
    add(
      await this.db.tx
        .selectFrom('advance_applications')
        .select(['item_id', sql<string>`sum(amount)::text`.as('s')])
        .where('company_id', '=', companyId)
        .where('applied_on', '<=', date)
        .groupBy('item_id')
        .execute(),
    );
    add(
      await this.db.tx
        .selectFrom('credit_notes as n')
        .innerJoin(
          'receivable_items as i',
          'i.sales_invoice_id',
          'n.invoice_id',
        )
        .select(['i.id as item_id', sql<string>`sum(n.total)::text`.as('s')])
        .where('n.company_id', '=', companyId)
        .where('n.note_date', '<=', date)
        .groupBy('i.id')
        .execute(),
    );
    const customers = new Map<
      string,
      Record<(typeof BUCKETS)[number] | 'total', Money>
    >();
    const zero = () =>
      Object.fromEntries(
        [...BUCKETS, 'total'].map((b) => [b, Money.zero()]),
      ) as Record<(typeof BUCKETS)[number] | 'total', Money>;
    for (const i of items) {
      // opening items carry what was paid before the books; payments since then come from the tables
      const open = Money.of(i.amount).minus(got.get(i.id) ?? '0');
      if (!open.isPositive()) continue;
      const late = Math.round(
        (Date.parse(`${date}T00:00:00Z`) -
          Date.parse(`${i.due_date}T00:00:00Z`)) /
          86_400_000,
      );
      const bucket =
        late <= 0
          ? 'current'
          : late <= 30
            ? 'd1_30'
            : late <= 60
              ? 'd31_60'
              : late <= 90
                ? 'd61_90'
                : 'over_90';
      const key =
        by === 'manager'
          ? (i.manager_name ?? '-')
          : i.customer_code
            ? `${i.customer_code} · ${i.customer_name}`
            : i.customer_name;
      const c = customers.get(key) ?? zero();
      c[bucket] = c[bucket].plus(open);
      c.total = c.total.plus(open);
      customers.set(key, c);
    }
    const rows = [...customers.entries()].map(([customer, b]) => ({
      customer,
      ...Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.toDb()])),
    }));
    const totals = Object.fromEntries(
      [...BUCKETS, 'total'].map((k) => [
        k,
        Money.sum(
          rows.map((r) => (r as unknown as Record<string, string>)[k]),
        ).toDb(),
      ]),
    );
    return {
      asOf: date,
      by,
      buckets: BUCKETS,
      customers: rows.sort((a, b) => a.customer.localeCompare(b.customer)),
      totals,
    };
  }

  async receipt(itemId: string, dto: ReceiptDto) {
    const item = await this.db.tx
      .selectFrom('receivable_items')
      .selectAll()
      .where('id', '=', itemId)
      .executeTakeFirst();
    if (!item) throw new NotFoundException(MSG.RECEIVABLE_NOT_FOUND);
    this.access.assert('receivables.manage', { companyId: item.company_id });
    const money = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', dto.receivedIntoAccountId)
      .executeTakeFirst();
    if (
      !money ||
      money.company_id !== item.company_id ||
      !money.postable ||
      !money.is_active ||
      !['cash', 'bank'].includes(money.role ?? '')
    )
      throw new BadRequestException(MSG.PAYMENT_ACCOUNT_NOT_MONEY);
    const pending = Money.of(
      (await this.pendingByItem([item.id])).get(item.id) ?? '0',
    );
    const open = Money.of(item.amount)
      .minus(item.received)
      .minus(item.credited)
      .minus(pending);
    if (Money.of(dto.amount).greaterThan(open))
      throw new BadRequestException({
        message: MSG.RECEIPT_TOO_MUCH,
        details: { available: open.toDb() },
      });
    const control = (await this.ledger.resolvePostingAccounts(item.company_id))(
      'receivables.control',
    );
    if (!control)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: ['receivables.control'] },
      });

    const receipt = await this.db.tx
      .insertInto('receivable_receipts')
      .values({
        company_id: item.company_id,
        item_id: item.id,
        receipt_date: dto.receiptDate,
        amount: Money.of(dto.amount).toDb(),
        received_into_account_id: money.id,
        reference: dto.reference ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const voucher = await this.vouchers.createLinked({
      companyId: item.company_id,
      voucherType: 'receipt',
      voucherDate: dto.receiptDate,
      narration: `${item.customer_name}: invoice ${item.reference}${dto.reference ? ` (${dto.reference})` : ''}`,
      sourceType: RECEIVABLE_RECEIPT_SOURCE,
      sourceId: receipt.id,
      lines: [
        { accountId: money.id, debit: receipt.amount },
        {
          accountId: control,
          credit: receipt.amount,
          narration: `${item.customer_name} ${item.reference}`,
        },
      ],
    });
    await this.db.tx
      .updateTable('receivable_receipts')
      .set({ voucher_id: voucher.id })
      .where('id', '=', receipt.id)
      .execute();
    await this.audit.record({
      action: 'receivable_receipt.created',
      entity: 'receivable_item',
      entityId: item.id,
      after: {
        amount: receipt.amount,
        date: dto.receiptDate,
        voucher: voucher.number,
      },
    });
    return {
      id: receipt.id,
      itemId: item.id,
      amount: receipt.amount,
      state: receipt.state,
      voucherId: voucher.id,
      voucherNumber: voucher.number,
      approvalRequestId: voucher.approval_request_id,
    };
  }

  /** The receivables control account(s) against the open items. */
  async controlCheck(
    companyId: string,
  ): Promise<Array<{ check: string; detail: string }>> {
    const ledger = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select(sql<string>`coalesce(sum(l.debit - l.credit), 0)::text`.as('b'))
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('a.role', '=', 'receivables')
      .executeTakeFirstOrThrow();
    const items = await this.db.tx
      .selectFrom('receivable_items')
      .select(
        sql<string>`coalesce(sum(amount - received - credited), 0)::text`.as(
          'b',
        ),
      )
      .where('company_id', '=', companyId)
      .executeTakeFirstOrThrow();
    return Money.of(ledger.b).equals(items.b)
      ? []
      : [
          {
            check: 'receivables_control',
            detail: `receivables account ${Money.of(ledger.b).toDb()} <> open invoices ${Money.of(items.b).toDb()}`,
          },
        ];
  }

  // ================================================================ internals

  private async receiptState(
    v: Voucher,
    state: 'posted' | 'cancelled' | 'reversed',
  ) {
    const r = await this.db.tx
      .updateTable('receivable_receipts')
      .set({ state })
      .where('id', '=', v.source_id!)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (state === 'posted')
      await this.db.tx
        .updateTable('receivable_items')
        .set({ received: sql`received + ${r.amount}::numeric` })
        .where('id', '=', r.item_id)
        .execute();
    if (state === 'reversed')
      await this.db.tx
        .updateTable('receivable_items')
        .set({ received: sql`received - ${r.amount}::numeric` })
        .where('id', '=', r.item_id)
        .execute();
  }

  private async pendingByItem(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('receivable_receipts')
      .select(['item_id', sql<string>`sum(amount)::text`.as('s')])
      .where('item_id', 'in', ids)
      .where('state', '=', 'in_approval')
      .groupBy('item_id')
      .execute();
    return new Map(rows.map((r) => [r.item_id, Money.of(r.s).toDb()]));
  }

  private toItem(r: ReceivableItem) {
    return {
      id: r.id,
      customerName: r.customer_name,
      reference: r.reference,
      invoiceDate: r.invoice_date,
      dueDate: r.due_date,
      amount: r.amount,
      received: r.received,
      outstanding: Money.of(r.amount)
        .minus(r.received)
        .minus(r.credited)
        .toDb(),
      fromOpening: !!r.opening_import_id,
      credited: r.credited,
      salesInvoiceId: r.sales_invoice_id,
      customerId: r.customer_id,
    };
  }
}
