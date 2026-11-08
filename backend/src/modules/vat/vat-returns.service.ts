/**
 * The monthly VAT return (Mushak 9.1 data) and its tie to the ledger (WP21).
 *
 *   preview(company, month)   the figures from the source documents (posted VAT invoices and,
 *                       from WP26, customer invoices and credit notes; approved vendor bills, VAT deducted at source both ways, last
 *                       month's credit) and the ledger tie:
 *                         input VAT account   net debits of the month   = input VAT of the bills
 *                         output VAT account  net credits of the month  = output VAT + SD - VAT the customers deducted
 *                         VDS payable account net credits of the month  = VAT deducted from suppliers
 *                       (the return's own settlement journal and VAT / VDS challans are left
 *                       out); every ledger line that no VAT document explains is listed
 *   file(company, dto)  only a month that has ended, one month after the other, and only
 *                       when the tie holds: stores the figures, posts the settlement journal
 *                       (Dr output VAT, Cr input VAT: the month's input set off) on the last
 *                       day of the month; a credit is carried to the next month
 *   challan(returnId)   the treasury deposit of the net VAT: a payment voucher (Dr output VAT,
 *                       Cr bank) to the checker; the challan is "deposited" once posted
 *   get(returnId)       as filed, and whether the documents have changed since
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
import { todayInDhaka } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { VatReturn, Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type { VatChallanDto, VatReturnDto } from './dto/vat.dto.js';
import { returnFigures, type ReturnFigures } from './mushak.js';
import { VatService } from './vat.service.js';

export const VAT_RETURN_SOURCE = 'vat_return';
export const VAT_CHALLAN_SOURCE = 'vat_challan';
const TAX_CHALLAN_SOURCE = 'tax_challan';
const VENDOR_BILL_SOURCE = 'vendor_bill';

const monthEnd = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return `${period}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};
const nextMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};
const previousMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};

export interface Tie {
  key: 'input_vat' | 'output_vat' | 'vds_deducted';
  accountId: string | null;
  accountCode: string | null;
  fromDocuments: string;
  inLedger: string;
  difference: string;
  /** ledger lines of the month that no VAT document explains */
  unexplained: Array<{
    voucherId: string;
    voucherNumber: string;
    voucherDate: string;
    narration: string;
    amount: string;
  }>;
}

@Injectable()
export class VatReturnsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly vat: VatService,
  ) {}

  onModuleInit() {
    // a filed return stands; a wrong one is corrected in a later month
    this.vouchers.registerSource(VAT_RETURN_SOURCE, {
      assertReversible: async () => {
        throw new ConflictException(MSG.VAT_PERIOD_FILED);
      },
    });
    this.vouchers.registerSource(VAT_CHALLAN_SOURCE, {
      onPosted: (v) => this.challanState(v, 'deposited'),
      onDropped: (v) => this.challanState(v, 'cancelled'),
      onReversed: (v) => this.challanState(v, 'reversed'),
    });
  }

  // ================================================================ preview

  async preview(companyId: string, period: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.view', { companyId });
    const filed = await this.db.tx
      .selectFrom('vat_returns')
      .select(['id', 'filed_at'])
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .executeTakeFirst();
    return {
      ...(await this.compute(companyId, period)),
      filedReturnId: filed?.id ?? null,
    };
  }

  async list(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('vat_returns as r')
      .leftJoin('tax_challans as c', 'c.id', 'r.challan_id')
      .selectAll('r')
      .select(['c.challan_no', 'c.state as challan_state'])
      .where('r.company_id', '=', companyId)
      .orderBy('r.period', 'desc')
      .execute();
    return rows.map((r) => ({
      ...this.toReturn(r),
      challanNo: r.challan_no,
      challanState: r.challan_state,
    }));
  }

  async get(id: string) {
    const r = await this.find(id);
    this.access.assert('vat.view', { companyId: r.company_id });
    const challan = r.challan_id
      ? await this.db.tx
          .selectFrom('tax_challans as c')
          .leftJoin('vouchers as v', 'v.id', 'c.voucher_id')
          .select([
            'c.id',
            'c.challan_no',
            'c.challan_date',
            'c.amount',
            'c.state',
            'v.number',
            'v.approval_request_id',
          ])
          .where('c.id', '=', r.challan_id)
          .executeTakeFirst()
      : undefined;
    const settlement = r.settlement_voucher_id
      ? await this.db.tx
          .selectFrom('vouchers')
          .select(['id', 'number'])
          .where('id', '=', r.settlement_voucher_id)
          .executeTakeFirst()
      : undefined;
    // the documents of the month now: a late bill or a reversal shows here
    const now = await this.compute(
      r.company_id,
      r.period,
      Money.of((r.figures as ReturnFigures).carryForwardIn).toDb(),
    );
    return {
      ...this.toReturn(r),
      figures: r.figures,
      settlementVoucher: settlement
        ? { id: settlement.id, number: settlement.number }
        : null,
      challan: challan
        ? {
            id: challan.id,
            challanNo: challan.challan_no,
            challanDate: challan.challan_date,
            amount: challan.amount,
            state: challan.state,
            voucherNumber: challan.number,
            approvalRequestId: challan.approval_request_id,
          }
        : null,
      changedSinceFiling: !Money.of(now.figures.netTax).equals(
        (r.figures as ReturnFigures).netTax,
      ),
    };
  }

  // ================================================================ file

  async file(companyId: string, dto: VatReturnDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('vat.manage', { companyId });
    const today = todayInDhaka(this.clock.now());
    if (dto.period >= today.slice(0, 7))
      throw new BadRequestException(MSG.VAT_RETURN_PERIOD_INVALID);
    const already = await this.db.tx
      .selectFrom('vat_returns')
      .select('id')
      .where('company_id', '=', companyId)
      .where('period', '=', dto.period)
      .executeTakeFirst();
    if (already) throw new ConflictException(MSG.VAT_RETURN_FILED);
    const last = await this.db.tx
      .selectFrom('vat_returns')
      .select(['period'])
      .where('company_id', '=', companyId)
      .orderBy('period', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (last && dto.period !== nextMonth(last.period))
      throw new BadRequestException({
        message: MSG.VAT_RETURN_PERIOD_INVALID,
        details: { next: nextMonth(last.period) },
      });

    const { figures, ties, tied } = await this.compute(companyId, dto.period);
    if (!tied)
      throw new ConflictException({
        message: MSG.VAT_RETURN_NOT_TIED,
        details: {
          problems: ties
            .filter((t) => !Money.of(t.difference).isZero())
            .map(
              (t) =>
                `${t.accountCode ?? t.key}: documents ${t.fromDocuments}, ledger ${t.inLedger}`,
            ),
        },
      });

    // the month's input VAT set off against its output VAT
    const account = await this.ledger.resolvePostingAccounts(companyId);
    let settlementVoucherId: string | null = null;
    const r = await this.db.tx
      .insertInto('vat_returns')
      .values({
        company_id: companyId,
        period: dto.period,
        figures: JSON.stringify({ ...figures, ties }),
        output_vat: figures.outputTax,
        input_vat: figures.inputTax,
        net_payable: figures.netPayable,
        carry_forward: figures.carryForwardOut,
        submitted_on: dto.submittedOn ?? today,
        submission_ref: dto.submissionRef ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (Money.of(figures.inputTax).isPositive()) {
      const v = await this.vouchers.postAutomatic({
        companyId,
        voucherType: 'journal',
        voucherDate: monthEnd(dto.period),
        narration: `VAT return ${dto.period} (Mushak 9.1): input VAT set off against output VAT`,
        sourceType: VAT_RETURN_SOURCE,
        sourceId: r.id,
        lines: [
          { accountId: account('vat.output')!, debit: figures.inputTax },
          {
            accountId: account('payables.input_vat')!,
            credit: figures.inputTax,
          },
        ],
      });
      settlementVoucherId = v.id;
      await this.db.tx
        .updateTable('vat_returns')
        .set({ settlement_voucher_id: v.id })
        .where('id', '=', r.id)
        .execute();
    }
    await this.audit.record({
      action: 'vat_return.filed',
      entity: 'vat_return',
      entityId: r.id,
      after: {
        period: dto.period,
        output: figures.outputTax,
        input: figures.inputTax,
        netPayable: figures.netPayable,
        carryForward: figures.carryForwardOut,
        submissionRef: dto.submissionRef,
        settlementVoucherId,
      },
    });
    return this.get(r.id);
  }

  async challan(id: string, dto: VatChallanDto) {
    const r = await this.find(id);
    this.access.assert('vat.manage', { companyId: r.company_id });
    if (!Money.of(r.net_payable).isPositive())
      throw new BadRequestException(MSG.VAT_RETURN_NOTHING_TO_PAY);
    if (r.challan_id) throw new ConflictException(MSG.VAT_CHALLAN_EXISTS);
    const from = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', dto.paidFromAccountId)
      .executeTakeFirst();
    if (
      !from ||
      from.company_id !== r.company_id ||
      !from.postable ||
      !from.is_active ||
      !['cash', 'bank'].includes(from.role ?? '')
    )
      throw new BadRequestException(MSG.PAYMENT_ACCOUNT_NOT_MONEY);
    const account = await this.ledger.resolvePostingAccounts(r.company_id);
    const challan = await this.db.tx
      .insertInto('tax_challans')
      .values({
        company_id: r.company_id,
        tax_type: 'vat',
        period: r.period,
        challan_no: dto.challanNo,
        challan_date: dto.challanDate,
        paid_from_account_id: from.id,
        amount: r.net_payable,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const voucher = await this.vouchers.createLinked({
      companyId: r.company_id,
      voucherType: 'payment',
      voucherDate: dto.challanDate,
      narration: `VAT ${r.period} (Mushak 9.1): challan ${dto.challanNo}`,
      sourceType: VAT_CHALLAN_SOURCE,
      sourceId: challan.id,
      lines: [
        { accountId: account('vat.output')!, debit: r.net_payable },
        {
          accountId: from.id,
          credit: r.net_payable,
          narration: `Challan ${dto.challanNo}`,
        },
      ],
    });
    await this.db.tx
      .updateTable('tax_challans')
      .set({ voucher_id: voucher.id })
      .where('id', '=', challan.id)
      .execute();
    await this.db.tx
      .updateTable('vat_returns')
      .set({ challan_id: challan.id })
      .where('id', '=', r.id)
      .execute();
    await this.audit.record({
      action: 'vat_challan.created',
      entity: 'tax_challan',
      entityId: challan.id,
      after: {
        period: r.period,
        challanNo: dto.challanNo,
        amount: r.net_payable,
        voucher: voucher.number,
      },
    });
    return this.get(r.id);
  }

  // ================================================================ internals

  private async compute(companyId: string, period: string, carryIn?: string) {
    const from = `${period}-01`;
    const to = monthEnd(period);
    const sales = await this.vat.saleLines(companyId, period);
    const purchases = await this.vat.purchaseLines(companyId, period);
    const bills = await this.db.tx
      .selectFrom('vendor_bills')
      .select([
        sql<string>`coalesce(sum(input_vat), 0)::text`.as('input'),
        sql<string>`coalesce(sum(vds_amount), 0)::text`.as('vds'),
      ])
      .where('company_id', '=', companyId)
      .where('state', '=', 'approved')
      .where('bill_date', '>=', from)
      .where('bill_date', '<=', to)
      .executeTakeFirstOrThrow();
    const vdsDeposited = await this.db.tx
      .selectFrom('tax_challans')
      .select(sql<string>`coalesce(sum(amount), 0)::text`.as('s'))
      .where('company_id', '=', companyId)
      .where('tax_type', '=', 'vds')
      .where('period', '=', period)
      .where('state', '=', 'deposited')
      .executeTakeFirstOrThrow();
    const previous =
      carryIn === undefined
        ? await this.db.tx
            .selectFrom('vat_returns')
            .select('carry_forward')
            .where('company_id', '=', companyId)
            .where('period', '=', previousMonth(period))
            .executeTakeFirst()
        : undefined;
    const vdsByCustomers = await this.vat.vdsByCustomers(companyId, period);

    const figures = returnFigures({
      period,
      sales: sales.map((s) => ({
        rateClass: s.rate_class,
        value: s.value,
        sdAmount: s.sd_amount,
        vatAmount: s.vat_amount,
      })),
      purchases: purchases.map((p) => ({
        rateClass: p.rateClass,
        value: p.value,
        vatAmount: p.vatAmount,
        claimable: p.claimable,
      })),
      vdsDeducted: bills.vds,
      vdsDeposited: vdsDeposited.s,
      vdsByCustomers,
      carryForwardIn: carryIn ?? previous?.carry_forward ?? '0',
    });

    // the ledger side
    const account = await this.ledger.resolvePostingAccounts(companyId);
    const tie = async (
      key: Tie['key'],
      postingKey: string,
      side: 1 | -1,
      expected: string[],
      excluded: string[],
      fromDocuments: string,
    ): Promise<Tie> => {
      const accountId = account(postingKey) ?? null;
      const code = accountId
        ? ((
            await this.db.tx
              .selectFrom('accounts')
              .select('code')
              .where('id', '=', accountId)
              .executeTakeFirst()
          )?.code ?? null)
        : null;
      const lines = accountId
        ? await this.db.tx
            .selectFrom('voucher_lines as l')
            .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
            .leftJoin('vouchers as o', 'o.id', 'v.reversal_of')
            .select([
              'v.id',
              'v.number',
              'v.voucher_date',
              'v.narration',
              'l.debit',
              'l.credit',
            ])
            .select(
              sql<string | null>`coalesce(v.source_type, o.source_type)`.as(
                'source',
              ),
            )
            .where('l.account_id', '=', accountId)
            .where('v.state', '=', 'posted')
            .where('v.voucher_date', '>=', from)
            .where('v.voucher_date', '<=', to)
            .execute()
        : [];
      const counted = lines.filter((l) => !excluded.includes(l.source ?? ''));
      const amount = (l: { debit: string; credit: string }) =>
        side === 1
          ? Money.of(l.debit).minus(l.credit)
          : Money.of(l.credit).minus(l.debit);
      const inLedger = Money.sum(counted.map((l) => amount(l)));
      return {
        key,
        accountId,
        accountCode: code,
        fromDocuments: Money.of(fromDocuments).toDb(),
        inLedger: inLedger.toDb(),
        difference: inLedger.minus(fromDocuments).toDb(),
        unexplained: counted
          .filter((l) => !expected.includes(l.source ?? ''))
          .map((l) => ({
            voucherId: l.id,
            voucherNumber: l.number,
            voucherDate: l.voucher_date,
            narration: l.narration,
            amount: amount(l).toDb(),
          })),
      };
    };
    const ties = [
      await tie(
        'input_vat',
        'payables.input_vat',
        1,
        [VENDOR_BILL_SOURCE],
        [VAT_RETURN_SOURCE],
        bills.input,
      ),
      await tie(
        'output_vat',
        'vat.output',
        -1,
        this.vat.outputVatSources(),
        [VAT_RETURN_SOURCE, VAT_CHALLAN_SOURCE],
        Money.of(figures.outputTax).minus(vdsByCustomers).toDb(),
      ),
      await tie(
        'vds_deducted',
        'payables.vds',
        -1,
        [VENDOR_BILL_SOURCE],
        [TAX_CHALLAN_SOURCE],
        bills.vds,
      ),
    ];
    return {
      figures,
      ties,
      tied: ties.every((t) => Money.of(t.difference).isZero()),
    };
  }

  private async challanState(
    v: Voucher,
    state: 'deposited' | 'cancelled' | 'reversed',
  ) {
    await this.db.tx
      .updateTable('tax_challans')
      .set({ state })
      .where('id', '=', v.source_id!)
      .execute();
    if (state !== 'deposited')
      await this.db.tx
        .updateTable('vat_returns')
        .set({ challan_id: null })
        .where('challan_id', '=', v.source_id!)
        .execute();
  }

  private async find(id: string): Promise<VatReturn> {
    const r = await this.db.tx
      .selectFrom('vat_returns')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.VAT_RETURN_NOT_FOUND);
    return r;
  }

  private toReturn(r: VatReturn) {
    return {
      id: r.id,
      companyId: r.company_id,
      period: r.period,
      outputVat: r.output_vat,
      inputVat: r.input_vat,
      netPayable: r.net_payable,
      carryForward: r.carry_forward,
      submittedOn: r.submitted_on,
      submissionRef: r.submission_ref,
      settlementVoucherId: r.settlement_voucher_id,
      challanId: r.challan_id,
      filedAt: r.filed_at,
    };
  }
}
