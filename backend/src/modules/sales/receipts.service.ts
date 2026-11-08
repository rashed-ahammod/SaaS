/**
 * Collections (Phase 3 WP27; spec §6.8 step 7 "payment recorded -> allocated to invoices;
 * aging; collection follow-up"; §9 invoice.overdue, payment.received).
 *
 *   create        money from a customer (cash, cheque, bank transfer, bKash, Nagad), allocated to
 *                 their open invoices (partial, several); what is left is on account. VAT the
 *                 customer deducted at source (Mushak 6.6) settles the invoice too. The receipt
 *                 voucher goes to the checker: Dr cash / bank (money), Dr output VAT (VDS),
 *                 Cr receivables (allocated), Cr customer advances (on account). The money lands
 *                 on a bank account, so bank reconciliation (WP20) matches it.
 *                 Posted: the invoices count it (payment.received); reversed (a bounced
 *                 cheque): they owe it again.
 *   applyAdvance  money on account applied to an invoice later (posted at once)
 *   statement     the customer's account between two dates: invoices, credit notes, receipts,
 *                 the running balance
 *   remind        nightly: an invoice past due gets a reminder at 1, 7, 15 and 30 days late,
 *                 each stage once (invoice.overdue -> n8n e-mails / SMS the customer); from 15
 *                 days the account manager is told and gets a collection task
 *   checks        nightly (ledger checks): customer advances account = money on account
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { CustomerReceipt, Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VatService, vatYearOf } from '../vat/vat.service.js';
import type {
  ApplyAdvanceDto,
  CustomerReceiptDto,
  ReceiptQueryDto,
  StatementQueryDto,
} from './dto/sales.dto.js';
import { daysBetween, remindersDue } from './sales-rules.js';

export const CUSTOMER_RECEIPT_SOURCE = 'customer_receipt';
export const ADVANCE_APPLICATION_SOURCE = 'advance_application';

@Injectable()
export class ReceiptsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerSetupService,
    private readonly reports: LedgerReportsService,
    private readonly vouchers: VouchersService,
    private readonly vat: VatService,
    private readonly crm: CrmAccess,
    private readonly customers: CustomersService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(CUSTOMER_RECEIPT_SOURCE, {
      onPosted: (v) => this.receiptState(v, 'posted'),
      onDropped: (v) => this.receiptState(v, 'cancelled'),
      onReversed: (v) => this.receiptState(v, 'reversed'),
      assertReversible: (v) => this.assertReversible(v),
    });
    this.vouchers.registerSource(ADVANCE_APPLICATION_SOURCE, {
      assertReversible: () =>
        Promise.reject(
          new ConflictException(MSG.SALES_DOCUMENT_NOT_REVERSIBLE),
        ),
    });
    this.vat.registerSalesSource({
      sources: [CUSTOMER_RECEIPT_SOURCE],
      vds: (companyId, period) => this.vdsOfMonth(companyId, period),
    });
    this.reports.registerCheck((companyId) => this.advancesCheck(companyId));
  }

  // ================================================================ receipts

  async list(companyId: string, query: ReceiptQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('receivables.view', { companyId });
    let q = this.db.tx
      .selectFrom('customer_receipts as r')
      .innerJoin('customers as c', 'c.id', 'r.customer_id')
      .leftJoin('vouchers as v', 'v.id', 'r.voucher_id')
      .selectAll('r')
      .select([
        'c.code as customer_code',
        'c.name as customer_name',
        'v.number as voucher_number',
        'v.approval_request_id',
      ])
      .where('r.company_id', '=', companyId);
    if (query.customerId) q = q.where('r.customer_id', '=', query.customerId);
    const rows = await q
      .orderBy('r.receipt_date', 'desc')
      .orderBy('r.number', 'desc')
      .limit(1000)
      .execute();
    return rows.map((r) => ({
      ...this.toReceipt(r),
      customer: `${r.customer_code} · ${r.customer_name}`,
      voucherNumber: r.voucher_number,
      approvalRequestId: r.approval_request_id,
    }));
  }

  async get(id: string) {
    const r = await this.find(id);
    this.access.assert('receivables.view', { companyId: r.company_id });
    const allocations = await this.db.tx
      .selectFrom('customer_receipt_allocations as a')
      .innerJoin('receivable_items as i', 'i.id', 'a.item_id')
      .select([
        'a.item_id',
        'a.amount',
        'i.reference',
        'i.sales_invoice_id',
        'i.amount as invoice_total',
      ])
      .where('a.receipt_id', '=', id)
      .execute();
    const customer = await this.customers.find(r.customer_id);
    const voucher = r.voucher_id
      ? await this.db.tx
          .selectFrom('vouchers')
          .select(['id', 'number', 'state', 'approval_request_id'])
          .where('id', '=', r.voucher_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...this.toReceipt(r),
      customer: { id: customer.id, code: customer.code, name: customer.name },
      voucher: voucher
        ? {
            id: voucher.id,
            number: voucher.number,
            state: voucher.state,
            approvalRequestId: voucher.approval_request_id,
          }
        : null,
      allocations: allocations.map((a) => ({
        itemId: a.item_id,
        reference: a.reference,
        salesInvoiceId: a.sales_invoice_id,
        invoiceTotal: a.invoice_total,
        amount: a.amount,
      })),
    };
  }

  async create(companyId: string, dto: CustomerReceiptDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('receivables.manage', { companyId });
    const customer = await this.customers.find(dto.customerId);
    if (customer.company_id !== companyId)
      throw new NotFoundException(MSG.CUSTOMER_NOT_FOUND);
    const money = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', dto.receivedIntoAccountId)
      .executeTakeFirst();
    if (
      !money ||
      money.company_id !== companyId ||
      !money.postable ||
      !money.is_active ||
      !['cash', 'bank'].includes(money.role ?? '')
    )
      throw new BadRequestException(MSG.PAYMENT_ACCOUNT_NOT_MONEY);
    const vds = Money.of(dto.vdsAmount ?? '0');
    if (vds.isPositive() && !dto.vdsCertificateNo)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            'vdsCertificateNo: the Mushak 6.6 certificate number is needed with VAT deducted at source',
          ],
        },
      });
    if (dto.method === 'cheque' && !dto.chequeNo)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['chequeNo is needed for a cheque'] },
      });
    if (vds.isPositive())
      await this.vat.assertMonthOpen(companyId, dto.receiptDate);

    // each allocation: one of this customer's open invoices, within what is still owed on it
    const ids = dto.allocations.map((a) => a.itemId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException({
        message: MSG.RECEIPT_ALLOCATION_INVALID,
        details: { problems: ['An invoice appears twice'] },
      });
    const items = ids.length
      ? await this.db.tx
          .selectFrom('receivable_items')
          .selectAll()
          .where('id', 'in', ids)
          .execute()
      : [];
    const pending = await this.pendingAllocations(ids);
    for (const a of dto.allocations) {
      const item = items.find((i) => i.id === a.itemId);
      if (!item || item.customer_id !== customer.id)
        throw new BadRequestException({
          message: MSG.RECEIPT_ALLOCATION_INVALID,
          details: {
            problems: [`Not an invoice of ${customer.name}: ${a.itemId}`],
          },
        });
      const open = Money.of(item.amount)
        .minus(item.received)
        .minus(item.credited)
        .minus(pending.get(item.id) ?? '0');
      if (Money.of(a.amount).greaterThan(open))
        throw new BadRequestException({
          message: MSG.RECEIPT_ALLOCATION_INVALID,
          details: {
            problems: [`${item.reference}: only Tk ${open.toDb()} is open`],
          },
        });
    }
    const allocated = Money.sum(dto.allocations.map((a) => a.amount));
    const received = Money.of(dto.amount).plus(vds);
    if (allocated.greaterThan(received))
      throw new BadRequestException({
        message: MSG.RECEIPT_ALLOCATION_INVALID,
        details: {
          problems: [
            `Allocated Tk ${allocated.toDb()} is more than the Tk ${received.toDb()} received`,
          ],
        },
      });
    if (!received.isPositive())
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['Nothing received'] },
      });
    const onAccount = received.minus(allocated);
    const account = await this.ledger.resolvePostingAccounts(companyId);
    const needed = [
      'receivables.control',
      ...(onAccount.isPositive() ? ['receivables.advances'] : []),
      ...(vds.isPositive() ? ['vat.output'] : []),
    ];
    const missing = needed.filter((k) => !account(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });

    const r = await this.db.tx
      .insertInto('customer_receipts')
      .values({
        company_id: companyId,
        number: await this.nextNumber(companyId, dto.receiptDate),
        customer_id: customer.id,
        receipt_date: businessDate(dto.receiptDate),
        method: dto.method,
        received_into_account_id: money.id,
        amount: Money.of(dto.amount).toDb(),
        vds_amount: vds.toDb(),
        vds_certificate_no: dto.vdsCertificateNo ?? null,
        allocated: allocated.toDb(),
        on_account: onAccount.toDb(),
        cheque_no: dto.chequeNo ?? null,
        cheque_bank: dto.chequeBank ?? null,
        reference: dto.reference ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (dto.allocations.length)
      await this.db.tx
        .insertInto('customer_receipt_allocations')
        .values(
          dto.allocations.map((a) => ({
            receipt_id: r.id,
            item_id: a.itemId,
            amount: Money.of(a.amount).toDb(),
          })),
        )
        .execute();
    const what = [
      dto.method === 'cheque'
        ? `cheque ${dto.chequeNo}${dto.chequeBank ? `, ${dto.chequeBank}` : ''}`
        : dto.method.replace('_', ' '),
      dto.reference,
    ]
      .filter(Boolean)
      .join(', ');
    const voucher = await this.vouchers.createLinked({
      companyId,
      voucherType: 'receipt',
      voucherDate: r.receipt_date,
      narration: `${customer.name}: receipt ${r.number} (${what})`,
      sourceType: CUSTOMER_RECEIPT_SOURCE,
      sourceId: r.id,
      lines: [
        ...(Money.of(r.amount).isPositive()
          ? [{ accountId: money.id, debit: r.amount }]
          : []),
        ...(vds.isPositive()
          ? [
              {
                accountId: account('vat.output')!,
                debit: vds.toDb(),
                narration: `VDS by ${customer.name}, Mushak 6.6 ${dto.vdsCertificateNo}`,
              },
            ]
          : []),
        ...(allocated.isPositive()
          ? [
              {
                accountId: account('receivables.control')!,
                credit: allocated.toDb(),
                narration: `${customer.code} ${items.map((i) => i.reference).join(', ')}`,
              },
            ]
          : []),
        ...(onAccount.isPositive()
          ? [
              {
                accountId: account('receivables.advances')!,
                credit: onAccount.toDb(),
                narration: `${customer.code} on account`,
              },
            ]
          : []),
      ],
    });
    await this.db.tx
      .updateTable('customer_receipts')
      .set({ voucher_id: voucher.id })
      .where('id', '=', r.id)
      .execute();
    await this.audit.record({
      action: 'customer_receipt.created',
      entity: 'customer_receipt',
      entityId: r.id,
      after: {
        number: r.number,
        amount: r.amount,
        vds: r.vds_amount,
        allocated: r.allocated,
        onAccount: r.on_account,
        voucher: voucher.number,
      },
    });
    return this.get(r.id);
  }

  /** Money on account applied to one of the customer's invoices. */
  async applyAdvance(customerId: string, dto: ApplyAdvanceDto) {
    const customer = await this.customers.find(customerId);
    this.access.assert('receivables.manage', {
      companyId: customer.company_id,
    });
    const item = await this.db.tx
      .selectFrom('receivable_items')
      .selectAll()
      .where('id', '=', dto.itemId)
      .executeTakeFirst();
    if (!item || item.customer_id !== customerId)
      throw new BadRequestException(MSG.RECEIPT_ALLOCATION_INVALID);
    const amount = Money.of(dto.amount);
    const open = Money.of(item.amount)
      .minus(item.received)
      .minus(item.credited)
      .minus((await this.pendingAllocations([item.id])).get(item.id) ?? '0');
    const advance = Money.of(await this.advanceBalance(customerId));
    if (amount.greaterThan(open) || amount.greaterThan(advance))
      throw new BadRequestException({
        message: MSG.ADVANCE_TOO_MUCH,
        details: { open: open.toDb(), onAccount: advance.toDb() },
      });
    const appliedOn = businessDate(
      dto.appliedOn ?? todayInDhaka(this.clock.now()),
    );
    const account = await this.ledger.resolvePostingAccounts(
      customer.company_id,
    );
    const a = await this.db.tx
      .insertInto('advance_applications')
      .values({
        company_id: customer.company_id,
        customer_id: customerId,
        item_id: item.id,
        amount: amount.toDb(),
        applied_on: appliedOn,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const voucher = await this.vouchers.postAutomatic({
      companyId: customer.company_id,
      voucherType: 'journal',
      voucherDate: appliedOn,
      narration: `${customer.name}: money on account applied to ${item.reference}`,
      sourceType: ADVANCE_APPLICATION_SOURCE,
      sourceId: a.id,
      lines: [
        { accountId: account('receivables.advances')!, debit: a.amount },
        {
          accountId: account('receivables.control')!,
          credit: a.amount,
          narration: `${customer.code} ${item.reference}`,
        },
      ],
    });
    await this.db.tx
      .updateTable('advance_applications')
      .set({ voucher_id: voucher.id })
      .where('id', '=', a.id)
      .execute();
    await this.db.tx
      .updateTable('receivable_items')
      .set({ received: sql`received + ${a.amount}::numeric` })
      .where('id', '=', item.id)
      .execute();
    await this.audit.record({
      action: 'advance.applied',
      entity: 'customer',
      entityId: customerId,
      after: {
        invoice: item.reference,
        amount: a.amount,
        voucher: voucher.number,
      },
    });
    return this.account(customerId);
  }

  /** What a customer owes and has on account, with their open invoices (for the receipt form). */
  async account(customerId: string) {
    const customer = await this.customers.find(customerId);
    if (
      !this.access.allows('receivables.view', {
        companyId: customer.company_id,
      })
    )
      await this.crm.assertSee(
        customer.company_id,
        customer.account_manager_id,
        { customer: true },
      );
    const items = await this.db.tx
      .selectFrom('receivable_items')
      .selectAll()
      .where('customer_id', '=', customerId)
      .whereRef(sql`received + credited`, '<', sql`amount`)
      .orderBy('due_date')
      .execute();
    const pending = await this.pendingAllocations(items.map((i) => i.id));
    const today = todayInDhaka(this.clock.now());
    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        creditLimit: customer.credit_limit,
        paymentTermsDays: customer.payment_terms_days,
      },
      owed: Money.sum(
        items.map((i) =>
          Money.of(i.amount).minus(i.received).minus(i.credited),
        ),
      ).toDb(),
      onAccount: await this.advanceBalance(customerId),
      openInvoices: items.map((i) => ({
        itemId: i.id,
        salesInvoiceId: i.sales_invoice_id,
        reference: i.reference,
        invoiceDate: i.invoice_date,
        dueDate: i.due_date,
        amount: i.amount,
        outstanding: Money.of(i.amount)
          .minus(i.received)
          .minus(i.credited)
          .toDb(),
        pending: pending.get(i.id) ?? '0.00',
        daysLate: Math.max(0, daysBetween(i.due_date, today)),
      })),
    };
  }

  /** The customer's account between two dates. */
  async statement(customerId: string, q: StatementQueryDto) {
    const customer = await this.customers.find(customerId);
    if (
      !this.access.allows('receivables.view', {
        companyId: customer.company_id,
      })
    )
      await this.crm.assertSee(
        customer.company_id,
        customer.account_manager_id,
        { customer: true },
      );
    if (q.to < q.from)
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['to cannot be before from'] },
      });
    type Row = {
      date: string;
      kind: 'invoice' | 'credit_note' | 'receipt' | 'receipt_reversed';
      number: string;
      detail: string | null;
      debit: string;
      credit: string;
    };
    const rows: Row[] = [];
    const invoices = await this.db.tx
      .selectFrom('sales_invoices')
      .select(['invoice_date', 'invoice_no', 'due_date', 'total'])
      .where('customer_id', '=', customerId)
      .where('invoice_date', '<=', q.to)
      .execute();
    invoices.forEach((i) =>
      rows.push({
        date: i.invoice_date,
        kind: 'invoice',
        number: i.invoice_no,
        detail: `due ${i.due_date}`,
        debit: i.total,
        credit: '0.00',
      }),
    );
    const notes = await this.db.tx
      .selectFrom('credit_notes as n')
      .innerJoin('sales_invoices as i', 'i.id', 'n.invoice_id')
      .select([
        'n.note_date',
        'n.number',
        'n.reason',
        'n.total',
        'i.invoice_no',
      ])
      .where('i.customer_id', '=', customerId)
      .where('n.note_date', '<=', q.to)
      .execute();
    notes.forEach((n) =>
      rows.push({
        date: n.note_date,
        kind: 'credit_note',
        number: n.number,
        detail: `${n.invoice_no}: ${n.reason}`,
        debit: '0.00',
        credit: n.total,
      }),
    );
    const receipts = await this.db.tx
      .selectFrom('customer_receipts')
      .selectAll()
      .where('customer_id', '=', customerId)
      .where('state', 'in', ['posted', 'reversed'])
      .where('receipt_date', '<=', q.to)
      .execute();
    for (const r of receipts) {
      const total = Money.of(r.amount).plus(r.vds_amount).toDb();
      rows.push({
        date: r.receipt_date,
        kind: 'receipt',
        number: r.number,
        detail: [
          r.method,
          r.cheque_no,
          Money.of(r.vds_amount).isPositive() ? `VDS ${r.vds_amount}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        debit: '0.00',
        credit: total,
      });
      if (r.state === 'reversed')
        rows.push({
          date: r.receipt_date,
          kind: 'receipt_reversed',
          number: r.number,
          detail: 'reversed (cheque returned)',
          debit: total,
          credit: '0.00',
        });
    }
    rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.number.localeCompare(b.number),
    );
    const before = rows.filter((r) => r.date < q.from);
    const opening = Money.sum(
      before.map((r) => Money.of(r.debit).minus(r.credit)),
    );
    let balance = opening;
    const lines = rows
      .filter((r) => r.date >= q.from)
      .map((r) => {
        balance = balance.plus(r.debit).minus(r.credit);
        return { ...r, balance: balance.toDb() };
      });
    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        address: customer.address,
      },
      from: q.from,
      to: q.to,
      opening: opening.toDb(),
      lines,
      closing: balance.toDb(),
    };
  }

  async advanceBalance(customerId: string): Promise<string> {
    const r = await this.db.tx
      .selectFrom('customer_receipts')
      .select(sql<string>`coalesce(sum(on_account), 0)::text`.as('s'))
      .where('customer_id', '=', customerId)
      .where('state', '=', 'posted')
      .executeTakeFirstOrThrow();
    const a = await this.db.tx
      .selectFrom('advance_applications')
      .select(sql<string>`coalesce(sum(amount), 0)::text`.as('s'))
      .where('customer_id', '=', customerId)
      .executeTakeFirstOrThrow();
    return Money.of(r.s).minus(a.s).toDb();
  }

  async find(id: string): Promise<CustomerReceipt> {
    const r = await this.db.tx
      .selectFrom('customer_receipts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.CUSTOMER_RECEIPT_NOT_FOUND);
    return r;
  }

  // ================================================================ reminders (worker)

  /** One tenant: reminders for invoices past due, each stage once. Returns how many went out. */
  async remind(): Promise<number> {
    const today = todayInDhaka(this.clock.now());
    const items = await this.db.tx
      .selectFrom('receivable_items as i')
      .innerJoin('customers as c', 'c.id', 'i.customer_id')
      .select([
        'i.id',
        'i.company_id',
        'i.reference',
        'i.sales_invoice_id',
        'i.due_date',
        'i.amount',
        'i.received',
        'i.credited',
        'c.id as customer_id',
        'c.code',
        'c.name',
        'c.email',
        'c.phone',
        'c.account_manager_id',
      ])
      .where('i.due_date', '<', today)
      .whereRef(sql`i.received + i.credited`, '<', sql`i.amount`)
      .execute();
    let sent = 0;
    for (const i of items) {
      const daysLate = daysBetween(i.due_date, today);
      const done = (
        await this.db.tx
          .selectFrom('collection_reminders')
          .select('stage')
          .where('item_id', '=', i.id)
          .execute()
      ).map((r) => r.stage);
      const due = remindersDue(daysLate, done);
      if (due.send === null) continue;
      await this.db.tx
        .insertInto('collection_reminders')
        .values(
          due.record.map((stage) => ({
            item_id: i.id,
            stage,
            days_late: daysLate,
            escalated: stage === due.send && due.escalate,
          })),
        )
        .execute();
      const outstanding = Money.of(i.amount)
        .minus(i.received)
        .minus(i.credited)
        .toDb();
      await this.outbox.add({
        type: 'invoice.overdue',
        entityId: i.sales_invoice_id ?? i.id,
        payload: {
          itemId: i.id,
          invoiceId: i.sales_invoice_id,
          invoiceNo: i.reference,
          companyId: i.company_id,
          customerId: i.customer_id,
          customerName: i.name,
          customerEmail: i.email,
          customerPhone: i.phone,
          dueDate: i.due_date,
          daysLate,
          stage: due.send,
          outstanding,
          escalate: due.escalate,
          accountManagerId: i.account_manager_id,
        },
      });
      if (due.escalate && i.account_manager_id) {
        await this.db.tx
          .insertInto('crm_activities')
          .values({
            company_id: i.company_id,
            customer_id: i.customer_id,
            kind: 'task',
            subject: `Collect ${i.reference}: Tk ${outstanding}, ${daysLate} days late`,
            due_at: new Date(`${today}T17:00:00+06:00`),
            owner_id: i.account_manager_id,
          })
          .execute();
      }
      sent++;
    }
    return sent;
  }

  // ================================================================ internals

  private async receiptState(
    v: Voucher,
    state: 'posted' | 'cancelled' | 'reversed',
  ) {
    const r = await this.db.tx
      .updateTable('customer_receipts')
      .set({ state })
      .where('id', '=', v.source_id!)
      .returningAll()
      .executeTakeFirstOrThrow();
    const allocations = await this.db.tx
      .selectFrom('customer_receipt_allocations')
      .selectAll()
      .where('receipt_id', '=', r.id)
      .execute();
    const sign = state === 'posted' ? '+' : state === 'reversed' ? '-' : null;
    if (!sign) return;
    for (const a of allocations)
      await this.db.tx
        .updateTable('receivable_items')
        .set({ received: sql`received ${sql.raw(sign)} ${a.amount}::numeric` })
        .where('id', '=', a.item_id)
        .execute();
    if (state === 'posted') {
      await this.outbox.add({
        type: 'payment.received',
        entityId: r.id,
        payload: {
          receiptId: r.id,
          companyId: r.company_id,
          number: r.number,
          customerId: r.customer_id,
          amount: r.amount,
          vds: r.vds_amount,
          allocated: r.allocated,
          onAccount: r.on_account,
          receiptDate: r.receipt_date,
        },
      });
    }
  }

  /** A bounced cheque can be reversed unless its money on account has been applied since. */
  private async assertReversible(v: Voucher) {
    const r = await this.find(v.source_id!);
    if (
      Money.of(r.on_account).greaterThan(
        await this.advanceBalance(r.customer_id),
      )
    )
      throw new ConflictException(MSG.RECEIPT_ADVANCE_USED);
  }

  private async pendingAllocations(
    itemIds: string[],
  ): Promise<Map<string, string>> {
    if (!itemIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('customer_receipt_allocations as a')
      .innerJoin('customer_receipts as r', 'r.id', 'a.receipt_id')
      .select(['a.item_id', sql<string>`sum(a.amount)::text`.as('s')])
      .where('a.item_id', 'in', itemIds)
      .where('r.state', '=', 'in_approval')
      .groupBy('a.item_id')
      .execute();
    return new Map(rows.map((r) => [r.item_id, Money.of(r.s).toDb()]));
  }

  private async vdsOfMonth(companyId: string, period: string): Promise<string> {
    const [y, m] = period.split('-').map(Number);
    const to = `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    const row = await this.db.tx
      .selectFrom('customer_receipts')
      .select(sql<string>`coalesce(sum(vds_amount), 0)::text`.as('s'))
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .where('receipt_date', '>=', `${period}-01`)
      .where('receipt_date', '<=', to)
      .executeTakeFirstOrThrow();
    return Money.of(row.s).toDb();
  }

  /** The customer advances account equals the money on account. */
  private async advancesCheck(
    companyId: string,
  ): Promise<Array<{ check: string; detail: string }>> {
    const ledger = await this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select(sql<string>`coalesce(sum(l.credit - l.debit), 0)::text`.as('b'))
      .where('v.company_id', '=', companyId)
      .where('v.state', '=', 'posted')
      .where('a.role', '=', 'customer_advances')
      .executeTakeFirstOrThrow();
    const r = await this.db.tx
      .selectFrom('customer_receipts')
      .select(sql<string>`coalesce(sum(on_account), 0)::text`.as('s'))
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .executeTakeFirstOrThrow();
    const a = await this.db.tx
      .selectFrom('advance_applications')
      .select(sql<string>`coalesce(sum(amount), 0)::text`.as('s'))
      .where('company_id', '=', companyId)
      .executeTakeFirstOrThrow();
    const sub = Money.of(r.s).minus(a.s);
    return Money.of(ledger.b).equals(sub)
      ? []
      : [
          {
            check: 'customer_advances_control',
            detail: `customer advances account ${Money.of(ledger.b).toDb()} <> money on account ${sub.toDb()}`,
          },
        ];
  }

  private async nextNumber(companyId: string, date: string): Promise<string> {
    const fy = vatYearOf(date);
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'customer_receipt',
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
    return `CR/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toReceipt(r: CustomerReceipt) {
    return {
      id: r.id,
      companyId: r.company_id,
      number: r.number,
      customerId: r.customer_id,
      receiptDate: r.receipt_date,
      method: r.method,
      receivedIntoAccountId: r.received_into_account_id,
      amount: r.amount,
      vdsAmount: r.vds_amount,
      vdsCertificateNo: r.vds_certificate_no,
      allocated: r.allocated,
      onAccount: r.on_account,
      chequeNo: r.cheque_no,
      chequeBank: r.cheque_bank,
      reference: r.reference,
      state: r.state,
    };
  }
}
