/**
 * Paying vendors (spec §5 "Payment voucher: Accounts maker -> Accounts checker;
 * above threshold -> Admin", §6.7 step 5).
 *
 *   create      Accounts settles one or more approved bills of a vendor: a payment
 *               voucher (Dr payable to the vendor, Cr cash / bank) goes to the
 *               checker at once; the amounts are reserved on the bills
 *   (posted)    the bills are paid (fully or in part)
 *   (dropped)   rejected, returned or withdrawn: the reservation is released
 *   (reversed)  the payment voucher was reversed: the bills are open again
 *
 * The amount paid is net of the tax withheld (it was deducted on the bill).
 * A bank transfer needs the vendor's approved bank account (maker-checker).
 * Never more than is owed: checked here, and by the database on the bill.
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
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Voucher, VendorPayment } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateVendorPaymentDto,
  PaymentQueryDto,
} from './dto/payables.dto.js';
import { VendorBillsService } from './vendor-bills.service.js';
import { VendorsService } from './vendors.service.js';

export const VENDOR_PAYMENT_SOURCE = 'vendor_payment';

@Injectable()
export class VendorPaymentsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly vendors: VendorsService,
    private readonly bills: VendorBillsService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(VENDOR_PAYMENT_SOURCE, {
      onPosted: (v) => this.paid(v),
      onDropped: (v) => this.dropped(v),
      onReversed: (v) => this.reversed(v),
    });
  }

  async create(companyId: string, dto: CreateVendorPaymentDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.manage', { companyId });
    const vendor = await this.vendors.find(dto.vendorId);
    if (vendor.company_id !== companyId)
      throw new NotFoundException(MSG.VENDOR_NOT_FOUND);

    // where the money comes from, and where it goes
    const from = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', dto.paidFromAccountId)
      .executeTakeFirst();
    if (
      !from ||
      from.company_id !== companyId ||
      !from.postable ||
      !from.is_active ||
      !['cash', 'bank'].includes(from.role ?? '')
    )
      throw new BadRequestException(MSG.PAYMENT_ACCOUNT_NOT_MONEY);
    const bank =
      dto.method === 'bank_transfer'
        ? await this.vendors.approvedBankAccount(vendor.id)
        : null;
    if (dto.method === 'bank_transfer' && !bank)
      throw new BadRequestException(MSG.VENDOR_BANK_NOT_APPROVED);
    const payable = (await this.ledger.resolvePostingAccounts(companyId))(
      'payables.vendors',
    );
    if (!payable)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: ['payables.vendors'] },
      });

    // every bill: this vendor's, approved, and not more than is still owed (rows locked)
    const ids = dto.allocations.map((a) => a.billId);
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    const rows = await this.db.tx
      .selectFrom('vendor_bills')
      .selectAll()
      .where('id', 'in', ids)
      .forUpdate()
      .execute();
    const byId = new Map(rows.map((b) => [b.id, b]));
    const pending = await this.bills.pendingAllocations(ids);
    for (const a of dto.allocations) {
      const bill = byId.get(a.billId);
      if (!bill || bill.vendor_id !== vendor.id)
        throw new NotFoundException(MSG.BILL_NOT_FOUND);
      if (bill.state !== 'approved')
        throw new ConflictException({
          message: MSG.BILL_WRONG_STATE,
          details: { billNo: bill.bill_no },
        });
      // spec §6.7: a bill against a purchase order is paid only when matched (WP17)
      if (bill.match_status === 'mismatch')
        throw new ConflictException({
          message: MSG.BILL_NOT_MATCHED,
          details: { billNo: bill.bill_no },
        });
      const available = Money.of(bill.net_payable)
        .minus(bill.paid_amount)
        .minus(pending.get(bill.id) ?? '0');
      if (
        Money.of(a.amount).greaterThan(available) ||
        !Money.of(a.amount).isPositive()
      ) {
        throw new BadRequestException({
          message: MSG.PAYMENT_EXCEEDS_OUTSTANDING,
          details: { billNo: bill.bill_no, available: available.toDb() },
        });
      }
    }
    const amount = Money.sum(dto.allocations.map((a) => a.amount)).toDb();

    // the payment, its allocations, and the voucher for the checker
    const payment = await this.db.tx
      .insertInto('vendor_payments')
      .values({
        company_id: companyId,
        vendor_id: vendor.id,
        payment_date: dto.paymentDate,
        method: dto.method,
        reference: dto.reference ?? null,
        paid_from_account_id: from.id,
        vendor_bank_account_id: bank?.id ?? null,
        amount,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('vendor_payment_allocations')
      .values(
        dto.allocations.map((a) => ({
          payment_id: payment.id,
          bill_id: a.billId,
          amount: Money.of(a.amount).toDb(),
        })),
      )
      .execute();
    const billNos = dto.allocations
      .map((a) => byId.get(a.billId)!.bill_no)
      .join(', ');
    const voucher = await this.vouchers.createLinked({
      companyId,
      voucherType: 'payment',
      voucherDate: dto.paymentDate,
      narration: `Payment to ${vendor.name} (${vendor.code}) for ${billNos}${dto.reference ? `, ${dto.reference}` : ''}`,
      sourceType: VENDOR_PAYMENT_SOURCE,
      sourceId: payment.id,
      lines: [
        {
          accountId: payable,
          debit: amount,
          partyType: 'vendor',
          partyId: vendor.id,
        },
        {
          accountId: from.id,
          credit: amount,
          narration: bank
            ? `${bank.bank_name} ****${bank.account_last4}`
            : (dto.reference ?? null),
        },
      ],
    });
    await this.db.tx
      .updateTable('vendor_payments')
      .set({ voucher_id: voucher.id })
      .where('id', '=', payment.id)
      .execute();
    await this.audit.record({
      action: 'vendor_payment.created',
      entity: 'vendor_payment',
      entityId: payment.id,
      after: {
        vendor: vendor.code,
        amount,
        method: dto.method,
        bills: billNos,
        voucher: voucher.number,
      },
    });
    return this.get(payment.id);
  }

  // ===================================================== voucher outcomes

  private async paid(voucher: Voucher) {
    const payment = await this.find(voucher.source_id!);
    await this.db.tx
      .updateTable('vendor_payments')
      .set({ state: 'paid' })
      .where('id', '=', payment.id)
      .execute();
    await this.moveBills(payment.id, 1);
    await this.audit.record({
      action: 'vendor_payment.paid',
      entity: 'vendor_payment',
      entityId: payment.id,
      after: { voucher: voucher.number, amount: payment.amount },
    });
  }

  private async dropped(voucher: Voucher) {
    await this.db.tx
      .updateTable('vendor_payments')
      .set({ state: 'cancelled' })
      .where('id', '=', voucher.source_id!)
      .where('state', '=', 'in_approval')
      .execute();
  }

  private async reversed(voucher: Voucher) {
    const payment = await this.find(voucher.source_id!);
    await this.db.tx
      .updateTable('vendor_payments')
      .set({ state: 'reversed' })
      .where('id', '=', payment.id)
      .execute();
    await this.moveBills(payment.id, -1);
    await this.audit.record({
      action: 'vendor_payment.reversed',
      entity: 'vendor_payment',
      entityId: payment.id,
      after: { voucher: voucher.number },
    });
  }

  /** Add (1) or take back (-1) the payment's allocations on its bills. */
  private async moveBills(paymentId: string, sign: 1 | -1) {
    const allocations = await this.db.tx
      .selectFrom('vendor_payment_allocations')
      .select(['bill_id', 'amount'])
      .where('payment_id', '=', paymentId)
      .execute();
    for (const a of allocations) {
      const delta = sign === 1 ? a.amount : Money.of(a.amount).negate().toDb();
      await this.db.tx
        .updateTable('vendor_bills')
        .set({ paid_amount: sql`paid_amount + ${delta}::numeric` })
        .where('id', '=', a.bill_id)
        .execute();
    }
  }

  // =================================================================== read

  async list(companyId: string, query: PaymentQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    let q = this.db.tx
      .selectFrom('vendor_payments as p')
      .innerJoin('vendors as v', 'v.id', 'p.vendor_id')
      .leftJoin('vouchers as x', 'x.id', 'p.voucher_id')
      .selectAll('p')
      .select([
        'v.code as vendor_code',
        'v.name as vendor_name',
        'x.number as voucher_number',
        'x.approval_request_id',
      ])
      .where('p.company_id', '=', companyId);
    if (query.vendorId) q = q.where('p.vendor_id', '=', query.vendorId);
    if (query.state) q = q.where('p.state', '=', query.state);
    const rows = await q
      .orderBy('p.payment_date', 'desc')
      .orderBy('p.created_at', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => ({
      ...toPaymentResponse(r),
      vendorCode: r.vendor_code,
      vendorName: r.vendor_name,
      voucherNumber: r.voucher_number,
      approvalRequestId: r.approval_request_id,
    }));
  }

  async get(id: string) {
    const payment = await this.find(id);
    this.access.assert('payables.view', { companyId: payment.company_id });
    const vendor = await this.vendors.find(payment.vendor_id);
    const voucher = payment.voucher_id
      ? await this.vouchers.find(payment.voucher_id)
      : null;
    const allocations = await this.db.tx
      .selectFrom('vendor_payment_allocations as a')
      .innerJoin('vendor_bills as b', 'b.id', 'a.bill_id')
      .select([
        'a.bill_id',
        'b.bill_no',
        'b.bill_date',
        'b.net_payable',
        'a.amount',
      ])
      .where('a.payment_id', '=', id)
      .orderBy('b.bill_date')
      .execute();
    return {
      ...toPaymentResponse(payment),
      vendor: { id: vendor.id, code: vendor.code, name: vendor.name },
      voucherNumber: voucher?.number ?? null,
      approvalRequestId: voucher?.approval_request_id ?? null,
      allocations: allocations.map((a) => ({
        billId: a.bill_id,
        billNo: a.bill_no,
        billDate: a.bill_date,
        netPayable: a.net_payable,
        amount: a.amount,
      })),
    };
  }

  async find(id: string): Promise<VendorPayment> {
    const payment = await this.db.tx
      .selectFrom('vendor_payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!payment) throw new NotFoundException(MSG.VENDOR_PAYMENT_NOT_FOUND);
    return payment;
  }
}

function toPaymentResponse(p: VendorPayment) {
  return {
    id: p.id,
    companyId: p.company_id,
    vendorId: p.vendor_id,
    paymentDate: p.payment_date,
    method: p.method,
    reference: p.reference,
    paidFromAccountId: p.paid_from_account_id,
    vendorBankAccountId: p.vendor_bank_account_id,
    amount: p.amount,
    state: p.state,
    voucherId: p.voucher_id,
    createdAt: p.created_at,
  };
}
