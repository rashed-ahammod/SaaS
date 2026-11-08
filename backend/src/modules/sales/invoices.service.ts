/**
 * Customer invoices and credit notes (Phase 3 WP26; spec §6.8 step 6 "invoice from the order
 * (VAT invoice Mushak 6.3); posted Dr receivables, Cr sales and output VAT").
 *
 *   invoice(order)     Accounts invoices a delivered order (a service-only order once
 *                      confirmed): numbered in the Mushak 6.3 series shared with the VAT sales
 *                      register (VI/2026-27/00001), due after the customer's payment terms, and
 *                      posted at once (one document, one posting): Dr receivables, Cr sales,
 *                      Cr output VAT (VAT and SD). The invoice is the customer's receivable item.
 *   creditNote         Mushak 6.7 against an invoice, for part or all of its lines, never more
 *                      than is still owed on it: Dr sales, Dr output VAT, Cr receivables; returned
 *                      goods kept in a store go back into the store they left from ("sales_return")
 *   the VAT return     invoices and credit notes are the sales register's lines of their month
 *                      (VatService.registerSalesSource); the return's output VAT ties to them
 *
 * A month whose VAT return is filed takes no invoice or credit note.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import type { SalesInvoice } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { Decimal } from 'decimal.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { CrmAccess } from '../crm/crm-access.js';
import { CustomersService } from '../crm/customers.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VatService, vatYearOf } from '../vat/vat.service.js';
import type {
  CreditNoteDto,
  InvoiceDto,
  InvoiceQueryDto,
} from './dto/sales.dto.js';
import { OrdersService } from './orders.service.js';
import { renderSalesDocumentPdf } from './sales-pdf.js';
import { addDays, creditLine } from './sales-rules.js';

export const SALES_INVOICE_SOURCE = 'sales_invoice';
export const CREDIT_NOTE_SOURCE = 'credit_note';

const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return {
    from: `${period}-01`,
    to: `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`,
  };
};

@Injectable()
export class InvoicesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly outbox: OutboxService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly vat: VatService,
    private readonly crm: CrmAccess,
    private readonly customers: CustomersService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit() {
    // posted at once and never reversed by hand: a mistake is corrected with a credit note
    const fixed = {
      assertReversible: () =>
        Promise.reject(
          new ConflictException(MSG.SALES_DOCUMENT_NOT_REVERSIBLE),
        ),
    };
    this.vouchers.registerSource(SALES_INVOICE_SOURCE, fixed);
    this.vouchers.registerSource(CREDIT_NOTE_SOURCE, fixed);
    this.vat.registerSalesSource({
      sources: [SALES_INVOICE_SOURCE, CREDIT_NOTE_SOURCE],
      lines: (companyId, period) => this.registerLines(companyId, period),
    });
  }

  async list(companyId: string, query: InvoiceQueryDto) {
    await this.org.assertCompanyExists(companyId);
    const all = this.access.allows('receivables.view', { companyId });
    const scope = all ? null : await this.crm.listScope(companyId);
    let q = this.db.tx
      .selectFrom('sales_invoices as i')
      .innerJoin('receivable_items as r', 'r.sales_invoice_id', 'i.id')
      .innerJoin('sales_orders as o', 'o.id', 'i.order_id')
      .selectAll('i')
      .select([
        'r.id as item_id',
        'r.received',
        'r.credited',
        'o.number as order_number',
        'o.owner_id',
      ])
      .where('i.company_id', '=', companyId);
    if (scope) q = q.where('o.owner_id', 'in', scope.ownerIds);
    if (query.customerId) q = q.where('i.customer_id', '=', query.customerId);
    if (query.open === 'true')
      q = q.whereRef(sql`r.received + r.credited`, '<', sql`r.amount`);
    const rows = await q
      .orderBy('i.invoice_date', 'desc')
      .orderBy('i.invoice_no', 'desc')
      .limit(1000)
      .execute();
    return rows.map((r) => ({
      ...this.toInvoice(r),
      itemId: r.item_id,
      orderNumber: r.order_number,
      received: r.received,
      credited: r.credited,
      outstanding: Money.of(r.total).minus(r.received).minus(r.credited).toDb(),
    }));
  }

  async get(id: string) {
    const i = await this.find(id);
    const order = await this.orders.find(i.order_id);
    if (
      !this.access.allows('receivables.view', { companyId: i.company_id }) &&
      !(await this.crm.canSee(i.company_id, order.owner_id))
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    const item = await this.db.tx
      .selectFrom('receivable_items')
      .selectAll()
      .where('sales_invoice_id', '=', id)
      .executeTakeFirstOrThrow();
    const lines = await this.db.tx
      .selectFrom('sales_invoice_lines')
      .selectAll()
      .where('invoice_id', '=', id)
      .orderBy('line_no')
      .execute();
    const credited = await this.db.tx
      .selectFrom('credit_note_lines as l')
      .innerJoin('credit_notes as n', 'n.id', 'l.credit_note_id')
      .select(['l.invoice_line_id', sql<string>`sum(l.quantity)::text`.as('q')])
      .where('n.invoice_id', '=', id)
      .groupBy('l.invoice_line_id')
      .execute();
    const notes = await this.db.tx
      .selectFrom('credit_notes as n')
      .leftJoin('vouchers as v', 'v.id', 'n.voucher_id')
      .select([
        'n.id',
        'n.number',
        'n.note_date',
        'n.reason',
        'n.total',
        'v.number as voucher_number',
      ])
      .where('n.invoice_id', '=', id)
      .orderBy('n.created_at')
      .execute();
    const receipts = await this.db.tx
      .selectFrom('customer_receipt_allocations as a')
      .innerJoin('customer_receipts as c', 'c.id', 'a.receipt_id')
      .select(['c.id', 'c.number', 'c.receipt_date', 'c.state', 'a.amount'])
      .where('a.item_id', '=', item.id)
      .orderBy('c.receipt_date')
      .execute();
    const voucher = i.voucher_id
      ? await this.db.tx
          .selectFrom('vouchers')
          .select(['id', 'number'])
          .where('id', '=', i.voucher_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...this.toInvoice(i),
      orderNumber: order.number,
      itemId: item.id,
      received: item.received,
      credited: item.credited,
      outstanding: Money.of(item.amount)
        .minus(item.received)
        .minus(item.credited)
        .toDb(),
      voucher: voucher ? { id: voucher.id, number: voucher.number } : null,
      canCredit: this.access.allows('receivables.manage', {
        companyId: i.company_id,
      }),
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unit_price,
        discountPercent: l.discount_percent,
        value: l.value,
        vatPercent: l.vat_percent,
        sdAmount: l.sd_amount,
        vatAmount: l.vat_amount,
        creditedQuantity:
          credited.find((c) => c.invoice_line_id === l.id)?.q ?? '0',
      })),
      creditNotes: notes.map((n) => ({
        id: n.id,
        number: n.number,
        noteDate: n.note_date,
        reason: n.reason,
        total: n.total,
        voucherNumber: n.voucher_number,
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        number: r.number,
        receiptDate: r.receipt_date,
        state: r.state,
        amount: r.amount,
      })),
    };
  }

  async pdf(id: string, lang: 'bn' | 'en') {
    const i = await this.get(id);
    const company = await this.db.tx
      .selectFrom('companies')
      .select(['legal_name', 'bin'])
      .where('id', '=', i.companyId)
      .executeTakeFirstOrThrow();
    const customer = await this.customers.find(i.customerId);
    const buffer = await renderSalesDocumentPdf({
      kind: 'invoice',
      lang,
      company: { name: company.legal_name, bin: company.bin, address: null },
      number: i.invoiceNo,
      date: i.invoiceDate,
      secondDate: i.dueDate,
      reference: i.orderNumber,
      customer: {
        code: customer.code,
        name: i.customerName,
        bin: i.customerBin,
        address: i.customerAddress,
      },
      lines: i.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discountPercent: l.discountPercent,
        value: l.value,
        vatPercent: l.vatPercent,
        vatAmount: l.vatAmount,
        sdAmount: l.sdAmount,
      })),
      totals: {
        value: i.value,
        sd: i.sdAmount,
        vat: i.vatAmount,
        total: i.total,
      },
    });
    return { buffer, fileName: `${i.invoiceNo.replace(/\//g, '-')}.pdf` };
  }

  /** Accounts invoices an order: numbered, posted, and owed by the customer from now. */
  async invoice(orderId: string, dto: InvoiceDto) {
    const order = await this.orders.find(orderId);
    this.access.assert('receivables.manage', { companyId: order.company_id });
    const lines = await this.db.tx
      .selectFrom('sales_order_lines as l')
      .innerJoin('products as p', 'p.id', 'l.product_id')
      .selectAll('l')
      .select('p.kind')
      .where('l.order_id', '=', orderId)
      .orderBy('l.line_no')
      .execute();
    const servicesOnly = lines.every((l) => l.kind === 'service');
    if (!(
      order.state === 'delivered' ||
      (servicesOnly && order.state === 'confirmed')
    ))
      throw new ConflictException(MSG.ORDER_WRONG_STATE);
    const invoiceDate = businessDate(
      dto.invoiceDate ?? todayInDhaka(this.clock.now()),
    );
    if (invoiceDate > todayInDhaka(this.clock.now()))
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: { problems: ['invoiceDate cannot be in the future'] },
      });
    await this.vat.assertMonthOpen(order.company_id, invoiceDate);
    const account = await this.accounts(order.company_id, [
      'receivables.control',
      'sales.revenue',
      'vat.output',
    ]);
    const customer = await this.customers.find(order.customer_id);

    const invoice = await this.db.tx
      .insertInto('sales_invoices')
      .values({
        company_id: order.company_id,
        invoice_no: await this.vat.nextInvoiceNo(order.company_id, invoiceDate),
        order_id: order.id,
        customer_id: customer.id,
        invoice_date: invoiceDate,
        due_date: addDays(invoiceDate, customer.payment_terms_days),
        customer_name: customer.name,
        customer_bin: customer.bin,
        customer_address:
          [customer.address, customer.district].filter(Boolean).join(', ') ||
          null,
        value: order.value,
        sd_amount: order.sd_total,
        vat_amount: order.vat_total,
        total: order.total,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('sales_invoice_lines')
      .values(
        lines.map((l) => ({
          invoice_id: invoice.id,
          line_no: l.line_no,
          product_id: l.product_id,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unit_price: l.unit_price,
          discount_percent: l.discount_percent,
          value: l.value,
          vat_item_id: l.vat_item_id,
          rate_class: l.rate_class,
          vat_percent: l.vat_percent,
          sd_percent: l.sd_percent,
          sd_amount: l.sd_amount,
          vat_amount: l.vat_amount,
        })),
      )
      .execute();
    const tax = Money.of(invoice.sd_amount).plus(invoice.vat_amount);
    const voucher = await this.vouchers.postAutomatic({
      companyId: order.company_id,
      voucherType: 'journal',
      voucherDate: invoiceDate,
      narration: `Invoice ${invoice.invoice_no}: ${customer.name} (order ${order.number})`,
      sourceType: SALES_INVOICE_SOURCE,
      sourceId: invoice.id,
      lines: [
        {
          accountId: account('receivables.control'),
          debit: invoice.total,
          narration: `${customer.code} ${invoice.invoice_no}`,
        },
        { accountId: account('sales.revenue'), credit: invoice.value },
        ...(tax.isPositive()
          ? [{ accountId: account('vat.output'), credit: tax.toDb() }]
          : []),
      ],
    });
    await this.db.tx
      .updateTable('sales_invoices')
      .set({ voucher_id: voucher.id })
      .where('id', '=', invoice.id)
      .execute();
    await this.db.tx
      .insertInto('receivable_items')
      .values({
        company_id: order.company_id,
        customer_name: customer.name,
        reference: invoice.invoice_no,
        invoice_date: invoiceDate,
        due_date: invoice.due_date,
        amount: invoice.total,
        customer_id: customer.id,
        sales_invoice_id: invoice.id,
      })
      .execute();
    await this.db.tx
      .updateTable('sales_orders')
      .set({ state: 'invoiced' })
      .where('id', '=', order.id)
      .execute();
    await this.audit.record({
      action: 'sales_invoice.created',
      entity: 'sales_invoice',
      entityId: invoice.id,
      after: {
        invoiceNo: invoice.invoice_no,
        order: order.number,
        total: invoice.total,
        voucher: voucher.number,
      },
    });
    await this.outbox.add({
      type: 'invoice.created',
      entityId: invoice.id,
      payload: {
        invoiceId: invoice.id,
        companyId: order.company_id,
        invoiceNo: invoice.invoice_no,
        customerId: customer.id,
        total: invoice.total,
        dueDate: invoice.due_date,
        accountManagerId: customer.account_manager_id,
      },
    });
    return this.get(invoice.id);
  }

  /** Mushak 6.7: part or all of an invoice's lines back, never more than is owed on it. */
  async creditNote(invoiceId: string, dto: CreditNoteDto) {
    const invoice = await this.find(invoiceId);
    this.access.assert('receivables.manage', { companyId: invoice.company_id });
    const noteDate = businessDate(
      dto.noteDate ?? todayInDhaka(this.clock.now()),
    );
    if (
      noteDate < invoice.invoice_date ||
      noteDate > todayInDhaka(this.clock.now())
    )
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: ['noteDate must be between the invoice date and today'],
        },
      });
    await this.vat.assertMonthOpen(invoice.company_id, noteDate);
    const account = await this.accounts(invoice.company_id, [
      'receivables.control',
      'sales.revenue',
      'vat.output',
    ]);
    const detail = await this.get(invoiceId);
    const lines = [];
    for (const l of dto.lines) {
      const line = await this.db.tx
        .selectFrom('sales_invoice_lines')
        .selectAll()
        .where('id', '=', l.invoiceLineId)
        .where('invoice_id', '=', invoiceId)
        .executeTakeFirst();
      if (!line) throw new BadRequestException(MSG.INVOICE_LINE_NOT_FOUND);
      const left = Money.of(line.quantity).minus(
        detail.lines.find((x) => x.id === line.id)!.creditedQuantity,
      );
      if (Money.of(l.quantity).greaterThan(left))
        throw new BadRequestException({
          message: MSG.CREDIT_TOO_MUCH,
          details: { line: line.line_no, available: left.toDb() },
        });
      lines.push({
        line,
        quantity: l.quantity,
        ...creditLine(line, l.quantity),
      });
    }
    const value = Money.sum(lines.map((l) => l.value));
    const sd = Money.sum(lines.map((l) => l.sdAmount));
    const vatAmount = Money.sum(lines.map((l) => l.vatAmount));
    const total = value.plus(sd).plus(vatAmount);
    if (total.greaterThan(detail.outstanding))
      throw new BadRequestException({
        message: MSG.CREDIT_TOO_MUCH,
        details: { outstanding: detail.outstanding },
      });

    const note = await this.db.tx
      .insertInto('credit_notes')
      .values({
        company_id: invoice.company_id,
        number: await this.nextNoteNo(invoice.company_id, noteDate),
        invoice_id: invoiceId,
        note_date: noteDate,
        reason: dto.reason,
        value: value.toDb(),
        sd_amount: sd.toDb(),
        vat_amount: vatAmount.toDb(),
        total: total.toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('credit_note_lines')
      .values(
        lines.map((l) => ({
          credit_note_id: note.id,
          invoice_line_id: l.line.id,
          quantity: l.quantity,
          value: l.value,
          rate_class: l.line.rate_class,
          sd_amount: l.sdAmount,
          vat_amount: l.vatAmount,
        })),
      )
      .execute();
    const tax = sd.plus(vatAmount);
    const voucher = await this.vouchers.postAutomatic({
      companyId: invoice.company_id,
      voucherType: 'journal',
      voucherDate: noteDate,
      narration: `Credit note ${note.number} on invoice ${invoice.invoice_no}: ${dto.reason}`,
      sourceType: CREDIT_NOTE_SOURCE,
      sourceId: note.id,
      lines: [
        { accountId: account('sales.revenue'), debit: note.value },
        ...(tax.isPositive()
          ? [{ accountId: account('vat.output'), debit: tax.toDb() }]
          : []),
        {
          accountId: account('receivables.control'),
          credit: note.total,
          narration: `${invoice.customer_name} ${invoice.invoice_no}`,
        },
      ],
    });
    await this.db.tx
      .updateTable('credit_notes')
      .set({ voucher_id: voucher.id })
      .where('id', '=', note.id)
      .execute();
    await this.db.tx
      .updateTable('receivable_items')
      .set({ credited: sql`credited + ${note.total}::numeric` })
      .where('sales_invoice_id', '=', invoiceId)
      .execute();
    if (dto.returnToStock)
      await this.returnStock(
        invoice,
        note.id,
        note.number,
        noteDate,
        lines.map((l) => ({
          productId: l.line.product_id,
          quantity: l.quantity,
        })),
      );
    await this.audit.record({
      action: 'credit_note.created',
      entity: 'sales_invoice',
      entityId: invoiceId,
      after: {
        number: note.number,
        total: note.total,
        reason: dto.reason,
        voucher: voucher.number,
      },
    });
    return this.get(invoiceId);
  }

  async find(id: string): Promise<SalesInvoice> {
    const i = await this.db.tx
      .selectFrom('sales_invoices')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!i) throw new NotFoundException(MSG.INVOICE_NOT_FOUND);
    return i;
  }

  // ================================================================ internals

  /** Returned goods back into the store the order left from (products kept in a store only). */
  private async returnStock(
    invoice: SalesInvoice,
    noteId: string,
    noteNo: string,
    on: string,
    lines: Array<{ productId: string; quantity: string }>,
  ) {
    const order = await this.orders.find(invoice.order_id);
    const products = await this.db.tx
      .selectFrom('products')
      .select(['id', 'stock_item_id'])
      .where(
        'id',
        'in',
        lines.map((l) => l.productId),
      )
      .execute();
    const back = new Map<string, Decimal>();
    for (const l of lines) {
      const item = products.find((p) => p.id === l.productId)?.stock_item_id;
      if (item)
        back.set(item, (back.get(item) ?? new Decimal(0)).plus(l.quantity));
    }
    if (!back.size) return;
    if (!order.store_id) throw new BadRequestException(MSG.SALES_STORE_NEEDED);
    await this.db.tx
      .insertInto('stock_moves')
      .values(
        [...back].map(([itemId, qty]) => ({
          store_id: order.store_id!,
          item_id: itemId,
          move_date: on,
          kind: 'sales_return' as const,
          quantity: qty.toString(),
          reference: `${noteNo} · ${invoice.invoice_no}`,
          credit_note_id: noteId,
        })),
      )
      .execute();
  }

  /** The month's invoice lines, and credit note lines as negatives (the VAT return's sales side). */
  private async registerLines(companyId: string, period: string) {
    const r = monthRange(period);
    const invoiced = await this.db.tx
      .selectFrom('sales_invoice_lines as l')
      .innerJoin('sales_invoices as i', 'i.id', 'l.invoice_id')
      .select(['l.rate_class', 'l.value', 'l.sd_amount', 'l.vat_amount'])
      .where('i.company_id', '=', companyId)
      .where('i.invoice_date', '>=', r.from)
      .where('i.invoice_date', '<=', r.to)
      .execute();
    const credited = await this.db.tx
      .selectFrom('credit_note_lines as l')
      .innerJoin('credit_notes as n', 'n.id', 'l.credit_note_id')
      .select(['l.rate_class', 'l.value', 'l.sd_amount', 'l.vat_amount'])
      .where('n.company_id', '=', companyId)
      .where('n.note_date', '>=', r.from)
      .where('n.note_date', '<=', r.to)
      .execute();
    const neg = (x: string) => Money.of(x).negate().toDb();
    return [
      ...invoiced,
      ...credited.map((c) => ({
        ...c,
        value: neg(c.value),
        sd_amount: neg(c.sd_amount),
        vat_amount: neg(c.vat_amount),
      })),
    ];
  }

  private async accounts(companyId: string, keys: string[]) {
    const account = await this.ledger.resolvePostingAccounts(companyId);
    const missing = keys.filter((k) => !account(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });
    return (key: string) => account(key)!;
  }

  private async nextNoteNo(companyId: string, date: string): Promise<string> {
    const fy = vatYearOf(date);
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'credit_note',
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
    return `CN/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private toInvoice(i: SalesInvoice) {
    return {
      id: i.id,
      companyId: i.company_id,
      invoiceNo: i.invoice_no,
      orderId: i.order_id,
      customerId: i.customer_id,
      invoiceDate: i.invoice_date,
      dueDate: i.due_date,
      customerName: i.customer_name,
      customerBin: i.customer_bin,
      customerAddress: i.customer_address,
      value: i.value,
      sdAmount: i.sd_amount,
      vatAmount: i.vat_amount,
      total: i.total,
    };
  }
}
