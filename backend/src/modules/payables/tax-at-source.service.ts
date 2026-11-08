/**
 * Tax deducted at source after the bill (spec §6.6 "challan and certificate tracking").
 *
 *   withholdings   one per bill and tax (income tax TDS, VAT VDS), recorded at approval
 *   challans       Accounts deposits a month's withheld tax to the government: every
 *                  withholding of that month not yet deposited goes in; a payment
 *                  voucher (Dr tax payable, Cr bank) goes to the checker; once posted
 *                  the challan is "deposited"
 *   certificates   to a vendor for a period: the deposited tax not yet certified, with
 *                  the challans it went in; numbered TDSC/2026-27/00001 (VDS: VDSC/...)
 *                  per company and fiscal year; each withholding is certified once
 *
 * A challan whose tax is already certified cannot be reversed (also the database).
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
import type { TaxChallan, TaxType, Voucher } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerSetupService } from '../ledger/ledger-setup.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateCertificateDto,
  CreateChallanDto,
  WithholdingQueryDto,
} from './dto/payables.dto.js';
import { VendorsService } from './vendors.service.js';

export const TAX_CHALLAN_SOURCE = 'tax_challan';
const TAX_NAME: Record<TaxType, string> = {
  tds: 'Income tax deducted at source',
  vds: 'VAT deducted at source',
  vat: 'VAT (monthly return)',
};

@Injectable()
export class TaxAtSourceService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly ledger: LedgerSetupService,
    private readonly vouchers: VouchersService,
    private readonly vendors: VendorsService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(TAX_CHALLAN_SOURCE, {
      onPosted: (v) => this.deposited(v),
      onDropped: (v) => this.released(v, 'cancelled'),
      assertReversible: (v) => this.assertNotCertified(v),
      onReversed: (v) => this.released(v, 'reversed'),
    });
  }

  // ========================================================= withholdings

  async withholdings(companyId: string, query: WithholdingQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    let q = this.db.tx
      .selectFrom('tax_withholdings as w')
      .innerJoin('vendors as v', 'v.id', 'w.vendor_id')
      .innerJoin('vendor_bills as b', 'b.id', 'w.bill_id')
      .leftJoin('tax_challans as c', 'c.id', 'w.challan_id')
      .select([
        'w.id',
        'w.tax_type',
        'w.category',
        'w.base',
        'w.percent',
        'w.amount',
        'w.deducted_on',
        'w.period',
        'w.state',
        'w.challan_id',
        'w.certificate_id',
        'v.id as vendor_id',
        'v.code as vendor_code',
        'v.name as vendor_name',
        'v.tin',
        'b.bill_no',
        'c.challan_no',
        'c.state as challan_state',
      ])
      .where('w.company_id', '=', companyId)
      .where('w.state', '=', 'active');
    if (query.taxType) q = q.where('w.tax_type', '=', query.taxType);
    if (query.period) q = q.where('w.period', '=', query.period);
    if (query.deposited === true) q = q.where('c.state', '=', 'deposited');
    if (query.deposited === false)
      q = q.where((eb) =>
        eb.or([
          eb('w.challan_id', 'is', null),
          eb('c.state', '<>', 'deposited'),
        ]),
      );
    const rows = await q
      .orderBy('w.deducted_on')
      .orderBy('v.code')
      .limit(2000)
      .execute();
    return {
      total: Money.sum(rows.map((r) => r.amount)).toDb(),
      items: rows.map((r) => ({
        id: r.id,
        taxType: r.tax_type,
        category: r.category,
        base: r.base,
        percent: r.percent,
        amount: r.amount,
        deductedOn: r.deducted_on,
        period: r.period,
        vendorId: r.vendor_id,
        vendorCode: r.vendor_code,
        vendorName: r.vendor_name,
        vendorTin: r.tin,
        billNo: r.bill_no,
        challanId: r.challan_id,
        challanNo: r.challan_no,
        challanState: r.challan_state,
        certified: r.certificate_id !== null,
      })),
    };
  }

  // ============================================================= challans

  async createChallan(companyId: string, dto: CreateChallanDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.tax', { companyId });
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
    const key = dto.taxType === 'tds' ? 'payables.tds' : 'payables.vds';
    const payable = (await this.ledger.resolvePostingAccounts(companyId))(key);
    if (!payable)
      throw new BadRequestException({
        message: MSG.POSTING_ACCOUNT_MISSING,
        details: { missingPostingAccounts: [key] },
      });

    // every withholding of the month not yet in a challan (rows locked)
    const open = await this.db.tx
      .selectFrom('tax_withholdings')
      .select(['id', 'amount'])
      .where('company_id', '=', companyId)
      .where('tax_type', '=', dto.taxType)
      .where('period', '=', dto.period)
      .where('state', '=', 'active')
      .where('challan_id', 'is', null)
      .forUpdate()
      .execute();
    if (!open.length) throw new BadRequestException(MSG.NOTHING_TO_DEPOSIT);
    const amount = Money.sum(open.map((w) => w.amount)).toDb();

    const challan = await this.db.tx
      .insertInto('tax_challans')
      .values({
        company_id: companyId,
        tax_type: dto.taxType,
        period: dto.period,
        challan_no: dto.challanNo,
        challan_date: dto.challanDate,
        paid_from_account_id: from.id,
        amount,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('tax_withholdings')
      .set({ challan_id: challan.id })
      .where(
        'id',
        'in',
        open.map((w) => w.id),
      )
      .execute();
    const voucher = await this.vouchers.createLinked({
      companyId,
      voucherType: 'payment',
      voucherDate: dto.challanDate,
      narration: `${TAX_NAME[dto.taxType]}, ${dto.period}: challan ${dto.challanNo}`,
      sourceType: TAX_CHALLAN_SOURCE,
      sourceId: challan.id,
      lines: [
        { accountId: payable, debit: amount },
        {
          accountId: from.id,
          credit: amount,
          narration: `Challan ${dto.challanNo}`,
        },
      ],
    });
    await this.db.tx
      .updateTable('tax_challans')
      .set({ voucher_id: voucher.id })
      .where('id', '=', challan.id)
      .execute();
    await this.audit.record({
      action: 'tax_challan.created',
      entity: 'tax_challan',
      entityId: challan.id,
      after: {
        taxType: dto.taxType,
        period: dto.period,
        challanNo: dto.challanNo,
        amount,
        withholdings: open.length,
        voucher: voucher.number,
      },
    });
    return this.getChallan(challan.id);
  }

  async listChallans(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('tax_challans as c')
      .leftJoin('vouchers as v', 'v.id', 'c.voucher_id')
      .selectAll('c')
      .select(['v.number as voucher_number', 'v.approval_request_id'])
      .where('c.company_id', '=', companyId)
      .orderBy('c.challan_date', 'desc')
      .limit(500)
      .execute();
    return rows.map((r) => ({
      ...toChallanResponse(r),
      voucherNumber: r.voucher_number,
      approvalRequestId: r.approval_request_id,
    }));
  }

  async getChallan(id: string) {
    const challan = await this.findChallan(id);
    this.access.assert('payables.view', { companyId: challan.company_id });
    const voucher = challan.voucher_id
      ? await this.vouchers.find(challan.voucher_id)
      : null;
    const lines = await this.db.tx
      .selectFrom('tax_withholdings as w')
      .innerJoin('vendors as v', 'v.id', 'w.vendor_id')
      .innerJoin('vendor_bills as b', 'b.id', 'w.bill_id')
      .select([
        'w.id',
        'v.code',
        'v.name',
        'v.tin',
        'b.bill_no',
        'w.deducted_on',
        'w.base',
        'w.percent',
        'w.amount',
      ])
      .where('w.challan_id', '=', id)
      .orderBy('v.code')
      .execute();
    return {
      ...toChallanResponse(challan),
      voucherNumber: voucher?.number ?? null,
      approvalRequestId: voucher?.approval_request_id ?? null,
      withholdings: lines.map((l) => ({
        id: l.id,
        vendorCode: l.code,
        vendorName: l.name,
        vendorTin: l.tin,
        billNo: l.bill_no,
        deductedOn: l.deducted_on,
        base: l.base,
        percent: l.percent,
        amount: l.amount,
      })),
    };
  }

  private async deposited(voucher: Voucher) {
    await this.db.tx
      .updateTable('tax_challans')
      .set({ state: 'deposited' })
      .where('id', '=', voucher.source_id!)
      .execute();
    await this.audit.record({
      action: 'tax_challan.deposited',
      entity: 'tax_challan',
      entityId: voucher.source_id!,
      after: { voucher: voucher.number },
    });
  }

  /** Dropped before posting, or reversed after: the withholdings wait for a new challan. */
  private async released(voucher: Voucher, state: 'cancelled' | 'reversed') {
    await this.db.tx
      .updateTable('tax_challans')
      .set({ state })
      .where('id', '=', voucher.source_id!)
      .execute();
    await this.db.tx
      .updateTable('tax_withholdings')
      .set({ challan_id: null })
      .where('challan_id', '=', voucher.source_id!)
      .execute();
    await this.audit.record({
      action: `tax_challan.${state}`,
      entity: 'tax_challan',
      entityId: voucher.source_id!,
      after: { voucher: voucher.number },
    });
  }

  private async assertNotCertified(voucher: Voucher) {
    const certified = await this.db.tx
      .selectFrom('tax_withholdings')
      .select('id')
      .where('challan_id', '=', voucher.source_id!)
      .where('certificate_id', 'is not', null)
      .executeTakeFirst();
    if (certified) throw new ConflictException(MSG.CHALLAN_CERTIFIED);
  }

  private async findChallan(id: string): Promise<TaxChallan> {
    const challan = await this.db.tx
      .selectFrom('tax_challans')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!challan) throw new NotFoundException(MSG.CHALLAN_NOT_FOUND);
    return challan;
  }

  // ========================================================= certificates

  async issueCertificate(vendorId: string, dto: CreateCertificateDto) {
    const vendor = await this.vendors.find(vendorId);
    this.access.assert('payables.tax', { companyId: vendor.company_id });
    if (dto.to < dto.from) throw new BadRequestException(MSG.VALIDATION_FAILED);

    // deposited, not yet certified (rows locked)
    const rows = await this.db.tx
      .selectFrom('tax_withholdings as w')
      .innerJoin('tax_challans as c', 'c.id', 'w.challan_id')
      .select(['w.id', 'w.amount'])
      .where('w.vendor_id', '=', vendorId)
      .where('w.tax_type', '=', dto.taxType)
      .where('w.state', '=', 'active')
      .where('w.certificate_id', 'is', null)
      .where('c.state', '=', 'deposited')
      .where('w.deducted_on', '>=', dto.from)
      .where('w.deducted_on', '<=', dto.to)
      .forUpdate()
      .execute();
    if (!rows.length) throw new BadRequestException(MSG.NOTHING_TO_CERTIFY);
    const amount = Money.sum(rows.map((r) => r.amount)).toDb();

    const number = await this.nextCertificateNumber(
      vendor.company_id,
      dto.taxType,
      dto.to,
    );
    const certificate = await this.db.tx
      .insertInto('tax_certificates')
      .values({
        company_id: vendor.company_id,
        vendor_id: vendorId,
        tax_type: dto.taxType,
        number,
        period_from: dto.from,
        period_to: dto.to,
        amount,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .updateTable('tax_withholdings')
      .set({ certificate_id: certificate.id })
      .where(
        'id',
        'in',
        rows.map((r) => r.id),
      )
      .execute();
    await this.audit.record({
      action: 'tax_certificate.issued',
      entity: 'vendor',
      entityId: vendorId,
      after: {
        number,
        taxType: dto.taxType,
        from: dto.from,
        to: dto.to,
        amount,
      },
    });
    return this.getCertificate(certificate.id);
  }

  async listCertificates(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('payables.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('tax_certificates as t')
      .innerJoin('vendors as v', 'v.id', 't.vendor_id')
      .selectAll('t')
      .select(['v.code as vendor_code', 'v.name as vendor_name'])
      .where('t.company_id', '=', companyId)
      .orderBy('t.issued_at', 'desc')
      .limit(500)
      .execute();
    return rows.map((t) => ({
      id: t.id,
      number: t.number,
      taxType: t.tax_type,
      vendorId: t.vendor_id,
      vendorCode: t.vendor_code,
      vendorName: t.vendor_name,
      periodFrom: t.period_from,
      periodTo: t.period_to,
      amount: t.amount,
      issuedAt: t.issued_at,
    }));
  }

  /** Everything the printed certificate shows. */
  async getCertificate(id: string) {
    const t = await this.db.tx
      .selectFrom('tax_certificates')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!t) throw new NotFoundException(MSG.CERTIFICATE_NOT_FOUND);
    this.access.assert('payables.view', { companyId: t.company_id });
    const vendor = await this.vendors.find(t.vendor_id);
    const company = await this.org.companyNames(t.company_id);
    const lines = await this.db.tx
      .selectFrom('tax_withholdings as w')
      .innerJoin('vendor_bills as b', 'b.id', 'w.bill_id')
      .innerJoin('tax_challans as c', 'c.id', 'w.challan_id')
      .select([
        'b.bill_no',
        'b.bill_date',
        'w.category',
        'w.base',
        'w.percent',
        'w.amount',
        'c.challan_no',
        'c.challan_date',
      ])
      .where('w.certificate_id', '=', id)
      .orderBy('b.bill_date')
      .execute();
    return {
      id: t.id,
      number: t.number,
      taxType: t.tax_type,
      title:
        t.tax_type === 'tds'
          ? 'Certificate of tax deducted at source'
          : 'Certificate of VAT deducted at source (Mushak 6.6)',
      periodFrom: t.period_from,
      periodTo: t.period_to,
      amount: t.amount,
      issuedAt: t.issued_at,
      deductor: { name: company.legalName },
      vendor: {
        id: vendor.id,
        code: vendor.code,
        name: vendor.name,
        nameBn: vendor.name_bn,
        tin: vendor.tin,
        bin: vendor.bin,
        address: vendor.address,
      },
      lines: lines.map((l) => ({
        billNo: l.bill_no,
        billDate: l.bill_date,
        category: l.category,
        base: l.base,
        percent: l.percent,
        amount: l.amount,
        challanNo: l.challan_no,
        challanDate: l.challan_date,
      })),
    };
  }

  /** Gapless per company x kind x fiscal year (the counter row is locked until commit). */
  private async nextCertificateNumber(
    companyId: string,
    taxType: TaxType,
    onDate: string,
  ) {
    const year = await this.db.tx
      .selectFrom('fiscal_years')
      .select('code')
      .where('company_id', '=', companyId)
      .where('starts_on', '<=', onDate)
      .where('ends_on', '>=', onDate)
      .executeTakeFirst();
    const code = year?.code ?? fiscalYearOf(businessDate(onDate));
    const row = await this.db.tx
      .insertInto('payables_sequences')
      .values({
        company_id: companyId,
        kind: `${taxType}_certificate`,
        fiscal_year_code: code,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'company_id', 'kind', 'fiscal_year_code'])
          .doUpdateSet({ last_no: sql`payables_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return `${taxType === 'tds' ? 'TDSC' : 'VDSC'}/${code}/${String(row.last_no).padStart(5, '0')}`;
  }
}

function toChallanResponse(c: TaxChallan) {
  return {
    id: c.id,
    companyId: c.company_id,
    taxType: c.tax_type,
    period: c.period,
    challanNo: c.challan_no,
    challanDate: c.challan_date,
    paidFromAccountId: c.paid_from_account_id,
    amount: c.amount,
    state: c.state,
    voucherId: c.voucher_id,
    createdAt: c.created_at,
  };
}
