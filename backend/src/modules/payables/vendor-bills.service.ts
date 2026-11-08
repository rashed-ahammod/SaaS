/**
 * Vendor bills (spec §6.6 sub-ledger "vendors (payables)", §6.7 step 3, §11).
 *
 *   create / update   Accounts enters the vendor's invoice (Mushak 6.3) as a draft:
 *                     expense lines with cost centre and VAT rate; the tax at source
 *                     is worked out at once from the rule pack (preview)
 *   submit            worked out again (rates of the bill date), frozen, and sent to
 *                     another Accounts user (Admin too from Tk 10 lakh)
 *   (approved)        posted as a journal on the bill date:
 *                       Dr expense lines (+ VAT that is cost), Dr input VAT
 *                       Cr income tax at source, Cr VAT at source, Cr payable to the vendor
 *                     and the withholdings are recorded for challan and certificate
 *   reverse           only through the ledger (reverse the bill's journal), and only
 *                     while nothing is paid or deposited: the bill is then void
 *
 * No duplicate bills: one live bill per vendor and invoice number (also the database).
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
import { addDays, businessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  VatRateClass,
  Vendor,
  VendorBill,
  Voucher,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import {
  VouchersService,
  type PostingLine,
} from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  BillLineDto,
  BillQueryDto,
  CreateBillDto,
  UpdateBillDto,
} from './dto/payables.dto.js';
import { VendorsService } from './vendors.service.js';
import { computeWithholding, type WithholdingResult } from './withholding.js';

export const VENDOR_BILL_REQUEST = 'vendor_bill';

/**
 * Procurement (WP17) plugs in here: a bill against a purchase order is checked
 * against it (same vendor, PO lines) and three-way matched; the result is stored on
 * the bill, and a mismatched bill cannot be paid.
 */
export interface PurchaseOrderLink {
  validate(input: {
    companyId: string;
    vendorId: string;
    purchaseOrderId: string;
    lines: BillLineDto[];
  }): Promise<void>;
  /** work out and store the match of a bill against its PO */
  match(billId: string): Promise<void>;
  /** a bill of the PO was cancelled or voided: the others may match now */
  rematchOrder(purchaseOrderId: string): Promise<void>;
}
export const VENDOR_BILL_SOURCE = 'vendor_bill';

/** VAT (WP21) plugs in here: a bill line that names a VAT item takes the item's rate for the bill's fiscal year. */
export interface VatRateLookup {
  rateFor(
    itemId: string,
    companyId: string,
    date: string,
  ): Promise<{ rateClass: VatRateClass; vatPercent: string }>;
}

interface ComputedLine extends BillLineDto {
  vatPercent: string;
  vatAmount: string;
  vatRateClass?: VatRateClass | null;
}

interface ComputedBill {
  lines: ComputedLine[];
  base: string;
  vat: string;
  withholding: WithholdingResult;
  vdsEntity: boolean;
  pack: string;
}

@Injectable()
export class VendorBillsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly vendors: VendorsService,
  ) {}

  private poLink?: PurchaseOrderLink;
  private vatRates?: VatRateLookup;

  registerPurchaseOrderLink(link: PurchaseOrderLink) {
    this.poLink = link;
  }

  registerVatRates(lookup: VatRateLookup) {
    this.vatRates = lookup;
  }

  /** Bills without a PO must not name PO lines; bills with one go through procurement. */
  private async checkPurchaseOrder(
    companyId: string,
    vendorId: string,
    purchaseOrderId: string | null | undefined,
    lines: BillLineDto[],
  ) {
    if (!purchaseOrderId) {
      if (lines.some((l) => l.poLineId || l.quantity))
        throw new BadRequestException(MSG.BILL_PO_INVALID);
      return;
    }
    if (!this.poLink) throw new BadRequestException(MSG.BILL_PO_INVALID);
    await this.poLink.validate({ companyId, vendorId, purchaseOrderId, lines });
  }

  onModuleInit() {
    // like a payment voucher (spec §5): Accounts maker -> Accounts checker; above the limit -> Admin
    this.handlers.register(
      VENDOR_BILL_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [
        conditionalChain(
          'Vendor bill Tk 10 lakh or more (default)',
          { minAmount: '1000000' },
          step(1, 'role:accounts'),
          step(2, 'role:admin'),
        ),
        defaultChain('Vendor bill (default)', step(1, 'role:accounts')),
      ],
    );
    // the bill's journal may be reversed only while nothing is paid or deposited
    this.vouchers.registerSource(VENDOR_BILL_SOURCE, {
      assertReversible: (v) => this.assertVoidable(v),
      onReversed: (v) => this.voided(v),
    });
  }

  // ================================================================ maker

  async create(companyId: string, dto: CreateBillDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.manage', { companyId });
    const vendor = await this.vendorOf(companyId, dto.vendorId);
    await this.assertNotDuplicate(vendor.id, dto.billNo);

    // amounts, VAT and tax at source
    const category = dto.withholdingCategory ?? vendor.withholding_category;
    await this.checkPurchaseOrder(
      companyId,
      vendor.id,
      dto.purchaseOrderId,
      dto.lines,
    );
    const computed = await this.compute(
      companyId,
      vendor,
      dto.billDate,
      category,
      dto.lines,
    );
    const dueDate =
      dto.dueDate ?? (await this.dueDateFor(companyId, vendor, dto.billDate));
    if (dueDate < dto.billDate)
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    const bill = await this.db.tx
      .insertInto('vendor_bills')
      .values({
        company_id: companyId,
        vendor_id: vendor.id,
        bill_no: dto.billNo,
        bill_date: dto.billDate,
        due_date: dueDate,
        narration: dto.narration,
        withholding_category: category,
        ...amountColumns(computed),
        purchase_order_id: dto.purchaseOrderId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(bill.id, computed.lines);
    if (bill.purchase_order_id) await this.poLink!.match(bill.id);
    await this.audit.record({
      action: 'vendor_bill.created',
      entity: 'vendor_bill',
      entityId: bill.id,
      after: {
        vendor: vendor.code,
        billNo: dto.billNo,
        total: Money.of(computed.base).plus(computed.vat).toDb(),
        netPayable: computed.withholding.netPayable,
      },
    });
    return this.get(bill.id);
  }

  async update(id: string, dto: UpdateBillDto) {
    const bill = await this.find(id);
    this.access.assert('payables.manage', { companyId: bill.company_id });
    if (bill.state !== 'draft')
      throw new ConflictException(MSG.BILL_WRONG_STATE);
    if (bill.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    const vendor = await this.vendors.find(bill.vendor_id);
    if (dto.billNo && dto.billNo.toLowerCase() !== bill.bill_no.toLowerCase())
      await this.assertNotDuplicate(vendor.id, dto.billNo, bill.id);

    // work everything out again with the changes
    const billDate = dto.billDate ?? bill.bill_date;
    const category = dto.withholdingCategory ?? bill.withholding_category;
    const lines = dto.lines ?? (await this.linesAsDto(id));
    if (dto.lines)
      await this.checkPurchaseOrder(
        bill.company_id,
        vendor.id,
        bill.purchase_order_id,
        dto.lines,
      );
    const computed = await this.compute(
      bill.company_id,
      vendor,
      billDate,
      category,
      lines,
    );
    const dueDate =
      dto.dueDate ??
      (dto.billDate
        ? await this.dueDateFor(bill.company_id, vendor, billDate)
        : bill.due_date);
    if (dueDate < billDate)
      throw new BadRequestException(MSG.VALIDATION_FAILED);

    if (dto.lines) {
      await this.db.tx
        .deleteFrom('vendor_bill_lines')
        .where('bill_id', '=', id)
        .execute();
      await this.insertLines(id, computed.lines);
    }
    await this.db.tx
      .updateTable('vendor_bills')
      .set({
        ...(dto.billNo ? { bill_no: dto.billNo } : {}),
        ...(dto.narration ? { narration: dto.narration } : {}),
        bill_date: billDate,
        due_date: dueDate,
        withholding_category: category,
        ...amountColumns(computed),
      })
      .where('id', '=', id)
      .execute();
    if (bill.purchase_order_id) await this.poLink!.match(id);
    await this.audit.record({
      action: 'vendor_bill.updated',
      entity: 'vendor_bill',
      entityId: id,
      after: { ...dto, netPayable: computed.withholding.netPayable },
    });
    return this.get(id);
  }

  /** To the checker: the rates of the bill date are applied again and frozen. */
  async submit(id: string) {
    const bill = await this.find(id);
    this.access.assert('payables.manage', { companyId: bill.company_id });
    if (bill.state !== 'draft')
      throw new ConflictException(MSG.BILL_WRONG_STATE);
    const vendor = await this.vendors.find(bill.vendor_id);
    if (!vendor.is_active) throw new BadRequestException(MSG.VENDOR_INACTIVE);
    const computed = await this.compute(
      bill.company_id,
      vendor,
      bill.bill_date,
      bill.withholding_category,
      await this.linesAsDto(id),
    );
    await this.db.tx
      .updateTable('vendor_bills')
      .set(amountColumns(computed))
      .where('id', '=', id)
      .execute();

    // the posting must be possible: books set up, posting accounts, open month
    await this.postingLines(await this.find(id), computed.lines);
    if (!(await this.vouchers.canPostOn(bill.company_id, bill.bill_date)))
      throw new ConflictException(MSG.PERIOD_CLOSED);

    // the match as it stands now (it is worked out again when more is received)
    if (bill.purchase_order_id) await this.poLink!.match(id);

    const total = Money.of(computed.base).plus(computed.vat).toDb();
    const request = await this.approvals.submit({
      requestType: VENDOR_BILL_REQUEST,
      sourceId: id,
      subjectEmployeeId: null,
      companyId: bill.company_id,
      summary: `Vendor bill ${bill.bill_no}: ${vendor.name}, Tk ${total}`,
      amount: total,
      kind: bill.withholding_category,
      snapshot: {
        vendor: `${vendor.code} ${vendor.name}`,
        tin: vendor.tin,
        bin: vendor.bin,
        billNo: bill.bill_no,
        billDate: bill.bill_date,
        dueDate: bill.due_date,
        narration: bill.narration,
        base: computed.base,
        vat: computed.vat,
        category: bill.withholding_category,
        tds: `${computed.withholding.tds} (${computed.withholding.tdsPercent}%)`,
        vds: `${computed.withholding.vds} (${computed.withholding.vdsPercent}% of VAT)`,
        netPayable: computed.withholding.netPayable,
        rulePack: computed.pack,
      },
    });
    await this.db.tx
      .updateTable('vendor_bills')
      .set({ state: 'in_approval', approval_request_id: request.id })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'vendor_bill.submitted',
      entity: 'vendor_bill',
      entityId: id,
      after: { billNo: bill.bill_no, approvalRequestId: request.id },
    });
    return this.get(id);
  }

  async cancel(id: string, reason: string) {
    const bill = await this.find(id);
    this.access.assert('payables.manage', { companyId: bill.company_id });
    if (bill.state !== 'draft')
      throw new ConflictException(MSG.BILL_WRONG_STATE);
    await this.db.tx
      .updateTable('vendor_bills')
      .set({ state: 'cancelled', cancel_reason: reason })
      .where('id', '=', id)
      .execute();
    if (bill.purchase_order_id)
      await this.poLink?.rematchOrder(bill.purchase_order_id);
    await this.audit.record({
      action: 'vendor_bill.cancelled',
      entity: 'vendor_bill',
      entityId: id,
      after: { billNo: bill.bill_no, reason },
    });
    return this.get(id);
  }

  // ======================================================= approval hooks

  /** Approved: the journal on the bill date, and the withholdings. */
  private async approved(request: ApprovalRequest) {
    const bill = await this.find(request.source_id);
    const lines = await this.linesAsDto(bill.id);
    const voucher = await this.vouchers.postAutomatic({
      companyId: bill.company_id,
      voucherType: 'journal',
      voucherDate: bill.bill_date,
      narration: `Vendor bill ${bill.bill_no}: ${bill.narration}`,
      sourceType: VENDOR_BILL_SOURCE,
      sourceId: bill.id,
      lines: await this.postingLines(
        bill,
        lines.map((l) => ({ ...l, vatPercent: l.vatPercent ?? '0' })),
      ),
    });
    await this.db.tx
      .updateTable('vendor_bills')
      .set({ state: 'approved', voucher_id: voucher.id })
      .where('id', '=', bill.id)
      .execute();

    // what was withheld, for the challan and the certificate
    const withholdings = [
      {
        tax_type: 'tds' as const,
        base: bill.base_amount,
        percent: bill.tds_percent,
        amount: bill.tds_amount,
      },
      {
        tax_type: 'vds' as const,
        base: bill.vat_amount,
        percent: bill.vds_percent,
        amount: bill.vds_amount,
      },
    ].filter((w) => Money.of(w.amount).isPositive());
    if (withholdings.length) {
      await this.db.tx
        .insertInto('tax_withholdings')
        .values(
          withholdings.map((w) => ({
            ...w,
            company_id: bill.company_id,
            vendor_id: bill.vendor_id,
            bill_id: bill.id,
            category: bill.withholding_category,
            deducted_on: bill.bill_date,
            period: bill.bill_date.slice(0, 7),
          })),
        )
        .execute();
    }
    await this.audit.record({
      action: 'vendor_bill.approved',
      entity: 'vendor_bill',
      entityId: bill.id,
      after: {
        billNo: bill.bill_no,
        voucher: voucher.number,
        tds: bill.tds_amount,
        vds: bill.vds_amount,
      },
    });
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    const bill = await this.find(request.source_id);
    if (outcome === 'returned')
      await this.db.tx
        .updateTable('vendor_bills')
        .set({ state: 'draft', approval_request_id: null })
        .where('id', '=', bill.id)
        .execute();
    else {
      await this.db.tx
        .updateTable('vendor_bills')
        .set({
          state: 'cancelled',
          cancel_reason:
            outcome === 'rejected' ? 'Rejected by the checker' : 'Withdrawn',
        })
        .where('id', '=', bill.id)
        .execute();
      if (bill.purchase_order_id)
        await this.poLink?.rematchOrder(bill.purchase_order_id);
    }
    await this.audit.record({
      action: `vendor_bill.${outcome}`,
      entity: 'vendor_bill',
      entityId: bill.id,
      after: { billNo: bill.bill_no },
    });
  }

  private async assertVoidable(voucher: Voucher) {
    const bill = await this.find(voucher.source_id!);
    const pending = await this.pendingAllocations([bill.id]);
    const deposited = await this.db.tx
      .selectFrom('tax_withholdings')
      .select('id')
      .where('bill_id', '=', bill.id)
      .where('challan_id', 'is not', null)
      .executeTakeFirst();
    if (
      Money.of(bill.paid_amount).isPositive() ||
      pending.has(bill.id) ||
      deposited
    )
      throw new ConflictException(MSG.BILL_HAS_PAYMENTS);
  }

  private async voided(voucher: Voucher) {
    const bill = await this.find(voucher.source_id!);
    await this.db.tx
      .updateTable('vendor_bills')
      .set({
        state: 'cancelled',
        cancel_reason: `Posting ${voucher.number} reversed`,
      })
      .where('id', '=', bill.id)
      .execute();
    await this.db.tx
      .updateTable('tax_withholdings')
      .set({ state: 'void' })
      .where('bill_id', '=', bill.id)
      .execute();
    if (bill.purchase_order_id)
      await this.poLink?.rematchOrder(bill.purchase_order_id);
    await this.audit.record({
      action: 'vendor_bill.voided',
      entity: 'vendor_bill',
      entityId: bill.id,
      after: { billNo: bill.bill_no, voucher: voucher.number },
    });
  }

  // =================================================================== read

  async list(companyId: string, query: BillQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    let q = this.db.tx
      .selectFrom('vendor_bills as b')
      .innerJoin('vendors as v', 'v.id', 'b.vendor_id')
      .selectAll('b')
      .select(['v.code as vendor_code', 'v.name as vendor_name'])
      .where('b.company_id', '=', companyId);
    if (query.vendorId) q = q.where('b.vendor_id', '=', query.vendorId);
    if (query.state) q = q.where('b.state', '=', query.state);
    if (query.open)
      q = q
        .where('b.state', '=', 'approved')
        .where(sql<boolean>`b.paid_amount < b.net_payable`);
    if (query.from) q = q.where('b.bill_date', '>=', query.from);
    if (query.to) q = q.where('b.bill_date', '<=', query.to);
    const rows = await q
      .orderBy('b.bill_date', 'desc')
      .orderBy('b.created_at', 'desc')
      .limit(500)
      .execute();
    const pending = await this.pendingAllocations(rows.map((r) => r.id));
    return rows.map((r) => ({
      ...toBillResponse(r, pending.get(r.id)),
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
    }));
  }

  async get(id: string) {
    const bill = await this.find(id);
    this.access.assert('payables.view', { companyId: bill.company_id });
    const vendor = await this.vendors.find(bill.vendor_id);
    const lines = await this.db.tx
      .selectFrom('vendor_bill_lines as l')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select([
        'l.line_no',
        'l.account_id',
        'a.code',
        'a.name_en',
        'l.department_id',
        'l.description',
        'l.amount',
        'l.vat_percent',
        'l.vat_amount',
        'l.po_line_id',
        'l.quantity',
        'l.vat_item_id',
        'l.vat_rate_class',
      ])
      .where('l.bill_id', '=', id)
      .orderBy('l.line_no')
      .execute();
    const payments = await this.db.tx
      .selectFrom('vendor_payment_allocations as a')
      .innerJoin('vendor_payments as p', 'p.id', 'a.payment_id')
      .leftJoin('vouchers as v', 'v.id', 'p.voucher_id')
      .select([
        'p.id',
        'p.payment_date',
        'p.method',
        'p.state',
        'a.amount',
        'v.number',
      ])
      .where('a.bill_id', '=', id)
      .orderBy('p.payment_date')
      .execute();
    const withholdings = await this.db.tx
      .selectFrom('tax_withholdings as w')
      .leftJoin('tax_challans as c', 'c.id', 'w.challan_id')
      .leftJoin('tax_certificates as t', 't.id', 'w.certificate_id')
      .select([
        'w.id',
        'w.tax_type',
        'w.base',
        'w.percent',
        'w.amount',
        'w.state',
        'c.challan_no',
        'c.state as challan_state',
        't.number as certificate_no',
      ])
      .where('w.bill_id', '=', id)
      .execute();
    const voucher = bill.voucher_id
      ? await this.vouchers.find(bill.voucher_id)
      : null;
    const pending = await this.pendingAllocations([id]);
    return {
      ...toBillResponse(bill, pending.get(id)),
      vendor: {
        id: vendor.id,
        code: vendor.code,
        name: vendor.name,
        tin: vendor.tin,
        bin: vendor.bin,
      },
      voucherNumber: voucher?.number ?? null,
      lines: lines.map((l) => ({
        lineNo: l.line_no,
        accountId: l.account_id,
        accountCode: l.code,
        accountName: l.name_en,
        departmentId: l.department_id,
        description: l.description,
        amount: l.amount,
        vatPercent: l.vat_percent,
        vatAmount: l.vat_amount,
        vatItemId: l.vat_item_id,
        vatRateClass: l.vat_rate_class,
        poLineId: l.po_line_id,
        quantity: l.quantity,
      })),
      payments: payments.map((p) => ({
        paymentId: p.id,
        paymentDate: p.payment_date,
        method: p.method,
        state: p.state,
        amount: p.amount,
        voucherNumber: p.number,
      })),
      withholdings: withholdings.map((w) => ({
        id: w.id,
        taxType: w.tax_type,
        base: w.base,
        percent: w.percent,
        amount: w.amount,
        state: w.state,
        challanNo: w.challan_no,
        challanState: w.challan_state,
        certificateNo: w.certificate_no,
      })),
    };
  }

  async find(id: string): Promise<VendorBill> {
    const bill = await this.db.tx
      .selectFrom('vendor_bills')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!bill) throw new NotFoundException(MSG.BILL_NOT_FOUND);
    return bill;
  }

  /** Amounts in payments still waiting for the checker, per bill. */
  async pendingAllocations(billIds: string[]): Promise<Map<string, string>> {
    if (!billIds.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('vendor_payment_allocations as a')
      .innerJoin('vendor_payments as p', 'p.id', 'a.payment_id')
      .select(['a.bill_id', sql<string>`sum(a.amount)`.as('amount')])
      .where('a.bill_id', 'in', billIds)
      .where('p.state', '=', 'in_approval')
      .groupBy('a.bill_id')
      .execute();
    return new Map(rows.map((r) => [r.bill_id, Money.of(r.amount).toDb()]));
  }

  // ============================================================== helpers

  private async vendorOf(companyId: string, vendorId: string): Promise<Vendor> {
    const vendor = await this.vendors.find(vendorId);
    if (vendor.company_id !== companyId)
      throw new NotFoundException(MSG.VENDOR_NOT_FOUND);
    if (!vendor.is_active) throw new BadRequestException(MSG.VENDOR_INACTIVE);
    return vendor;
  }

  private async assertNotDuplicate(
    vendorId: string,
    billNo: string,
    exceptId?: string,
  ) {
    let q = this.db.tx
      .selectFrom('vendor_bills')
      .select(['id', 'bill_date', 'state'])
      .where('vendor_id', '=', vendorId)
      .where(sql<boolean>`lower(bill_no) = lower(${billNo})`)
      .where('state', '<>', 'cancelled');
    if (exceptId) q = q.where('id', '<>', exceptId);
    const clash = await q.executeTakeFirst();
    if (clash)
      throw new ConflictException({
        message: MSG.BILL_DUPLICATE,
        details: {
          billId: clash.id,
          billDate: clash.bill_date,
          state: clash.state,
        },
      });
  }

  /** Lines (postable accounts of the company, not cash / bank / payables), VAT per line, tax at source. */
  private async compute(
    companyId: string,
    vendor: Vendor,
    billDate: string,
    category: string,
    lines: BillLineDto[],
  ): Promise<ComputedBill> {
    const ids = [...new Set(lines.map((l) => l.accountId))];
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'postable', 'is_active', 'role'])
      .where('id', 'in', ids)
      .execute();
    const byId = new Map(accounts.map((a) => [a.id, a]));
    if (
      ids.some((id) => {
        const a = byId.get(id);
        return (
          !a ||
          a.company_id !== companyId ||
          !a.postable ||
          !a.is_active ||
          ['cash', 'bank', 'payables'].includes(a.role ?? '')
        );
      })
    ) {
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
    }
    const departments = [
      ...new Set(
        lines.map((l) => l.departmentId).filter((d): d is string => !!d),
      ),
    ];
    if (departments.length) {
      const found = await this.db.tx
        .selectFrom('departments')
        .select('id')
        .where('company_id', '=', companyId)
        .where('id', 'in', departments)
        .execute();
      if (found.length !== departments.length)
        throw new BadRequestException(MSG.DEPARTMENT_NOT_FOUND);
    }

    const computedLines: ComputedLine[] = [];
    for (const l of lines) {
      // a named VAT item sets the rate; otherwise the percent typed in
      const rate = l.vatItemId
        ? await this.vatRates?.rateFor(l.vatItemId, companyId, billDate)
        : undefined;
      if (l.vatItemId && !rate)
        throw new BadRequestException(MSG.VAT_ITEM_NOT_FOUND);
      const vatPercent = rate?.vatPercent ?? l.vatPercent ?? '0';
      computedLines.push({
        ...l,
        vatPercent,
        vatRateClass: rate?.rateClass ?? null,
        vatAmount: Money.of(l.amount)
          .times(vatPercent)
          .dividedBy(100)
          .round()
          .toDb(),
      });
    }
    const base = Money.sum(computedLines.map((l) => l.amount)).toDb();
    const vat = Money.sum(computedLines.map((l) => l.vatAmount)).toDb();

    const settings = await this.vendors.settingsOf(companyId);
    const { rules, pack } = await this.vendors.withholdingRules(billDate);
    if (!rules.categories.some((c) => c.code === category))
      throw new BadRequestException({
        message: MSG.WITHHOLDING_CATEGORY_UNKNOWN,
        details: { category },
      });
    const withholding = computeWithholding(
      {
        categoryCode: category,
        base,
        vat,
        vendorHasTin: !!vendor.tin,
        vendorHasBin: !!vendor.bin,
        companyIsVdsEntity: settings.vat_withholding_entity,
      },
      rules,
    );
    return {
      lines: computedLines,
      base,
      vat,
      withholding,
      vdsEntity: settings.vat_withholding_entity,
      pack,
    };
  }

  private async dueDateFor(
    companyId: string,
    vendor: Vendor,
    billDate: string,
  ) {
    const terms =
      vendor.payment_terms_days ??
      (await this.vendors.settingsOf(companyId)).default_payment_terms_days;
    return addDays(businessDate(billDate), terms);
  }

  /** The journal of an approved bill; refuses when the books are not ready. */
  private async postingLines(
    bill: VendorBill,
    lines: ComputedLine[],
  ): Promise<PostingLine[]> {
    const hasBooks = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', bill.company_id)
      .limit(1)
      .executeTakeFirst();
    if (!hasBooks) throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
    const account = await this.ledger.resolvePostingAccounts(bill.company_id);
    const keys = {
      payable: 'payables.vendors',
      inputVat: 'payables.input_vat',
      tds: 'payables.tds',
      vds: 'payables.vds',
    } as const;
    const needed = [
      keys.payable,
      ...(Money.of(bill.input_vat).isPositive() ? [keys.inputVat] : []),
      ...(Money.of(bill.tds_amount).isPositive() ? [keys.tds] : []),
      ...(Money.of(bill.vds_amount).isPositive() ? [keys.vds] : []),
    ];
    const missing = needed.filter((k) => !account(k));
    if (missing.length)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: missing },
      });

    // VAT of a vendor without BIN is part of each line's cost
    const vatInCost = Money.of(bill.vat_in_cost).isPositive();
    const party = { partyType: 'vendor' as const, partyId: bill.vendor_id };
    return [
      ...lines.map((l) => ({
        accountId: l.accountId,
        departmentId: l.departmentId ?? null,
        debit: (vatInCost
          ? Money.of(l.amount).plus(l.vatAmount)
          : Money.of(l.amount)
        ).toDb(),
        narration: l.description,
      })),
      { accountId: account(keys.inputVat) ?? '', debit: bill.input_vat },
      { accountId: account(keys.tds) ?? '', credit: bill.tds_amount, ...party },
      { accountId: account(keys.vds) ?? '', credit: bill.vds_amount, ...party },
      { accountId: account(keys.payable)!, credit: bill.net_payable, ...party },
    ].filter((l) => Money.of(l.debit ?? l.credit ?? '0').isPositive());
  }

  private async insertLines(billId: string, lines: ComputedLine[]) {
    await this.db.tx
      .insertInto('vendor_bill_lines')
      .values(
        lines.map((l, i) => ({
          bill_id: billId,
          line_no: i + 1,
          account_id: l.accountId,
          department_id: l.departmentId ?? null,
          description: l.description,
          amount: Money.of(l.amount).toDb(),
          vat_percent: l.vatPercent,
          vat_amount: l.vatAmount,
          po_line_id: l.poLineId ?? null,
          quantity: l.quantity ?? null,
          vat_item_id: l.vatItemId ?? null,
          vat_rate_class: l.vatRateClass ?? null,
        })),
      )
      .execute();
  }

  private async linesAsDto(
    billId: string,
  ): Promise<Array<BillLineDto & { vatAmount: string }>> {
    const rows = await this.db.tx
      .selectFrom('vendor_bill_lines')
      .selectAll()
      .where('bill_id', '=', billId)
      .orderBy('line_no')
      .execute();
    return rows.map((r) => ({
      accountId: r.account_id,
      departmentId: r.department_id ?? undefined,
      description: r.description,
      amount: r.amount,
      vatPercent: r.vat_percent,
      vatAmount: r.vat_amount,
      ...(r.vat_item_id ? { vatItemId: r.vat_item_id } : {}),
      ...(r.po_line_id
        ? { poLineId: r.po_line_id, quantity: r.quantity! }
        : {}),
    }));
  }
}

function amountColumns(c: ComputedBill) {
  const w = c.withholding;
  return {
    base_amount: c.base,
    vat_amount: c.vat,
    tds_percent: w.tdsPercent,
    tds_amount: w.tds,
    vds_percent: w.vdsPercent,
    vds_amount: w.vds,
    input_vat: w.inputVat,
    vat_in_cost: w.vatInCost,
    net_payable: w.netPayable,
    rule_pack: c.pack,
  };
}

export function toBillResponse(b: VendorBill, pending?: string) {
  const outstanding = Money.of(b.net_payable).minus(b.paid_amount);
  return {
    id: b.id,
    companyId: b.company_id,
    vendorId: b.vendor_id,
    billNo: b.bill_no,
    billDate: b.bill_date,
    dueDate: b.due_date,
    narration: b.narration,
    withholdingCategory: b.withholding_category,
    baseAmount: b.base_amount,
    vatAmount: b.vat_amount,
    total: Money.of(b.base_amount).plus(b.vat_amount).toDb(),
    tdsPercent: b.tds_percent,
    tdsAmount: b.tds_amount,
    vdsPercent: b.vds_percent,
    vdsAmount: b.vds_amount,
    inputVat: b.input_vat,
    vatInCost: b.vat_in_cost,
    netPayable: b.net_payable,
    paidAmount: b.paid_amount,
    pendingPayments: pending ?? '0.00',
    outstanding: b.state === 'approved' ? outstanding.toDb() : '0.00',
    paymentStatus:
      b.state !== 'approved'
        ? null
        : outstanding.isZero()
          ? 'paid'
          : Money.of(b.paid_amount).isPositive()
            ? 'partly_paid'
            : 'unpaid',
    state: b.state,
    rulePack: b.rule_pack,
    voucherId: b.voucher_id,
    approvalRequestId: b.approval_request_id,
    cancelReason: b.cancel_reason,
    purchaseOrderId: b.purchase_order_id,
    matchStatus: b.match_status,
    matchDetails: b.match_details,
    matchOverrideReason: b.match_override_reason,
    createdAt: b.created_at,
    version: b.version,
  };
}
