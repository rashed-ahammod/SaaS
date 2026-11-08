/**
 * VAT items, their rates per fiscal year, and the sales and purchase registers (WP21).
 *
 *   items / rates     what the company buys and sells; a rate per national fiscal year
 *                     (July-June: the budget changes rates every July); the standard set in
 *                     one click; a year's rates copied to the next
 *   rateFor(item, date)   for vendor bill lines that name an item (VendorBillsService)
 *   sales             a VAT invoice (Mushak 6.3, numbered VI/2026-27/00001) and its receipt
 *                     voucher, which goes to the checker: Dr cash / bank (received),
 *                     Dr output VAT (what the customer deducted at source), Cr sales,
 *                     Cr output VAT (VAT and SD). Counts in the return once posted.
 *   salesRegister / purchaseRegister   the month's Mushak 6.2 / 6.1 data
 *
 * A month whose return is filed takes no new invoice, and its invoices cannot be reversed.
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
import {
  businessDate,
  fiscalYearOf,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  VatItem,
  VatRateClass,
  VatSale,
  Voucher,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { VendorBillsService } from '../payables/vendor-bills.service.js';
import type {
  CopyRatesDto,
  PeriodQueryDto,
  UpdateVatItemDto,
  VatItemDto,
  VatSaleDto,
} from './dto/vat.dto.js';
import { classOf, DEFAULT_ITEMS, saleLine } from './mushak.js';

export const VAT_SALE_SOURCE = 'vat_sale';

/** Another module's sales documents in the register (WP26 invoices and credit notes, WP27 VAT deducted by customers on receipts). */
export interface SalesRegisterSource {
  /** the voucher source types that post to output VAT */
  sources: string[];
  /** the month's lines (credit notes as negatives) */
  lines?: (
    companyId: string,
    period: string,
  ) => Promise<
    Array<{
      rate_class: VatRateClass;
      value: string;
      sd_amount: string;
      vat_amount: string;
    }>
  >;
  /** VAT the company's customers deducted at source in the month (their Mushak 6.6 certificates) */
  vds?: (companyId: string, period: string) => Promise<string>;
}

/** National fiscal year (July-June) of a date. */
export const vatYearOf = (date: string) =>
  fiscalYearOf(businessDate(date), '07-01');
const monthRange = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return {
    from: `${period}-01`,
    to: `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`,
  };
};

@Injectable()
export class VatService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly bills: VendorBillsService,
  ) {}

  onModuleInit() {
    this.bills.registerVatRates(this);
    this.vouchers.registerSource(VAT_SALE_SOURCE, {
      onPosted: (v) => this.setSaleState(v, 'posted'),
      onDropped: (v) => this.setSaleState(v, 'cancelled'),
      assertReversible: (v) =>
        this.assertMonthOpen(v.company_id, v.voucher_date),
      onReversed: (v) => this.setSaleState(v, 'reversed'),
    });
  }

  // ================================================================ items and rates

  async listItems(companyId: string, fiscalYear?: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.view', { companyId });
    const items = await this.db.tx
      .selectFrom('vat_items')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    const rates = items.length
      ? await this.db.tx
          .selectFrom('vat_item_rates')
          .selectAll()
          .where(
            'item_id',
            'in',
            items.map((i) => i.id),
          )
          .orderBy('fiscal_year_code', 'desc')
          .execute()
      : [];
    return items.map((i) => ({
      ...this.toItem(i),
      rates: rates
        .filter(
          (r) =>
            r.item_id === i.id &&
            (!fiscalYear || r.fiscal_year_code === fiscalYear),
        )
        .map((r) => ({
          fiscalYear: r.fiscal_year_code,
          rateClass: r.rate_class,
          vatPercent: r.vat_percent,
          sdPercent: r.sd_percent,
        })),
    }));
  }

  async createItem(companyId: string, dto: VatItemDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.manage', { companyId });
    const item = await this.db.tx
      .insertInto('vat_items')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn,
        name_bn: dto.nameBn ?? null,
        kind: dto.kind,
        nbr_code: dto.nbrCode ?? null,
        unit: dto.unit ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.setRate(item.id, dto.rate);
    await this.audit.record({
      action: 'vat_item.created',
      entity: 'vat_item',
      entityId: item.id,
      after: { code: dto.code, rate: dto.rate },
    });
    return (await this.listItems(companyId)).find((i) => i.id === item.id)!;
  }

  async updateItem(id: string, dto: UpdateVatItemDto) {
    const item = await this.findItem(id);
    this.access.assert('vat.manage', { companyId: item.company_id });
    const row = await this.db.tx
      .updateTable('vat_items')
      .set({
        ...(dto.nameEn !== undefined ? { name_en: dto.nameEn } : {}),
        ...(dto.nameBn !== undefined ? { name_bn: dto.nameBn || null } : {}),
        ...(dto.nbrCode !== undefined ? { nbr_code: dto.nbrCode || null } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit || null } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'vat_item.updated',
      entity: 'vat_item',
      entityId: id,
      before: this.toItem(item),
      after: this.toItem(row),
    });
    return (await this.listItems(item.company_id)).find((i) => i.id === id)!;
  }

  /** Set (or change) an item's rate for a fiscal year. A year with filed returns keeps its rates. */
  async putRate(
    itemId: string,
    dto: {
      fiscalYear: string;
      rateClass: VatRateClass;
      vatPercent: string;
      sdPercent?: string;
    },
  ) {
    const item = await this.findItem(itemId);
    this.access.assert('vat.manage', { companyId: item.company_id });
    const before = await this.db.tx
      .selectFrom('vat_item_rates')
      .selectAll()
      .where('item_id', '=', itemId)
      .where('fiscal_year_code', '=', dto.fiscalYear)
      .executeTakeFirst();
    if (before) {
      const start = Number(dto.fiscalYear.slice(0, 4));
      const filed = await this.db.tx
        .selectFrom('vat_returns')
        .select('id')
        .where('company_id', '=', item.company_id)
        .where('period', '>=', `${start}-07`)
        .where('period', '<=', `${start + 1}-06`)
        .executeTakeFirst();
      if (filed) throw new ConflictException(MSG.VAT_PERIOD_FILED);
    }
    await this.setRate(itemId, dto);
    await this.audit.record({
      action: 'vat_rate.set',
      entity: 'vat_item',
      entityId: itemId,
      before: before ?? undefined,
      after: dto,
    });
    return (await this.listItems(item.company_id)).find(
      (i) => i.id === itemId,
    )!;
  }

  /** The standard items with placeholder rates for a fiscal year (skips codes that exist). */
  async createDefaultItems(companyId: string, fiscalYear: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.manage', { companyId });
    const have = new Set(
      (
        await this.db.tx
          .selectFrom('vat_items')
          .select('code')
          .where('company_id', '=', companyId)
          .execute()
      ).map((r) => r.code),
    );
    for (const d of DEFAULT_ITEMS.filter((x) => !have.has(x.code))) {
      await this.createItem(companyId, {
        code: d.code,
        nameEn: d.nameEn,
        nameBn: d.nameBn,
        kind: d.kind,
        nbrCode: d.nbrCode ?? undefined,
        unit: d.unit ?? undefined,
        rate: {
          fiscalYear,
          rateClass: d.rateClass,
          vatPercent: d.vatPercent,
          sdPercent: d.sdPercent,
        },
      });
    }
    return this.listItems(companyId);
  }

  /** Every rate of one fiscal year carried to the next (items that have one already keep it). */
  async copyRates(companyId: string, dto: CopyRatesDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.manage', { companyId });
    const rows = await this.db.tx
      .selectFrom('vat_item_rates as r')
      .innerJoin('vat_items as i', 'i.id', 'r.item_id')
      .select(['r.item_id', 'r.rate_class', 'r.vat_percent', 'r.sd_percent'])
      .where('i.company_id', '=', companyId)
      .where('r.fiscal_year_code', '=', dto.from)
      .execute();
    let copied = 0;
    for (const r of rows) {
      const done = await this.db.tx
        .insertInto('vat_item_rates')
        .values({
          item_id: r.item_id,
          fiscal_year_code: dto.to,
          rate_class: r.rate_class,
          vat_percent: r.vat_percent,
          sd_percent: r.sd_percent,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'item_id', 'fiscal_year_code']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      if (done) copied++;
    }
    await this.audit.record({
      action: 'vat_rate.copied',
      entity: 'company',
      entityId: companyId,
      after: { ...dto, copied },
    });
    return { copied };
  }

  /** The rate of an item on a date (vendor bills and sales). */
  async rateFor(itemId: string, companyId: string, date: string) {
    const item = await this.findItem(itemId);
    if (item.company_id !== companyId || !item.is_active)
      throw new BadRequestException(MSG.VAT_ITEM_NOT_FOUND);
    const fy = vatYearOf(date);
    const rate = await this.db.tx
      .selectFrom('vat_item_rates')
      .selectAll()
      .where('item_id', '=', itemId)
      .where('fiscal_year_code', '=', fy)
      .executeTakeFirst();
    if (!rate)
      throw new BadRequestException({
        message: MSG.VAT_RATE_MISSING,
        details: { item: item.code, fiscalYear: fy },
      });
    return {
      item,
      rateClass: rate.rate_class,
      vatPercent: rate.vat_percent,
      sdPercent: rate.sd_percent,
    };
  }

  // ================================================================ sales register

  async createSale(companyId: string, dto: VatSaleDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.manage', { companyId });
    await this.assertMonthOpen(companyId, dto.invoiceDate);
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
    const account = await this.ledger.resolvePostingAccounts(companyId);
    const missing = ['vat.output', 'vat.sales'].filter((k) => !account(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });

    // each line at its item's rate for the invoice's fiscal year
    const lines = [];
    for (const l of dto.lines) {
      const rate = await this.rateFor(l.itemId, companyId, dto.invoiceDate);
      const value = Money.of(l.value).toDb();
      lines.push({
        ...l,
        value,
        rateClass: rate.rateClass,
        vatPercent: rate.vatPercent,
        sdPercent: rate.sdPercent,
        ...saleLine(value, rate),
      });
    }
    const value = Money.sum(lines.map((l) => l.value));
    const sd = Money.sum(lines.map((l) => l.sdAmount));
    const vat = Money.sum(lines.map((l) => l.vatAmount));
    const vds = Money.of(dto.vdsByCustomer ?? '0');
    if (vds.greaterThan(vat))
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            'VAT deducted by the customer cannot exceed the invoice VAT',
          ],
        },
      });
    const received = value.plus(sd).plus(vat).minus(vds);

    const sale = await this.db.tx
      .insertInto('vat_sales')
      .values({
        company_id: companyId,
        invoice_no: await this.nextInvoiceNo(companyId, dto.invoiceDate),
        invoice_date: dto.invoiceDate,
        customer_name: dto.customerName,
        customer_bin: dto.customerBin ?? null,
        customer_address: dto.customerAddress ?? null,
        received_into_account_id: money.id,
        value: value.toDb(),
        sd_amount: sd.toDb(),
        vat_amount: vat.toDb(),
        vds_by_customer: vds.toDb(),
        vds_certificate_no: dto.vdsCertificateNo ?? null,
        received_amount: received.toDb(),
        note: dto.note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('vat_sale_lines')
      .values(
        lines.map((l, i) => ({
          sale_id: sale.id,
          line_no: i + 1,
          item_id: l.itemId,
          description: l.description,
          quantity: l.quantity ?? null,
          value: l.value,
          rate_class: l.rateClass,
          vat_percent: l.vatPercent,
          sd_percent: l.sdPercent,
          sd_amount: l.sdAmount,
          vat_amount: l.vatAmount,
        })),
      )
      .execute();
    const voucher = await this.vouchers.createLinked({
      companyId,
      voucherType: 'receipt',
      voucherDate: dto.invoiceDate,
      narration: `VAT invoice ${sale.invoice_no}: ${dto.customerName}`,
      sourceType: VAT_SALE_SOURCE,
      sourceId: sale.id,
      lines: [
        {
          accountId: money.id,
          debit: received.toDb(),
          narration: `Invoice ${sale.invoice_no}`,
        },
        {
          accountId: account('vat.output')!,
          debit: vds.toDb(),
          narration:
            `VAT deducted by the customer, certificate ${dto.vdsCertificateNo ?? ''}`.trim(),
        },
        { accountId: account('vat.sales')!, credit: value.toDb() },
        {
          accountId: account('vat.output')!,
          credit: sd.plus(vat).toDb(),
          narration: `Output VAT${sd.isPositive() ? ' and SD' : ''}, invoice ${sale.invoice_no}`,
        },
      ].filter((l) => Money.of(l.debit ?? l.credit ?? '0').isPositive()),
    });
    await this.db.tx
      .updateTable('vat_sales')
      .set({ voucher_id: voucher.id })
      .where('id', '=', sale.id)
      .execute();
    await this.audit.record({
      action: 'vat_sale.created',
      entity: 'vat_sale',
      entityId: sale.id,
      after: {
        invoiceNo: sale.invoice_no,
        customer: dto.customerName,
        value: sale.value,
        vat: sale.vat_amount,
        sd: sale.sd_amount,
        vds: sale.vds_by_customer,
        voucher: voucher.number,
      },
    });
    return this.getSale(sale.id);
  }

  async listSales(companyId: string, query: PeriodQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.view', { companyId });
    let q = this.db.tx
      .selectFrom('vat_sales as s')
      .leftJoin('vouchers as v', 'v.id', 's.voucher_id')
      .selectAll('s')
      .select('v.number as voucher_number')
      .where('s.company_id', '=', companyId);
    if (query.period) {
      const r = monthRange(query.period);
      q = q
        .where('s.invoice_date', '>=', r.from)
        .where('s.invoice_date', '<=', r.to);
    }
    const rows = await q
      .orderBy('s.invoice_date', 'desc')
      .orderBy('s.invoice_no', 'desc')
      .limit(1000)
      .execute();
    return rows.map((s) => ({
      ...this.toSale(s),
      voucherNumber: s.voucher_number,
    }));
  }

  async getSale(id: string) {
    const s = await this.db.tx
      .selectFrom('vat_sales')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundException(MSG.VAT_SALE_NOT_FOUND);
    this.access.assert('vat.view', { companyId: s.company_id });
    const lines = await this.db.tx
      .selectFrom('vat_sale_lines as l')
      .innerJoin('vat_items as i', 'i.id', 'l.item_id')
      .select([
        'l.line_no',
        'l.item_id',
        'i.code',
        'i.name_en',
        'i.nbr_code',
        'l.description',
        'l.quantity',
        'l.value',
        'l.rate_class',
        'l.vat_percent',
        'l.sd_percent',
        'l.sd_amount',
        'l.vat_amount',
      ])
      .where('l.sale_id', '=', id)
      .orderBy('l.line_no')
      .execute();
    const voucher = s.voucher_id
      ? await this.db.tx
          .selectFrom('vouchers')
          .select(['number', 'approval_request_id'])
          .where('id', '=', s.voucher_id)
          .executeTakeFirst()
      : undefined;
    return {
      ...this.toSale(s),
      voucherNumber: voucher?.number ?? null,
      approvalRequestId: voucher?.approval_request_id ?? null,
      lines: lines.map((l) => ({
        lineNo: l.line_no,
        itemId: l.item_id,
        itemCode: l.code,
        itemName: l.name_en,
        nbrCode: l.nbr_code,
        description: l.description,
        quantity: l.quantity,
        value: l.value,
        rateClass: l.rate_class,
        vatPercent: l.vat_percent,
        sdPercent: l.sd_percent,
        sdAmount: l.sd_amount,
        vatAmount: l.vat_amount,
      })),
    };
  }

  /** Mushak 6.1 data: the month's approved bills, line by line, with claimable input VAT. */
  async purchaseRegister(companyId: string, query: PeriodQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.view', { companyId });
    return this.purchaseLines(
      companyId,
      query.period ?? new Date().toISOString().slice(0, 7),
    );
  }

  /** For the return: posted sales of a month, line by line. */
  private readonly salesSources: SalesRegisterSource[] = [];

  registerSalesSource(source: SalesRegisterSource) {
    this.salesSources.push(source);
  }

  /** The voucher sources whose output VAT the return explains. */
  outputVatSources(): string[] {
    return [VAT_SALE_SOURCE, ...this.salesSources.flatMap((s) => s.sources)];
  }

  async saleLines(companyId: string, period: string) {
    const own = await this.ownSaleLines(companyId, period);
    const others = await Promise.all(
      this.salesSources.map(
        (s) => s.lines?.(companyId, period) ?? Promise.resolve([]),
      ),
    );
    return [...own, ...others.flat()];
  }

  private async ownSaleLines(companyId: string, period: string) {
    const r = monthRange(period);
    return this.db.tx
      .selectFrom('vat_sale_lines as l')
      .innerJoin('vat_sales as s', 's.id', 'l.sale_id')
      .select(['l.rate_class', 'l.value', 'l.sd_amount', 'l.vat_amount'])
      .where('s.company_id', '=', companyId)
      .where('s.state', '=', 'posted')
      .where('s.invoice_date', '>=', r.from)
      .where('s.invoice_date', '<=', r.to)
      .execute();
  }

  async vdsByCustomers(companyId: string, period: string): Promise<string> {
    const r = monthRange(period);
    const row = await this.db.tx
      .selectFrom('vat_sales')
      .select(sql<string>`coalesce(sum(vds_by_customer), 0)::text`.as('s'))
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .where('invoice_date', '>=', r.from)
      .where('invoice_date', '<=', r.to)
      .executeTakeFirstOrThrow();
    const others = await Promise.all(
      this.salesSources.map(
        (s) => s.vds?.(companyId, period) ?? Promise.resolve('0'),
      ),
    );
    return Money.sum([row.s, ...others]).toDb();
  }

  /** Approved bills of a month, line by line (input VAT is claimable only with the supplier's BIN). */
  async purchaseLines(companyId: string, period: string) {
    const r = monthRange(period);
    const rows = await this.db.tx
      .selectFrom('vendor_bill_lines as l')
      .innerJoin('vendor_bills as b', 'b.id', 'l.bill_id')
      .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
      .leftJoin('vat_items as i', 'i.id', 'l.vat_item_id')
      .select([
        'b.id as bill_id',
        'b.bill_no',
        'b.bill_date',
        'v.name as vendor_name',
        'v.bin',
        'b.input_vat',
        'b.vat_in_cost',
        'l.line_no',
        'l.description',
        'l.amount',
        'l.vat_percent',
        'l.vat_amount',
        'l.vat_rate_class',
        'i.code as item_code',
      ])
      .where('b.company_id', '=', companyId)
      .where('b.state', '=', 'approved')
      .where('b.bill_date', '>=', r.from)
      .where('b.bill_date', '<=', r.to)
      .orderBy('b.bill_date')
      .orderBy('b.bill_no')
      .orderBy('l.line_no')
      .execute();
    return rows.map((l) => ({
      billId: l.bill_id,
      billNo: l.bill_no,
      billDate: l.bill_date,
      vendorName: l.vendor_name,
      vendorBin: l.bin,
      lineNo: l.line_no,
      description: l.description,
      itemCode: l.item_code,
      value: l.amount,
      vatPercent: l.vat_percent,
      vatAmount: l.vat_amount,
      rateClass: (l.vat_rate_class ?? classOf(l.vat_percent)) as VatRateClass,
      claimable: Money.of(l.vat_in_cost).isZero(),
    }));
  }

  /** A month whose return is filed takes no change. */
  async assertMonthOpen(companyId: string, date: string) {
    const filed = await this.db.tx
      .selectFrom('vat_returns')
      .select('id')
      .where('company_id', '=', companyId)
      .where('period', '=', date.slice(0, 7))
      .executeTakeFirst();
    if (filed) throw new ConflictException(MSG.VAT_PERIOD_FILED);
  }

  // ================================================================ internals

  private async setSaleState(
    v: Voucher,
    state: 'posted' | 'cancelled' | 'reversed',
  ) {
    await this.db.tx
      .updateTable('vat_sales')
      .set({ state })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private async setRate(
    itemId: string,
    r: {
      fiscalYear: string;
      rateClass: VatRateClass;
      vatPercent: string;
      sdPercent?: string;
    },
  ) {
    const values = {
      rate_class: r.rateClass,
      vat_percent: Money.of(r.vatPercent).toDb(),
      sd_percent: Money.of(r.sdPercent ?? '0').toDb(),
    };
    if (
      ['zero', 'exempt'].includes(r.rateClass) !==
      Money.of(r.vatPercent).isZero()
    ) {
      throw new BadRequestException({
        message: MSG.VALIDATION_FAILED,
        details: {
          problems: [
            'Zero-rated and exempt items have 0 % VAT; the other classes a rate above 0',
          ],
        },
      });
    }
    await this.db.tx
      .insertInto('vat_item_rates')
      .values({ item_id: itemId, fiscal_year_code: r.fiscalYear, ...values })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'item_id', 'fiscal_year_code'])
          .doUpdateSet(values),
      )
      .execute();
  }

  /** The next Mushak 6.3 number: one gapless series for VAT sales and customer invoices (WP26). */
  async nextInvoiceNo(companyId: string, date: string): Promise<string> {
    const fy = vatYearOf(date);
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: 'vat_invoice',
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
    return `VI/${fy}/${String(row.last_no).padStart(5, '0')}`;
  }

  private async findItem(id: string): Promise<VatItem> {
    const item = await this.db.tx
      .selectFrom('vat_items')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!item) throw new NotFoundException(MSG.VAT_ITEM_NOT_FOUND);
    return item;
  }

  private toItem(i: VatItem) {
    return {
      id: i.id,
      companyId: i.company_id,
      code: i.code,
      nameEn: i.name_en,
      nameBn: i.name_bn,
      kind: i.kind,
      nbrCode: i.nbr_code,
      unit: i.unit,
      isActive: i.is_active,
      version: i.version,
    };
  }

  private toSale(s: VatSale) {
    return {
      id: s.id,
      companyId: s.company_id,
      invoiceNo: s.invoice_no,
      invoiceDate: s.invoice_date,
      customerName: s.customer_name,
      customerBin: s.customer_bin,
      customerAddress: s.customer_address,
      receivedIntoAccountId: s.received_into_account_id,
      value: s.value,
      sdAmount: s.sd_amount,
      vatAmount: s.vat_amount,
      vdsByCustomer: s.vds_by_customer,
      vdsCertificateNo: s.vds_certificate_no,
      receivedAmount: s.received_amount,
      state: s.state,
      voucherId: s.voucher_id,
      note: s.note,
      createdAt: s.created_at,
    };
  }
}
