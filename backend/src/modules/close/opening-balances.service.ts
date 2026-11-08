/**
 * Opening balances from the old system (WP22; Gate 2 starts here).
 *
 *   import(company, file, cutOverDate)   the old trial balance at the end of the day before
 *               cut-over (trial-balance-files.ts), checked against the chart:
 *                 every account code exists and takes postings;
 *                 payables lines name a vendor (code) and the bill (reference, date);
 *                 receivables lines name the customer and the invoice;
 *                 employee advance lines name the employee (code);
 *                 the file balances.
 *               It becomes THE opening voucher (one per company), a journal on the cut-over
 *               day that goes to the checker. Nothing else changes until it is posted.
 *   on posting  the open items behind the control accounts are created, so each control
 *               account equals its sub-ledger from day one: unpaid vendor bills (opening
 *               bills, no journal of their own) and customer invoices (receivable items);
 *               the old account codes are kept as the account map for the later comparisons;
 *               the empty months before cut-over close (the old system kept them).
 *   A posted opening is final: corrections are journals (the open items would no longer
 *   match otherwise).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  OpeningBalanceImport,
  Voucher,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import {
  VouchersService,
  type PostingLine,
} from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { parseOpening } from './trial-balance-files.js';

export const OPENING_SOURCE = 'opening_balances';
export const MAX_TB_BYTES = 2 * 1024 * 1024;

/** A checked row, with the ids it resolved to. */
interface ResolvedRow {
  rowNo: number;
  accountId: string;
  accountCode: string;
  role: string | null;
  oldCode: string | null;
  oldName: string | null;
  debit: string;
  credit: string;
  departmentId: string | null;
  vendorId: string | null;
  employeeId: string | null;
  customerName: string | null;
  reference: string | null;
  date: string | null;
  dueDate: string | null;
}

@Injectable()
export class OpeningBalancesService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly vouchers: VouchersService,
  ) {}

  onModuleInit() {
    this.vouchers.registerSource(OPENING_SOURCE, {
      onPosted: (v) => this.posted(v),
      onDropped: (v) => this.dropped(v),
      assertReversible: async () => {
        throw new ConflictException(MSG.OPENING_IMPORT_FINAL);
      },
    });
  }

  async status(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('opening_balance_imports as i')
      .leftJoin('vouchers as v', 'v.id', 'i.voucher_id')
      .selectAll('i')
      .select(['v.number', 'v.approval_request_id'])
      .where('i.company_id', '=', companyId)
      .orderBy('i.created_at', 'desc')
      .execute();
    const mapped = await this.db.tx
      .selectFrom('account_map')
      .select(({ fn }) => fn.countAll<number>().as('n'))
      .where('company_id', '=', companyId)
      .executeTakeFirstOrThrow();
    return {
      imports: rows.map((r) => ({
        ...this.toImport(r),
        voucherNumber: r.number,
        approvalRequestId: r.approval_request_id,
      })),
      mappedOldAccounts: Number(mapped.n),
    };
  }

  async upload(
    companyId: string,
    file: Express.Multer.File | undefined,
    cutOverDate: string,
  ) {
    if (!file?.buffer?.length || file.size > MAX_TB_BYTES)
      throw new BadRequestException(MSG.BANK_FILE_MISSING);
    return this.import(
      companyId,
      { name: file.originalname, content: file.buffer.toString('utf8') },
      cutOverDate,
    );
  }

  async import(
    companyId: string,
    file: { name: string; content: string },
    cutOverDate: string,
  ) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    if (!cutOverDate.endsWith('-01'))
      throw new BadRequestException(MSG.OPENING_VOUCHER_RULES);
    const live = await this.db.tx
      .selectFrom('opening_balance_imports')
      .select('state')
      .where('company_id', '=', companyId)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (live) throw new ConflictException(MSG.OPENING_BALANCES_EXIST);

    const parsed = parseOpening(file.content);
    const problems = [...parsed.problems];
    const rows = problems.length
      ? []
      : await this.resolve(companyId, parsed.rows, problems);
    if (problems.length)
      throw new BadRequestException({
        message: MSG.OPENING_FILE_INVALID,
        details: { problems: problems.slice(0, 30) },
      });

    const record = await this.db.tx
      .insertInto('opening_balance_imports')
      .values({
        company_id: companyId,
        cut_over_date: cutOverDate,
        file_name: file.name,
        file_sha256: createHash('sha256').update(file.content).digest('hex'),
        rows: JSON.stringify(rows),
        total_debit: parsed.totalDebit,
        total_credit: parsed.totalCredit,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const lines: PostingLine[] = rows.map((r) => ({
      accountId: r.accountId,
      departmentId: r.departmentId,
      ...(r.vendorId
        ? { partyType: 'vendor' as const, partyId: r.vendorId }
        : r.employeeId
          ? { partyType: 'employee' as const, partyId: r.employeeId }
          : {}),
      debit: Money.of(r.debit).isPositive() ? r.debit : undefined,
      credit: Money.of(r.credit).isPositive() ? r.credit : undefined,
      narration:
        [r.oldCode, r.oldName, r.customerName, r.reference]
          .filter(Boolean)
          .join(' · ')
          .slice(0, 200) || null,
    }));
    const voucher = await this.vouchers.createLinked({
      companyId,
      voucherType: 'journal',
      voucherDate: cutOverDate,
      narration: `Opening balances from the old system at ${cutOverDate} (${file.name})`,
      sourceType: OPENING_SOURCE,
      sourceId: record.id,
      lines,
      isOpening: true,
    });
    await this.db.tx
      .updateTable('opening_balance_imports')
      .set({ voucher_id: voucher.id })
      .where('id', '=', record.id)
      .execute();
    await this.audit.record({
      action: 'opening_balances.imported',
      entity: 'opening_balance_import',
      entityId: record.id,
      after: {
        file: file.name,
        cutOverDate,
        rows: rows.length,
        total: parsed.totalDebit,
        voucher: voucher.number,
      },
    });
    return {
      ...this.toImport({ ...record, voucher_id: voucher.id }),
      voucherNumber: voucher.number,
      approvalRequestId: voucher.approval_request_id,
    };
  }

  // ================================================================ internals

  private async resolve(
    companyId: string,
    rows: ReturnType<typeof parseOpening>['rows'],
    problems: string[],
  ): Promise<ResolvedRow[]> {
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code', 'role', 'postable', 'is_active'])
      .where('company_id', '=', companyId)
      .execute();
    const vendors = await this.db.tx
      .selectFrom('vendors')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .execute();
    const employees = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'employee_code'])
      .where('company_id', '=', companyId)
      .execute();
    const departments = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .execute();
    const out: ResolvedRow[] = [];
    for (const r of rows) {
      const a = accounts.find((x) => x.code === r.accountCode);
      if (!a || !a.postable || !a.is_active) {
        problems.push(
          `Row ${r.rowNo}: account ${r.accountCode} is not in the chart or does not take postings`,
        );
        continue;
      }
      const dept = r.departmentCode
        ? departments.find((d) => d.code === r.departmentCode)
        : undefined;
      if (r.departmentCode && !dept)
        problems.push(
          `Row ${r.rowNo}: department ${r.departmentCode} not found`,
        );
      const row: ResolvedRow = {
        rowNo: r.rowNo,
        accountId: a.id,
        accountCode: a.code,
        role: a.role,
        oldCode: r.oldCode,
        oldName: r.oldName,
        debit: r.debit,
        credit: r.credit,
        departmentId: dept?.id ?? null,
        vendorId: null,
        employeeId: null,
        customerName: null,
        reference: r.reference,
        date: r.date,
        dueDate: r.dueDate,
      };
      if (a.role === 'payables') {
        const v = vendors.find((x) => x.code === r.party);
        if (!v)
          problems.push(
            `Row ${r.rowNo}: payables need the vendor's code (party); "${r.party ?? ''}" not found`,
          );
        if (!r.reference || !r.date)
          problems.push(
            `Row ${r.rowNo}: payables need the bill number (reference) and date`,
          );
        if (Money.of(r.debit).isPositive())
          problems.push(
            `Row ${r.rowNo}: a vendor balance is a credit (an advance to a vendor goes to advances)`,
          );
        row.vendorId = v?.id ?? null;
      } else if (a.role === 'receivables') {
        if (!r.party || !r.reference || !r.date)
          problems.push(
            `Row ${r.rowNo}: receivables need the customer (party), the invoice number (reference) and date`,
          );
        if (Money.of(r.credit).isPositive())
          problems.push(`Row ${r.rowNo}: a customer balance is a debit`);
        row.customerName = r.party;
      } else if (a.role === 'employee_advances') {
        const e = employees.find((x) => x.employee_code === r.party);
        if (!e)
          problems.push(
            `Row ${r.rowNo}: employee advances need the employee's code (party); "${r.party ?? ''}" not found`,
          );
        row.employeeId = e?.id ?? null;
      }
      out.push(row);
    }
    return out;
  }

  /** The checker posted the opening voucher: open items and the account map. */
  private async posted(v: Voucher) {
    const record = await this.db.tx
      .selectFrom('opening_balance_imports')
      .selectAll()
      .where('id', '=', v.source_id!)
      .executeTakeFirstOrThrow();
    const rows = record.rows as ResolvedRow[];
    const vendors = new Map(
      (
        await this.db.tx
          .selectFrom('vendors')
          .select(['id', 'withholding_category'])
          .where('company_id', '=', record.company_id)
          .execute()
      ).map((x) => [x.id, x.withholding_category]),
    );
    for (const r of rows.filter((x) => x.role === 'payables' && x.vendorId)) {
      await this.db.tx
        .insertInto('vendor_bills')
        .values({
          company_id: record.company_id,
          vendor_id: r.vendorId!,
          bill_no: r.reference!,
          bill_date: r.date!,
          due_date: r.dueDate && r.dueDate >= r.date! ? r.dueDate : r.date!,
          narration: `Opening balance from the old system (${r.oldCode ?? r.accountCode})`,
          withholding_category: vendors.get(r.vendorId!) ?? 'EXEMPT',
          base_amount: r.credit,
          net_payable: r.credit,
          state: 'approved',
          voucher_id: v.id,
          is_opening: true,
        })
        .execute();
    }
    for (const r of rows.filter((x) => x.role === 'receivables')) {
      await this.db.tx
        .insertInto('receivable_items')
        .values({
          company_id: record.company_id,
          customer_name: r.customerName!,
          reference: r.reference!,
          invoice_date: r.date!,
          due_date: r.dueDate && r.dueDate >= r.date! ? r.dueDate : r.date!,
          amount: r.debit,
          opening_import_id: record.id,
        })
        .execute();
    }
    for (const r of rows.filter((x) => x.oldCode)) {
      await this.db.tx
        .insertInto('account_map')
        .values({
          company_id: record.company_id,
          old_code: r.oldCode!,
          old_name: r.oldName,
          account_id: r.accountId,
        })
        .onConflict((oc) =>
          oc
            .columns(['tenant_id', 'company_id', 'old_code'])
            .doUpdateSet({ old_name: r.oldName, account_id: r.accountId }),
        )
        .execute();
    }
    // the months before cut-over were kept in the old system: those without a voucher here close
    const before = await this.db.tx
      .selectFrom('accounting_periods as p')
      .select(['p.id', 'p.period'])
      .where('p.company_id', '=', record.company_id)
      .where('p.state', '=', 'open')
      .where('p.ends_on', '<', record.cut_over_date)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('vouchers as v')
              .select('v.id')
              .where('v.company_id', '=', record.company_id)
              .whereRef('v.voucher_date', '>=', 'p.starts_on')
              .whereRef('v.voucher_date', '<=', 'p.ends_on'),
          ),
        ),
      )
      .execute();
    if (before.length) {
      await this.db.tx
        .updateTable('accounting_periods')
        .set({
          state: 'closed',
          closed_by: this.access.current().userId ?? null,
          closed_at: this.clock.now(),
        })
        .where(
          'id',
          'in',
          before.map((p) => p.id),
        )
        .execute();
    }
    await this.db.tx
      .updateTable('opening_balance_imports')
      .set({ state: 'posted' })
      .where('id', '=', record.id)
      .execute();
    await this.audit.record({
      action: 'opening_balances.posted',
      entity: 'opening_balance_import',
      entityId: record.id,
      after: { voucher: v.number },
    });
  }

  private async dropped(v: Voucher) {
    await this.db.tx
      .updateTable('opening_balance_imports')
      .set({ state: 'cancelled' })
      .where('id', '=', v.source_id!)
      .execute();
  }

  private toImport(r: OpeningBalanceImport) {
    return {
      id: r.id,
      companyId: r.company_id,
      cutOverDate: r.cut_over_date,
      fileName: r.file_name,
      totalDebit: r.total_debit,
      totalCredit: r.total_credit,
      state: r.state,
      voucherId: r.voucher_id,
      rows: (r.rows as ResolvedRow[]).length,
      createdAt: r.created_at,
    };
  }
}
