/**
 * Vouchers: double entry with maker-checker (spec §2 principles 5-6, §5, §6.6, §11).
 *
 *   create / update      the maker (Accounts) prepares a draft; it gets its gapless
 *                        number at once (PV/2026-27/00042), and keeps it even if
 *                        cancelled (spec §11)
 *   submit               lines frozen; approval: another Accounts user checks it,
 *                        and an Admin too above Tk 10 lakh (illustrative; the
 *                        company can configure the chain)
 *   (approved)           posted: in the books for good
 *   (returned)           back to draft for the maker; (rejected / cancelled) cancelled
 *   reverse              a reversal voucher with the lines swapped, through the same
 *                        approval; once posted, the original shows "reversed by"
 *   postAutomatic        postings from other modules' approved documents (payroll,
 *                        salary payment ...): no second approval, one per source
 *   createLinked         a voucher for another module's document that still needs
 *                        the checker (vendor payment, tax challan); the module hears
 *                        when it is posted, dropped or reversed (registerSource)
 *
 * Control accounts (roles "payables", "employee_advances", "receivables", "customer_advances") take no manual
 * lines: only their sub-ledger documents post to them, so the account always equals the
 * sub-ledger (WP15, WP16, WP22, WP27).
 *
 * Rules checked here, and again by the database (migration 0020): balanced lines,
 * one side per line, postable accounts of the company, an open period (closed
 * periods take reversals only), cash / bank rules per voucher type.
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
import type {
  ApprovalRequest,
  Voucher,
  VoucherType,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CreateVoucherDto,
  ReverseVoucherDto,
  UpdateVoucherDto,
  VoucherLineDto,
  VoucherQueryDto,
} from './dto/ledger.dto.js';
import { voucherNumber } from './fiscal.js';

export const VOUCHER_REQUEST = 'voucher';

/** A line as the posting code builds it. */
export interface PostingLine {
  accountId: string;
  departmentId?: string | null;
  partyType?: 'employee' | 'vendor' | 'customer' | null;
  partyId?: string | null;
  debit?: string;
  credit?: string;
  narration?: string | null;
}

/** A module's say over vouchers made for its documents (createLinked). */
export interface VoucherSourceHandler {
  /** the checker approved: the voucher is in the books */
  onPosted?(voucher: Voucher): Promise<void>;
  /** rejected, returned or withdrawn before posting */
  onDropped?(voucher: Voucher): Promise<void>;
  /** throw to refuse a reversal (e.g. a bill that is already paid) */
  assertReversible?(voucher: Voucher): Promise<void>;
  /** a reversal of the voucher was posted */
  onReversed?(original: Voucher): Promise<void>;
}

export interface LinkedVoucher {
  companyId: string;
  voucherType: Extract<VoucherType, 'journal' | 'payment' | 'receipt'>;
  voucherDate: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  lines: PostingLine[];
  /** the company's opening balances (one opening voucher per company, a journal on a 1st) */
  isOpening?: boolean;
}

export interface AutomaticPosting {
  companyId: string;
  voucherType: Extract<VoucherType, 'journal' | 'payment' | 'receipt'>;
  voucherDate: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  lines: PostingLine[];
}

@Injectable()
export class VouchersService implements OnModuleInit {
  private readonly sources = new Map<string, VoucherSourceHandler>();

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly org: OrgLookupService,
  ) {}

  onModuleInit() {
    // spec §5: "Payment voucher: Accounts maker -> Accounts checker; above threshold -> Admin"
    this.handlers.register(
      VOUCHER_REQUEST,
      {
        onApproved: (r) => this.post(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [
        conditionalChain(
          'Voucher Tk 10 lakh or more (default)',
          { minAmount: '1000000' },
          step(1, 'role:accounts'),
          step(2, 'role:admin'),
        ),
        defaultChain('Voucher (default)', step(1, 'role:accounts')),
      ],
    );
  }

  /** A module that makes linked vouchers (vendor payments, challans) or automatic postings plugs in here. */
  registerSource(sourceType: string, handler: VoucherSourceHandler) {
    if (this.sources.has(sourceType))
      throw new Error(`Voucher source ${sourceType} registered twice`);
    this.sources.set(sourceType, handler);
  }

  // ================================================================ maker

  async create(companyId: string, dto: CreateVoucherDto) {
    this.access.assert('ledger.vouchers.prepare', { companyId });
    // checks: lines, accounts, period
    await this.checkLines(companyId, dto.voucherType, dto.lines, {
      manual: true,
    });
    const { fiscalYearId, fiscalYearCode } = await this.periodFor(
      companyId,
      dto.voucherDate,
      false,
    );
    if (dto.isOpening) await this.checkOpening(companyId, dto);

    // number, draft, lines
    const number = await this.nextNumber(
      companyId,
      fiscalYearId,
      fiscalYearCode,
      dto.voucherType,
    );
    const voucher = await this.db.tx
      .insertInto('vouchers')
      .values({
        company_id: companyId,
        fiscal_year_id: fiscalYearId,
        voucher_type: dto.voucherType,
        number,
        voucher_date: dto.voucherDate,
        narration: dto.narration,
        total: totalOf(dto.lines),
        is_opening: dto.isOpening ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(voucher.id, dto.lines);
    await this.audit.record({
      action: 'voucher.created',
      entity: 'voucher',
      entityId: voucher.id,
      after: {
        number,
        type: dto.voucherType,
        date: dto.voucherDate,
        total: voucher.total,
        opening: voucher.is_opening,
      },
    });
    return this.get(voucher.id);
  }

  async update(id: string, dto: UpdateVoucherDto) {
    const v = await this.find(id);
    this.access.assert('ledger.vouchers.prepare', { companyId: v.company_id });
    if (v.state !== 'draft' || v.source_type)
      throw new ConflictException(MSG.VOUCHER_WRONG_STATE);
    if (v.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);

    // the date stays in the number's fiscal year
    if (dto.voucherDate) {
      const { fiscalYearId } = await this.periodFor(
        v.company_id,
        dto.voucherDate,
        v.reversal_of !== null,
      );
      if (fiscalYearId !== v.fiscal_year_id)
        throw new BadRequestException(MSG.VALIDATION_FAILED);
    }
    if (dto.lines) {
      await this.checkLines(v.company_id, v.voucher_type, dto.lines, {
        manual: true,
      });
      await this.db.tx
        .deleteFrom('voucher_lines')
        .where('voucher_id', '=', id)
        .execute();
      await this.insertLines(id, dto.lines);
    }
    await this.db.tx
      .updateTable('vouchers')
      .set({
        ...(dto.voucherDate ? { voucher_date: dto.voucherDate } : {}),
        ...(dto.narration ? { narration: dto.narration } : {}),
        ...(dto.lines ? { total: totalOf(dto.lines) } : {}),
        version: sql`version + 1`,
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'voucher.updated',
      entity: 'voucher',
      entityId: id,
      after: { number: v.number, ...dto },
    });
    return this.get(id);
  }

  /** Send to the checker: lines are frozen from now on. */
  async submit(id: string) {
    const v = await this.find(id);
    this.access.assert('ledger.vouchers.prepare', { companyId: v.company_id });
    if (v.state !== 'draft')
      throw new ConflictException(MSG.VOUCHER_WRONG_STATE);
    // the period may have been closed since the draft was made
    await this.periodFor(v.company_id, v.voucher_date, v.reversal_of !== null);

    const lines = await this.linesOf(id);
    const request = await this.approvals.submit({
      requestType: VOUCHER_REQUEST,
      sourceId: v.id,
      subjectEmployeeId: null,
      companyId: v.company_id,
      summary: `${v.number}: ${v.narration}`,
      amount: v.total,
      kind: v.voucher_type,
      snapshot: {
        number: v.number,
        voucherType: v.voucher_type,
        voucherDate: v.voucher_date,
        narration: v.narration,
        total: v.total,
        reversalOf: v.reversal_of,
        lines: lines
          .map(
            (l) =>
              `${l.code} ${l.name_en}: ${l.debit !== '0.00' ? `Dr ${l.debit}` : `Cr ${l.credit}`}`,
          )
          .join(' | '),
      },
    });
    await this.db.tx
      .updateTable('vouchers')
      .set({ state: 'in_approval', approval_request_id: request.id })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'voucher.submitted',
      entity: 'voucher',
      entityId: id,
      after: { number: v.number, approvalRequestId: request.id },
    });
    return this.get(id);
  }

  /** Withdraw a draft. The number stays, shown as cancelled. */
  async cancel(id: string, reason: string) {
    const v = await this.find(id);
    this.access.assert('ledger.vouchers.prepare', { companyId: v.company_id });
    if (v.state !== 'draft')
      throw new ConflictException(MSG.VOUCHER_WRONG_STATE);
    await this.db.tx
      .updateTable('vouchers')
      .set({ state: 'cancelled', reason })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'voucher.cancelled',
      entity: 'voucher',
      entityId: id,
      after: { number: v.number, reason },
    });
    return this.get(id);
  }

  /** Correct a posted voucher: the same lines swapped, approved like any voucher. */
  async reverse(id: string, dto: ReverseVoucherDto) {
    const v = await this.find(id);
    this.access.assert('ledger.vouchers.prepare', { companyId: v.company_id });
    if (v.state !== 'posted')
      throw new ConflictException(MSG.VOUCHER_WRONG_STATE);
    const pending = await this.db.tx
      .selectFrom('vouchers')
      .select('id')
      .where('reversal_of', '=', id)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (v.reversed_by || pending)
      throw new ConflictException(MSG.VOUCHER_ALREADY_REVERSED);
    if (v.source_type)
      await this.sources.get(v.source_type)?.assertReversible?.(v);

    const date = dto.voucherDate ?? todayInDhaka(this.clock.now());
    const { fiscalYearId, fiscalYearCode } = await this.periodFor(
      v.company_id,
      date,
      true,
    );
    const number = await this.nextNumber(
      v.company_id,
      fiscalYearId,
      fiscalYearCode,
      v.voucher_type,
    );
    const lines = await this.linesOf(id);
    const reversal = await this.db.tx
      .insertInto('vouchers')
      .values({
        company_id: v.company_id,
        fiscal_year_id: fiscalYearId,
        voucher_type: v.voucher_type,
        number,
        voucher_date: date,
        narration: `Reversal of ${v.number}: ${dto.reason}`,
        reversal_of: v.id,
        reason: dto.reason,
        total: v.total,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(
      reversal.id,
      lines.map((l) => ({
        accountId: l.account_id,
        departmentId: l.department_id,
        partyType: l.party_type,
        partyId: l.party_id,
        debit: l.credit,
        credit: l.debit,
        narration: l.narration,
      })),
    );
    await this.audit.record({
      action: 'voucher.reversal_created',
      entity: 'voucher',
      entityId: reversal.id,
      after: { number, reversalOf: v.number, reason: dto.reason },
    });
    return this.submit(reversal.id);
  }

  // ======================================================= approval hooks

  /** Checker (and Admin) approved: into the books. */
  private async post(request: ApprovalRequest): Promise<void> {
    const v = await this.find(request.source_id);
    await this.db.tx
      .updateTable('vouchers')
      .set({ state: 'posted' })
      .where('id', '=', v.id)
      .execute();
    if (v.reversal_of)
      await this.db.tx
        .updateTable('vouchers')
        .set({ reversed_by: v.id })
        .where('id', '=', v.reversal_of)
        .execute();
    await this.audit.record({
      action: 'voucher.posted',
      entity: 'voucher',
      entityId: v.id,
      after: { number: v.number, total: v.total },
    });
    await this.outbox.add({
      type: 'voucher.posted',
      entityId: v.id,
      payload: {
        companyId: v.company_id,
        number: v.number,
        voucherType: v.voucher_type,
        total: v.total,
      },
    });

    // the module of a linked document hears about it
    if (v.source_type && !v.reversal_of)
      await this.sources.get(v.source_type)?.onPosted?.(await this.find(v.id));
    if (v.reversal_of) {
      const original = await this.find(v.reversal_of);
      if (original.source_type)
        await this.sources.get(original.source_type)?.onReversed?.(original);
    }
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ): Promise<void> {
    const v = await this.find(request.source_id);
    if (outcome === 'returned') {
      // back to the maker to correct (a reversal or a linked voucher cannot be edited: it is cancelled instead)
      if (v.reversal_of || v.source_type)
        await this.db.tx
          .updateTable('vouchers')
          .set({ state: 'cancelled', reason: 'Returned by the checker' })
          .where('id', '=', v.id)
          .execute();
      else
        await this.db.tx
          .updateTable('vouchers')
          .set({ state: 'draft', approval_request_id: null })
          .where('id', '=', v.id)
          .execute();
    } else {
      await this.db.tx
        .updateTable('vouchers')
        .set({
          state: 'cancelled',
          reason:
            outcome === 'rejected'
              ? 'Rejected by the checker'
              : 'Cancelled by the maker',
        })
        .where('id', '=', v.id)
        .execute();
    }
    await this.audit.record({
      action: `voucher.${outcome}`,
      entity: 'voucher',
      entityId: v.id,
      after: { number: v.number },
    });
    if (v.source_type && !v.reversal_of)
      await this.sources.get(v.source_type)?.onDropped?.(await this.find(v.id));
  }

  // ================================================== automatic postings

  /**
   * A posting from another module's approved document (payroll run, bank file
   * ...): numbered and posted at once, no second approval (the document was
   * approved). One per source: a second call finds the first.
   */
  async postAutomatic(input: AutomaticPosting): Promise<Voucher> {
    const already = await this.db.tx
      .selectFrom('vouchers')
      .selectAll()
      .where('company_id', '=', input.companyId)
      .where('source_type', '=', input.sourceType)
      .where('source_id', '=', input.sourceId)
      .where('reversal_of', 'is', null)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (already) throw new ConflictException(MSG.ALREADY_POSTED);

    const lines = mergeLines(input.lines);
    await this.checkLines(input.companyId, input.voucherType, lines);
    const { fiscalYearId, fiscalYearCode } = await this.periodFor(
      input.companyId,
      input.voucherDate,
      false,
    );
    const number = await this.nextNumber(
      input.companyId,
      fiscalYearId,
      fiscalYearCode,
      input.voucherType,
    );
    const voucher = await this.db.tx
      .insertInto('vouchers')
      .values({
        company_id: input.companyId,
        fiscal_year_id: fiscalYearId,
        voucher_type: input.voucherType,
        number,
        voucher_date: input.voucherDate,
        narration: input.narration,
        source_type: input.sourceType,
        source_id: input.sourceId,
        total: totalOf(lines),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(voucher.id, lines);
    const posted = await this.db.tx
      .updateTable('vouchers')
      .set({ state: 'posted' })
      .where('id', '=', voucher.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'voucher.auto_posted',
      entity: 'voucher',
      entityId: voucher.id,
      after: {
        number,
        source: `${input.sourceType}:${input.sourceId}`,
        total: posted.total,
      },
    });
    await this.outbox.add({
      type: 'voucher.posted',
      entityId: voucher.id,
      payload: {
        companyId: input.companyId,
        number,
        voucherType: input.voucherType,
        total: posted.total,
        source: input.sourceType,
      },
    });
    return posted;
  }

  /**
   * A voucher for another module's document that still goes to the checker
   * (vendor payment, tax challan): created and submitted at once, never edited.
   */
  async createLinked(input: LinkedVoucher): Promise<Voucher> {
    const lines = mergeLines(input.lines);
    await this.checkLines(input.companyId, input.voucherType, lines);
    if (input.isOpening)
      await this.checkOpening(input.companyId, {
        voucherType: input.voucherType,
        voucherDate: input.voucherDate,
        narration: input.narration,
        lines: [],
      });
    const { fiscalYearId, fiscalYearCode } = await this.periodFor(
      input.companyId,
      input.voucherDate,
      false,
    );
    const number = await this.nextNumber(
      input.companyId,
      fiscalYearId,
      fiscalYearCode,
      input.voucherType,
    );
    const voucher = await this.db.tx
      .insertInto('vouchers')
      .values({
        company_id: input.companyId,
        fiscal_year_id: fiscalYearId,
        voucher_type: input.voucherType,
        number,
        voucher_date: input.voucherDate,
        narration: input.narration,
        source_type: input.sourceType,
        source_id: input.sourceId,
        total: totalOf(lines),
        is_opening: input.isOpening ?? false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.insertLines(voucher.id, lines);
    await this.audit.record({
      action: 'voucher.created',
      entity: 'voucher',
      entityId: voucher.id,
      after: {
        number,
        type: input.voucherType,
        source: `${input.sourceType}:${input.sourceId}`,
        total: voucher.total,
        opening: input.isOpening ?? false,
      },
    });
    await this.submit(voucher.id);
    return this.find(voucher.id);
  }

  /** Can a posting be dated on this day? (open period of an opened fiscal year) */
  async canPostOn(companyId: string, date: string): Promise<boolean> {
    try {
      await this.periodFor(companyId, date, false);
      return true;
    } catch {
      return false;
    }
  }

  // =================================================================== read

  async list(companyId: string, query: VoucherQueryDto) {
    this.access.assert('ledger.view', { companyId });
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('vouchers')
      .selectAll()
      .where('company_id', '=', companyId);
    if (query.from) q = q.where('voucher_date', '>=', query.from);
    if (query.to) q = q.where('voucher_date', '<=', query.to);
    if (query.type) q = q.where('voucher_type', '=', query.type);
    if (query.state) q = q.where('state', '=', query.state);
    const rows = await q
      .orderBy('voucher_date', 'desc')
      .orderBy('number', 'desc')
      .limit(500)
      .execute();
    return rows.map(toVoucherSummary);
  }

  async get(id: string) {
    const v = await this.find(id);
    this.access.assert('ledger.view', { companyId: v.company_id });
    const lines = await this.linesOf(id);
    const departments = await this.db.tx
      .selectFrom('departments')
      .select(['id', 'name'])
      .where('id', 'in', [
        ...new Set(
          lines.map((l) => l.department_id).filter((d): d is string => !!d),
        ),
        '00000000-0000-0000-0000-000000000000',
      ])
      .execute();
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    return {
      ...toVoucherSummary(v),
      lines: lines.map((l) => ({
        id: l.id,
        lineNo: l.line_no,
        accountId: l.account_id,
        accountCode: l.code,
        accountName: l.name_en,
        departmentId: l.department_id,
        department: l.department_id
          ? (deptName.get(l.department_id) ?? null)
          : null,
        partyType: l.party_type,
        partyId: l.party_id,
        debit: l.debit,
        credit: l.credit,
        narration: l.narration,
      })),
    };
  }

  async find(id: string): Promise<Voucher> {
    const v = await this.db.tx
      .selectFrom('vouchers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!v) throw new NotFoundException(MSG.VOUCHER_NOT_FOUND);
    return v;
  }

  // ================================================================ helpers

  /** Opening balances: one journal, first day of a month, once per company (also the database). */
  private async checkOpening(companyId: string, dto: CreateVoucherDto) {
    if (dto.voucherType !== 'journal' || !dto.voucherDate.endsWith('-01'))
      throw new BadRequestException(MSG.OPENING_VOUCHER_RULES);
    const existing = await this.db.tx
      .selectFrom('vouchers')
      .select('number')
      .where('company_id', '=', companyId)
      .where('is_opening', '=', true)
      .where('reversal_of', 'is', null)
      .where('reversed_by', 'is', null)
      .where('state', '<>', 'cancelled')
      .executeTakeFirst();
    if (existing)
      throw new ConflictException({
        message: MSG.OPENING_BALANCES_EXIST,
        details: { number: existing.number },
      });
  }

  private linesOf(voucherId: string) {
    return this.db.tx
      .selectFrom('voucher_lines as l')
      .innerJoin('accounts as a', 'a.id', 'l.account_id')
      .select([
        'l.id',
        'l.line_no',
        'l.account_id',
        'l.department_id',
        'l.party_type',
        'l.party_id',
        'l.debit',
        'l.credit',
        'l.narration',
        'a.code',
        'a.name_en',
        'a.role',
      ])
      .where('l.voucher_id', '=', voucherId)
      .orderBy('l.line_no')
      .execute();
  }

  private async insertLines(voucherId: string, lines: PostingLine[]) {
    await this.db.tx
      .insertInto('voucher_lines')
      .values(
        lines.map((l, i) => ({
          voucher_id: voucherId,
          line_no: i + 1,
          account_id: l.accountId,
          department_id: l.departmentId ?? null,
          party_type: l.partyType ?? null,
          party_id: l.partyType ? (l.partyId ?? null) : null,
          debit: Money.of(l.debit || '0').toDb(),
          credit: Money.of(l.credit || '0').toDb(),
          narration: l.narration ?? null,
        })),
      )
      .execute();
  }

  /** Balanced, one side per line, postable active accounts and departments of the company, cash / bank rules. */
  private async checkLines(
    companyId: string,
    type: VoucherType,
    lines: Array<VoucherLineDto | PostingLine>,
    options: { manual?: boolean } = {},
  ) {
    const amount = (v?: string | null) => Money.of(v || '0');
    const sideOk = lines.every(
      (l) =>
        amount(l.debit).isPositive() !== amount(l.credit).isPositive() &&
        !amount(l.debit).isNegative() &&
        !amount(l.credit).isNegative(),
    );
    const debit = Money.sum(lines.map((l) => l.debit || '0'));
    const credit = Money.sum(lines.map((l) => l.credit || '0'));
    if (lines.length < 2 || !sideOk || !debit.equals(credit) || debit.isZero())
      throw new BadRequestException({
        message: MSG.VOUCHER_UNBALANCED,
        details: { debit: debit.toDb(), credit: credit.toDb() },
      });

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
        return !a || a.company_id !== companyId || !a.postable || !a.is_active;
      })
    ) {
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
    }
    // control accounts: only their sub-ledger documents post to them
    if (
      options.manual &&
      ids.some((id) =>
        [
          'payables',
          'employee_advances',
          'receivables',
          'customer_advances',
        ].includes(byId.get(id)!.role ?? ''),
      )
    )
      throw new BadRequestException(MSG.CONTROL_ACCOUNT_MANUAL);
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

    // cash / bank rules by voucher type
    const isMoney = (id: string) =>
      ['cash', 'bank'].includes(byId.get(id)!.role ?? '');
    const ok =
      type === 'payment'
        ? lines.some(
            (l) => amount(l.credit).isPositive() && isMoney(l.accountId),
          )
        : type === 'receipt'
          ? lines.some(
              (l) => amount(l.debit).isPositive() && isMoney(l.accountId),
            )
          : type === 'contra'
            ? lines.every((l) => isMoney(l.accountId))
            : true;
    if (!ok) throw new BadRequestException(MSG.VOUCHER_NEEDS_CASH_OR_BANK);
  }

  /** The fiscal year and period of a date; the period must be open unless it is for a reversal. */
  private async periodFor(companyId: string, date: string, reversal: boolean) {
    const period = await this.db.tx
      .selectFrom('accounting_periods as p')
      .innerJoin('fiscal_years as y', 'y.id', 'p.fiscal_year_id')
      .select(['p.state', 'y.id as fiscal_year_id', 'y.code'])
      .where('p.company_id', '=', companyId)
      .where('p.period', '=', businessDate(date).slice(0, 7))
      .executeTakeFirst();
    if (!period) throw new BadRequestException(MSG.PERIOD_NOT_FOUND);
    if (period.state === 'closed' && !reversal)
      throw new ConflictException(MSG.PERIOD_CLOSED);
    return { fiscalYearId: period.fiscal_year_id, fiscalYearCode: period.code };
  }

  /** Gapless: the counter row is locked until this transaction ends. */
  private async nextNumber(
    companyId: string,
    fiscalYearId: string,
    fiscalYearCode: string,
    type: VoucherType,
  ): Promise<string> {
    const row = await this.db.tx
      .insertInto('voucher_sequences')
      .values({
        company_id: companyId,
        fiscal_year_id: fiscalYearId,
        voucher_type: type,
        last_no: 1,
      })
      .onConflict((oc) =>
        oc
          .columns([
            'tenant_id',
            'company_id',
            'fiscal_year_id',
            'voucher_type',
          ])
          .doUpdateSet({ last_no: sql`voucher_sequences.last_no + 1` }),
      )
      .returning('last_no')
      .executeTakeFirstOrThrow();
    return voucherNumber(type, fiscalYearCode, row.last_no);
  }
}

function totalOf(lines: Array<{ debit?: string | null }>): string {
  return Money.sum(lines.map((l) => l.debit || '0')).toDb();
}

/**
 * Lines on the same account, cost centre and party are added up; a net negative
 * amount moves to the other side; zero lines disappear (automatic postings).
 */
export function mergeLines(lines: PostingLine[]): PostingLine[] {
  const book = new Map<string, { line: PostingLine; amount: Money }>();
  for (const l of lines) {
    const key = [
      l.accountId,
      l.departmentId ?? '',
      l.partyType ?? '',
      l.partyId ?? '',
    ].join('|');
    const signed = Money.of(l.debit || '0').minus(l.credit || '0');
    const entry = book.get(key);
    if (entry) entry.amount = entry.amount.plus(signed);
    else book.set(key, { line: l, amount: signed });
  }
  return [...book.values()]
    .filter((e) => !e.amount.isZero())
    .map(({ line, amount }) => ({
      ...line,
      debit: amount.isPositive() ? amount.toDb() : undefined,
      credit: amount.isNegative() ? amount.negate().toDb() : undefined,
    }));
}

export function toVoucherSummary(v: Voucher) {
  return {
    id: v.id,
    companyId: v.company_id,
    voucherType: v.voucher_type,
    number: v.number,
    voucherDate: v.voucher_date,
    narration: v.narration,
    state: v.state,
    total: v.total,
    sourceType: v.source_type,
    sourceId: v.source_id,
    isOpening: v.is_opening,
    reversalOf: v.reversal_of,
    reversedBy: v.reversed_by,
    reason: v.reason,
    approvalRequestId: v.approval_request_id,
    createdBy: v.created_by,
    createdAt: v.created_at,
    postedAt: v.posted_at,
    version: v.version,
  };
}
