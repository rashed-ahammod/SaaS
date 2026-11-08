/**
 * Expense claims (spec §5 "Expense claim: Dept Head -> Accounts (verify, pay);
 * above threshold -> Admin before payment"; §6.6 "auto-postings: expense claims").
 *
 *   draft        the employee writes it in the app: one line per expense, a photo
 *                or PDF of the receipt per line (needed above the category's limit);
 *                the same receipt file can be in one live claim only
 *   submit       Dept Head, then Accounts verifies (Admin too from Tk 50,000,
 *                illustrative); returned -> draft again; rejected -> receipts free
 *   (approved)   booked on the approval day:
 *                  Dr each line's expense account (cost centre = the employee's department)
 *                  Cr the cash advance it settles (up to what is open on it)
 *                  Cr claims payable to the employee (the rest)
 *                fully covered by the advance -> "settled", nothing to pay
 *   pay          Accounts: a payment voucher (Dr claims payable, Cr cash / bank) to
 *                the checker; bank or wallet only to the employee's approved salary
 *                account; once posted the claim is "paid": once (also the database)
 *
 * Categories (what may be claimed, booked to which account) are per company.
 */
import { createHash, randomUUID } from 'node:crypto';
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
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ApprovalRequest,
  ExpenseClaim,
  Voucher,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import {
  detectFileType,
  FileStorage,
} from '../../platform/storage/file-storage.js';
import { ApprovalHandlers } from '../approvals/approval-handlers.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { conditionalChain, defaultChain, step } from '../approvals/chains.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { AccessService } from '../identity/access/access.service.js';
import {
  VouchersService,
  type PostingLine,
} from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  ClaimLineDto,
  ClaimQueryDto,
  CreateCategoryDto,
  CreateClaimDto,
  PayEmployeeDto,
  UpdateCategoryDto,
  UpdateClaimDto,
} from './dto/expenses.dto.js';
import { ADVANCES, CLAIMS_PAYABLE, ExpensesCommon } from './expenses-common.js';

export const EXPENSE_CLAIM_REQUEST = 'expense_claim';
export const EXPENSE_CLAIM_SOURCE = 'expense_claim';
export const CLAIM_PAYMENT_SOURCE = 'expense_claim_payment';
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Bangladesh defaults; the company can change them (POST .../expense-categories). */
const DEFAULT_CATEGORIES: Array<{
  code: string;
  nameEn: string;
  nameBn: string;
  account: string;
  receiptAbove: string;
}> = [
  {
    code: 'TRAVEL_LOCAL',
    nameEn: 'Local conveyance (rickshaw, CNG, ride-sharing)',
    nameBn: 'স্থানীয় যাতায়াত (রিকশা, সিএনজি, রাইড শেয়ারিং)',
    account: '5250',
    receiptAbove: '500',
  },
  {
    code: 'TRAVEL',
    nameEn: 'Out-of-station travel (bus, train, air)',
    nameBn: 'বাইরে ভ্রমণ (বাস, ট্রেন, বিমান)',
    account: '5250',
    receiptAbove: '0',
  },
  {
    code: 'HOTEL',
    nameEn: 'Hotel and lodging',
    nameBn: 'হোটেল ও থাকা',
    account: '5250',
    receiptAbove: '0',
  },
  {
    code: 'MEALS',
    nameEn: 'Meals and entertainment',
    nameBn: 'খাবার ও আপ্যায়ন',
    account: '5260',
    receiptAbove: '300',
  },
  {
    code: 'MOBILE',
    nameEn: 'Mobile and internet',
    nameBn: 'মোবাইল ও ইন্টারনেট',
    account: '5230',
    receiptAbove: '0',
  },
  {
    code: 'STATIONERY',
    nameEn: 'Stationery and printing',
    nameBn: 'মনিহারি ও মুদ্রণ',
    account: '5240',
    receiptAbove: '0',
  },
  {
    code: 'REPAIRS',
    nameEn: 'Small repairs',
    nameBn: 'ছোটখাটো মেরামত',
    account: '5270',
    receiptAbove: '0',
  },
];

@Injectable()
export class ExpenseClaimsService implements OnModuleInit {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly storage: FileStorage,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly org: OrgLookupService,
    private readonly approvals: ApprovalsService,
    private readonly handlers: ApprovalHandlers,
    private readonly vouchers: VouchersService,
    private readonly common: ExpensesCommon,
  ) {}

  onModuleInit() {
    this.handlers.register(
      EXPENSE_CLAIM_REQUEST,
      {
        onApproved: (r) => this.approved(r),
        onClosed: (r, outcome) => this.closed(r, outcome),
        distinctApprovers: true,
      },
      [
        conditionalChain(
          'Expense claim Tk 50,000 or more (default)',
          { minAmount: '50000' },
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
          step(3, 'role:admin'),
        ),
        defaultChain(
          'Expense claim (default)',
          step(1, 'dept_head'),
          step(2, 'role:accounts'),
        ),
      ],
    );
    // the booking of a claim stays; a paid claim is paid once
    const refuse = async () => {
      throw new ConflictException(MSG.EXPENSE_CLAIM_WRONG_STATE);
    };
    this.vouchers.registerSource(EXPENSE_CLAIM_SOURCE, {
      assertReversible: refuse,
    });
    this.vouchers.registerSource(CLAIM_PAYMENT_SOURCE, {
      onPosted: (v) => this.paid(v),
      onDropped: (v) => this.paymentDropped(v),
      assertReversible: refuse,
    });
  }

  // =========================================================== categories

  async categories(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    // Accounts and auditors, or an employee of the company making a claim
    if (!this.access.allows('expenses.view', { companyId })) {
      const me = await this.common.ownEmployee();
      if (me.company_id !== companyId)
        throw new ForbiddenException(MSG.FORBIDDEN);
    }
    const rows = await this.db.tx
      .selectFrom('expense_categories as c')
      .innerJoin('accounts as a', 'a.id', 'c.account_id')
      .selectAll('c')
      .select(['a.code as account_code', 'a.name_en as account_name'])
      .where('c.company_id', '=', companyId)
      .orderBy('c.code')
      .execute();
    return rows.map((c) => ({
      id: c.id,
      code: c.code,
      nameEn: c.name_en,
      nameBn: c.name_bn,
      accountId: c.account_id,
      accountCode: c.account_code,
      accountName: c.account_name,
      receiptRequiredAbove: c.receipt_required_above,
      isActive: c.is_active,
      version: c.version,
    }));
  }

  /** The Bangladesh default categories (only those missing). */
  async createDefaultCategories(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.pay', { companyId });
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .where('postable', '=', true)
      .execute();
    if (!accounts.length) throw new BadRequestException(MSG.LEDGER_NOT_SET_UP);
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const c of DEFAULT_CATEGORIES) {
      const accountId = byCode.get(c.account);
      if (!accountId) continue;
      await this.db.tx
        .insertInto('expense_categories')
        .values({
          company_id: companyId,
          code: c.code,
          name_en: c.nameEn,
          name_bn: c.nameBn,
          account_id: accountId,
          receipt_required_above: c.receiptAbove,
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'company_id', 'code']).doNothing(),
        )
        .execute();
    }
    await this.audit.record({
      action: 'expense_categories.defaults',
      entity: 'company',
      entityId: companyId,
    });
    return this.categories(companyId);
  }

  async createCategory(companyId: string, dto: CreateCategoryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.pay', { companyId });
    await this.assertExpenseAccount(companyId, dto.accountId);
    const row = await this.db.tx
      .insertInto('expense_categories')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn,
        name_bn: dto.nameBn ?? null,
        account_id: dto.accountId,
        receipt_required_above: dto.receiptRequiredAbove ?? '0',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'expense_category.created',
      entity: 'expense_category',
      entityId: row.id,
      after: dto,
    });
    return (await this.categories(companyId)).find((c) => c.id === row.id);
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const c = await this.db.tx
      .selectFrom('expense_categories')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!c) throw new NotFoundException(MSG.EXPENSE_CATEGORY_NOT_FOUND);
    this.access.assert('expenses.pay', { companyId: c.company_id });
    if (c.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (dto.accountId)
      await this.assertExpenseAccount(c.company_id, dto.accountId);
    await this.db.tx
      .updateTable('expense_categories')
      .set({
        ...(dto.nameEn !== undefined ? { name_en: dto.nameEn } : {}),
        ...(dto.nameBn !== undefined ? { name_bn: dto.nameBn } : {}),
        ...(dto.accountId !== undefined ? { account_id: dto.accountId } : {}),
        ...(dto.receiptRequiredAbove !== undefined
          ? { receipt_required_above: dto.receiptRequiredAbove }
          : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_category.updated',
      entity: 'expense_category',
      entityId: id,
      after: dto,
    });
    return (await this.categories(c.company_id)).find((x) => x.id === id);
  }

  // =========================================================== the employee

  async create(dto: CreateClaimDto) {
    const employee = await this.common.ownEmployee();
    if (dto.advanceId) await this.assertOwnAdvance(employee.id, dto.advanceId);
    const number = await this.common.nextNumber(
      employee.company_id,
      'expense_claim',
      this.common.today(),
    );
    const claim = await this.db.tx
      .insertInto('expense_claims')
      .values({
        company_id: employee.company_id,
        employee_id: employee.id,
        number,
        title: dto.title,
        advance_id: dto.advanceId ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (dto.lines?.length) await this.replaceLines(claim, dto.lines);
    await this.audit.record({
      action: 'expense_claim.created',
      entity: 'expense_claim',
      entityId: claim.id,
      after: { number, title: dto.title },
    });
    return this.get(claim.id);
  }

  async update(id: string, dto: UpdateClaimDto) {
    const claim = await this.ownDraft(id);
    if (claim.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    if (dto.advanceId)
      await this.assertOwnAdvance(claim.employee_id, dto.advanceId);
    if (dto.lines) await this.replaceLines(claim, dto.lines);
    await this.db.tx
      .updateTable('expense_claims')
      .set({
        ...(dto.title ? { title: dto.title } : {}),
        ...(dto.advanceId !== undefined ? { advance_id: dto.advanceId } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_claim.updated',
      entity: 'expense_claim',
      entityId: id,
      after: { title: dto.title, lines: dto.lines?.length },
    });
    return this.get(id);
  }

  /** A receipt (photo or PDF) for the claim; attach it to a line by its id. */
  async uploadReceipt(id: string, file: Express.Multer.File | undefined) {
    const claim = await this.ownDraft(id);
    if (!file) throw new BadRequestException(MSG.FILE_REQUIRED);
    const contentType = detectFileType(file.buffer);
    if (!contentType || file.size > MAX_RECEIPT_BYTES)
      throw new BadRequestException(MSG.FILE_TYPE_NOT_ALLOWED);

    // the same receipt cannot be claimed twice
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const used = await this.db.tx
      .selectFrom('expense_receipts as r')
      .innerJoin('expense_claims as c', 'c.id', 'r.claim_id')
      .select(['r.id', 'r.claim_id', 'c.number'])
      .where('r.company_id', '=', claim.company_id)
      .where('r.sha256', '=', sha256)
      .where('r.status', '=', 'active')
      .executeTakeFirst();
    if (used?.claim_id === claim.id)
      return { id: used.id, duplicateOfThisClaim: true };
    if (used)
      throw new ConflictException({
        message: MSG.RECEIPT_DUPLICATE,
        details: { claimNo: used.number },
      });

    const fileKey = `${requestContext.get().tenantId}/expense-receipts/${randomUUID()}`;
    await this.storage.put(fileKey, file.buffer);
    const receipt = await this.db.tx
      .insertInto('expense_receipts')
      .values({
        company_id: claim.company_id,
        claim_id: claim.id,
        file_key: fileKey,
        file_name: safeFileName(file.originalname),
        content_type: contentType,
        size_bytes: file.size,
        sha256,
      })
      .returning(['id', 'file_name', 'content_type', 'size_bytes'])
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'expense_claim.receipt_uploaded',
      entity: 'expense_claim',
      entityId: claim.id,
      after: { receiptId: receipt.id, fileName: receipt.file_name, sha256 },
    });
    return {
      id: receipt.id,
      fileName: receipt.file_name,
      contentType: receipt.content_type,
      sizeBytes: receipt.size_bytes,
    };
  }

  async receiptFile(claimId: string, receiptId: string) {
    const claim = await this.find(claimId);
    await this.common.assertCanSee(claim.employee_id, claim.company_id);
    const receipt = await this.db.tx
      .selectFrom('expense_receipts')
      .selectAll()
      .where('id', '=', receiptId)
      .where('claim_id', '=', claimId)
      .executeTakeFirst();
    if (!receipt) throw new NotFoundException(MSG.RECEIPT_NOT_FOUND);
    return {
      content: await this.storage.get(receipt.file_key),
      fileName: receipt.file_name,
      contentType: receipt.content_type,
    };
  }

  /** To the Dept Head, then Accounts: lines and receipts are checked, then frozen. */
  async submit(id: string) {
    const claim = await this.ownDraft(id);
    const lines = await this.linesOf(id);
    if (!lines.length) throw new BadRequestException(MSG.EXPENSE_CLAIM_EMPTY);
    const missing = lines
      .filter(
        (l) =>
          !l.receipt_id &&
          Money.of(l.amount).greaterThan(l.receipt_required_above),
      )
      .map((l) => l.line_no);
    if (missing.length)
      throw new BadRequestException({
        message: MSG.RECEIPT_REQUIRED,
        details: { lines: missing },
      });
    if (lines.some((l) => l.expense_date > this.common.today()))
      throw new BadRequestException(MSG.EXPENSE_DATE_FUTURE);
    if (lines.some((l) => !l.is_active))
      throw new BadRequestException(MSG.EXPENSE_CATEGORY_NOT_FOUND);
    if (claim.advance_id)
      await this.assertOwnAdvance(claim.employee_id, claim.advance_id);
    // the booking must be possible when it is approved
    await this.common.postingAccounts(
      claim.company_id,
      [CLAIMS_PAYABLE, ...(claim.advance_id ? [ADVANCES] : [])],
      this.common.today(),
    );

    const employee = await this.employeeAccess.find(claim.employee_id);
    const total = Money.sum(lines.map((l) => l.amount)).toDb();
    const request = await this.approvals.submit({
      requestType: EXPENSE_CLAIM_REQUEST,
      sourceId: id,
      subjectEmployeeId: claim.employee_id,
      companyId: claim.company_id,
      summary: `Expense claim ${claim.number}: ${employee.full_name_en} (${employee.employee_code}), ${claim.title}`,
      amount: total,
      snapshot: {
        number: claim.number,
        title: claim.title,
        total,
        advance: claim.advance_id ? 'settles a cash advance' : null,
        lines: lines
          .map(
            (l) =>
              `${l.expense_date} ${l.category_code} ${l.description}: ${l.amount}${l.receipt_id ? ' (receipt)' : ''}`,
          )
          .join(' | '),
      },
    });
    await this.db.tx
      .updateTable('expense_claims')
      .set({
        state: 'in_approval',
        total,
        approval_request_id: request.id,
        submitted_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_claim.submitted',
      entity: 'expense_claim',
      entityId: id,
      after: { number: claim.number, total, approvalRequestId: request.id },
    });
    return this.get(id);
  }

  async cancel(id: string) {
    const claim = await this.ownDraft(id);
    await this.db.tx
      .updateTable('expense_claims')
      .set({ state: 'cancelled' })
      .where('id', '=', id)
      .execute();
    await this.releaseReceipts(id);
    await this.audit.record({
      action: 'expense_claim.cancelled',
      entity: 'expense_claim',
      entityId: id,
      after: { number: claim.number },
    });
    return this.get(id);
  }

  async listOwn() {
    const employee = await this.common.ownEmployee();
    const rows = await this.db.tx
      .selectFrom('expense_claims')
      .selectAll()
      .where('employee_id', '=', employee.id)
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
    return rows.map(toClaimResponse);
  }

  // ============================================================== Accounts

  async list(companyId: string, query: ClaimQueryDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('expenses.view', { companyId });
    let q = this.db.tx
      .selectFrom('expense_claims as c')
      .innerJoin('employees as e', 'e.id', 'c.employee_id')
      .selectAll('c')
      .select(['e.employee_code', 'e.full_name_en'])
      .where('c.company_id', '=', companyId);
    if (query.state)
      q = q.where('c.state', '=', query.state as ExpenseClaim['state']);
    if (query.employeeId) q = q.where('c.employee_id', '=', query.employeeId);
    const rows = await q.orderBy('c.created_at', 'desc').limit(500).execute();
    return rows.map((r) => ({
      ...toClaimResponse(r),
      employeeCode: r.employee_code,
      employeeName: r.full_name_en,
    }));
  }

  /** Pay an approved claim: a payment voucher to the checker. */
  async pay(id: string, dto: PayEmployeeDto) {
    const claim = await this.find(id);
    this.access.assert('expenses.pay', { companyId: claim.company_id });
    if (claim.state !== 'approved' || claim.payment_voucher_id)
      throw new ConflictException(MSG.EXPENSE_CLAIM_WRONG_STATE);
    const account = await this.common.postingAccounts(
      claim.company_id,
      [CLAIMS_PAYABLE],
      dto.paymentDate,
    );
    const from = await this.common.moneyAccount(
      claim.company_id,
      dto.paidFromAccountId,
    );
    const payee = await this.common.payeeLabel(
      claim.employee_id,
      dto.method,
      dto.reference,
    );
    const employee = await this.employeeAccess.find(claim.employee_id);

    const voucher = await this.vouchers.createLinked({
      companyId: claim.company_id,
      voucherType: 'payment',
      voucherDate: dto.paymentDate,
      narration: `Expense claim ${claim.number}: ${employee.full_name_en} (${employee.employee_code}), ${claim.title}`,
      sourceType: CLAIM_PAYMENT_SOURCE,
      sourceId: claim.id,
      lines: [
        {
          accountId: account(CLAIMS_PAYABLE),
          debit: claim.payable,
          partyType: 'employee',
          partyId: claim.employee_id,
        },
        { accountId: from, credit: claim.payable, narration: payee },
      ],
    });
    await this.db.tx
      .updateTable('expense_claims')
      .set({ payment_voucher_id: voucher.id })
      .where('id', '=', id)
      .execute();
    await this.audit.record({
      action: 'expense_claim.payment_created',
      entity: 'expense_claim',
      entityId: id,
      after: {
        number: claim.number,
        amount: claim.payable,
        method: dto.method,
        voucher: voucher.number,
      },
    });
    return this.get(id);
  }

  // ===================================================================== read

  async get(id: string) {
    const claim = await this.find(id);
    await this.common.assertCanSee(claim.employee_id, claim.company_id);
    const employee = await this.employeeAccess.find(claim.employee_id);
    const lines = await this.linesOf(id);
    const receipts = await this.db.tx
      .selectFrom('expense_receipts')
      .select(['id', 'file_name', 'content_type', 'size_bytes', 'status'])
      .where('claim_id', '=', id)
      .orderBy('created_at')
      .execute();
    const voucherIds = [
      claim.posting_voucher_id,
      claim.payment_voucher_id,
    ].filter((v): v is string => !!v);
    const vouchers = voucherIds.length
      ? await this.db.tx
          .selectFrom('vouchers')
          .select(['id', 'number', 'state', 'approval_request_id'])
          .where('id', 'in', voucherIds)
          .execute()
      : [];
    const byId = new Map(vouchers.map((v) => [v.id, v]));
    const payment = claim.payment_voucher_id
      ? byId.get(claim.payment_voucher_id)
      : undefined;
    return {
      ...toClaimResponse(claim),
      employee: {
        id: employee.id,
        code: employee.employee_code,
        name: employee.full_name_en,
      },
      lines: lines.map((l) => ({
        lineNo: l.line_no,
        expenseDate: l.expense_date,
        categoryId: l.category_id,
        categoryCode: l.category_code,
        categoryName: l.category_name,
        description: l.description,
        amount: l.amount,
        receiptId: l.receipt_id,
        receiptNeeded: Money.of(l.amount).greaterThan(l.receipt_required_above),
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        contentType: r.content_type,
        sizeBytes: r.size_bytes,
        status: r.status,
      })),
      postingVoucherNumber: claim.posting_voucher_id
        ? (byId.get(claim.posting_voucher_id)?.number ?? null)
        : null,
      payment: payment
        ? {
            voucherId: payment.id,
            number: payment.number,
            state: payment.state,
            approvalRequestId: payment.approval_request_id,
          }
        : null,
    };
  }

  async find(id: string): Promise<ExpenseClaim> {
    const claim = await this.db.tx
      .selectFrom('expense_claims')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!claim) throw new NotFoundException(MSG.EXPENSE_CLAIM_NOT_FOUND);
    return claim;
  }

  // ========================================================= approval hooks

  /** Approved: booked; settled against the advance first, the rest is owed to the employee. */
  private async approved(request: ApprovalRequest) {
    const claim = await this.find(request.source_id);
    const lines = await this.linesOf(claim.id);
    const total = Money.sum(lines.map((l) => l.amount));
    const today = this.common.today();
    const account = await this.common.postingAccounts(
      claim.company_id,
      [CLAIMS_PAYABLE, ...(claim.advance_id ? [ADVANCES] : [])],
      today,
    );

    // what is still open on the advance (rows locked)
    let applied = Money.zero();
    if (claim.advance_id) {
      const advance = await this.db.tx
        .selectFrom('expense_advances')
        .selectAll()
        .where('id', '=', claim.advance_id)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (advance.state === 'paid') {
        const back = await this.settledOn(advance.id);
        const open = Money.of(advance.amount).minus(back);
        applied = total.lessThan(open) ? total : open;
      }
    }
    const payable = total.minus(applied);

    const employee = await this.employeeAccess.find(claim.employee_id);
    const departmentId = await this.common.departmentOf(employee);
    const party = {
      partyType: 'employee' as const,
      partyId: claim.employee_id,
    };
    const posting: PostingLine[] = [
      ...lines.map((l) => ({
        accountId: l.account_id,
        departmentId,
        debit: Money.of(l.amount).toDb(),
        narration: `${l.category_code}: ${l.description}`,
      })),
      ...(applied.isPositive()
        ? [{ accountId: account(ADVANCES), credit: applied.toDb(), ...party }]
        : []),
      ...(payable.isPositive()
        ? [
            {
              accountId: account(CLAIMS_PAYABLE),
              credit: payable.toDb(),
              ...party,
            },
          ]
        : []),
    ];
    const voucher = await this.vouchers.postAutomatic({
      companyId: claim.company_id,
      voucherType: 'journal',
      voucherDate: today,
      narration: `Expense claim ${claim.number}: ${employee.full_name_en} (${employee.employee_code}), ${claim.title}`,
      sourceType: EXPENSE_CLAIM_SOURCE,
      sourceId: claim.id,
      lines: posting,
    });
    await this.db.tx
      .updateTable('expense_claims')
      .set({
        state: payable.isPositive() ? 'approved' : 'settled',
        total: total.toDb(),
        advance_applied: applied.toDb(),
        payable: payable.toDb(),
        posting_voucher_id: voucher.id,
      })
      .where('id', '=', claim.id)
      .execute();
    if (applied.isPositive()) {
      await this.db.tx
        .insertInto('advance_settlements')
        .values({
          advance_id: claim.advance_id!,
          kind: 'claim',
          claim_id: claim.id,
          amount: applied.toDb(),
        })
        .execute();
      await this.closeAdvanceIfSettled(claim.advance_id!);
    }
    await this.audit.record({
      action: 'expense_claim.approved',
      entity: 'expense_claim',
      entityId: claim.id,
      after: {
        number: claim.number,
        total: total.toDb(),
        advanceApplied: applied.toDb(),
        payable: payable.toDb(),
        voucher: voucher.number,
      },
    });
  }

  private async closed(
    request: ApprovalRequest,
    outcome: 'rejected' | 'returned' | 'cancelled',
  ) {
    const claim = await this.find(request.source_id);
    if (outcome === 'returned') {
      await this.db.tx
        .updateTable('expense_claims')
        .set({ state: 'draft', approval_request_id: null })
        .where('id', '=', claim.id)
        .execute();
    } else {
      await this.db.tx
        .updateTable('expense_claims')
        .set({ state: outcome === 'rejected' ? 'rejected' : 'cancelled' })
        .where('id', '=', claim.id)
        .execute();
      await this.releaseReceipts(claim.id);
    }
    await this.audit.record({
      action: `expense_claim.${outcome}`,
      entity: 'expense_claim',
      entityId: claim.id,
      after: { number: claim.number },
    });
  }

  private async paid(voucher: Voucher) {
    await this.db.tx
      .updateTable('expense_claims')
      .set({ state: 'paid', paid_at: new Date() })
      .where('id', '=', voucher.source_id!)
      .execute();
    await this.audit.record({
      action: 'expense_claim.paid',
      entity: 'expense_claim',
      entityId: voucher.source_id!,
      after: { voucher: voucher.number },
    });
  }

  private async paymentDropped(voucher: Voucher) {
    await this.db.tx
      .updateTable('expense_claims')
      .set({ payment_voucher_id: null })
      .where('id', '=', voucher.source_id!)
      .where('state', '=', 'approved')
      .execute();
  }

  // ================================================================ helpers

  private async ownDraft(id: string): Promise<ExpenseClaim> {
    const claim = await this.find(id);
    const employee = await this.common.ownEmployee();
    if (claim.employee_id !== employee.id)
      throw new NotFoundException(MSG.EXPENSE_CLAIM_NOT_FOUND);
    if (claim.state !== 'draft')
      throw new ConflictException(MSG.EXPENSE_CLAIM_WRONG_STATE);
    return claim;
  }

  /** Lines: active categories of the company, receipts of this claim, amounts. */
  private async replaceLines(claim: ExpenseClaim, lines: ClaimLineDto[]) {
    const categoryIds = [...new Set(lines.map((l) => l.categoryId))];
    if (categoryIds.length) {
      const found = await this.db.tx
        .selectFrom('expense_categories')
        .select('id')
        .where('company_id', '=', claim.company_id)
        .where('is_active', '=', true)
        .where('id', 'in', categoryIds)
        .execute();
      if (found.length !== categoryIds.length)
        throw new BadRequestException(MSG.EXPENSE_CATEGORY_NOT_FOUND);
    }
    const receiptIds = lines
      .map((l) => l.receiptId)
      .filter((r): r is string => !!r);
    if (new Set(receiptIds).size !== receiptIds.length)
      throw new BadRequestException(MSG.RECEIPT_DUPLICATE);
    if (receiptIds.length) {
      const found = await this.db.tx
        .selectFrom('expense_receipts')
        .select('id')
        .where('claim_id', '=', claim.id)
        .where('status', '=', 'active')
        .where('id', 'in', receiptIds)
        .execute();
      if (found.length !== receiptIds.length)
        throw new BadRequestException(MSG.RECEIPT_NOT_FOUND);
    }
    if (lines.some((l) => l.expenseDate > this.common.today()))
      throw new BadRequestException(MSG.EXPENSE_DATE_FUTURE);

    await this.db.tx
      .deleteFrom('expense_claim_lines')
      .where('claim_id', '=', claim.id)
      .execute();
    if (lines.length) {
      await this.db.tx
        .insertInto('expense_claim_lines')
        .values(
          lines.map((l, i) => ({
            claim_id: claim.id,
            line_no: i + 1,
            expense_date: l.expenseDate,
            category_id: l.categoryId,
            description: l.description,
            amount: Money.of(l.amount).toDb(),
            receipt_id: l.receiptId ?? null,
          })),
        )
        .execute();
    }
    await this.db.tx
      .updateTable('expense_claims')
      .set({ total: Money.sum(lines.map((l) => l.amount)).toDb() })
      .where('id', '=', claim.id)
      .execute();
  }

  private linesOf(claimId: string) {
    return this.db.tx
      .selectFrom('expense_claim_lines as l')
      .innerJoin('expense_categories as c', 'c.id', 'l.category_id')
      .select([
        'l.line_no',
        'l.expense_date',
        'l.category_id',
        'l.description',
        'l.amount',
        'l.receipt_id',
        'c.code as category_code',
        'c.name_en as category_name',
        'c.account_id',
        'c.receipt_required_above',
        'c.is_active',
      ])
      .where('l.claim_id', '=', claimId)
      .orderBy('l.line_no')
      .execute();
  }

  private async releaseReceipts(claimId: string) {
    await this.db.tx
      .updateTable('expense_receipts')
      .set({ status: 'released' })
      .where('claim_id', '=', claimId)
      .execute();
  }

  private async assertOwnAdvance(employeeId: string, advanceId: string) {
    const advance = await this.db.tx
      .selectFrom('expense_advances')
      .select(['employee_id', 'state'])
      .where('id', '=', advanceId)
      .executeTakeFirst();
    if (!advance || advance.employee_id !== employeeId)
      throw new NotFoundException(MSG.ADVANCE_NOT_FOUND);
    if (advance.state !== 'paid')
      throw new ConflictException(MSG.ADVANCE_WRONG_STATE);
  }

  private async assertExpenseAccount(companyId: string, accountId: string) {
    const a = await this.db.tx
      .selectFrom('accounts')
      .select(['company_id', 'postable', 'is_active', 'role'])
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (
      !a ||
      a.company_id !== companyId ||
      !a.postable ||
      !a.is_active ||
      a.role
    )
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
  }

  /** Settlements counted against an advance (refunds waiting for their voucher too). */
  private async settledOn(advanceId: string): Promise<Money> {
    const row = await this.db.tx
      .selectFrom('advance_settlements')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('n'))
      .where('advance_id', '=', advanceId)
      .where('state', 'in', ['pending', 'done'])
      .executeTakeFirstOrThrow();
    return Money.of(row.n);
  }

  private async closeAdvanceIfSettled(advanceId: string) {
    const advance = await this.db.tx
      .selectFrom('expense_advances')
      .select(['amount'])
      .where('id', '=', advanceId)
      .executeTakeFirstOrThrow();
    const done = await this.db.tx
      .selectFrom('advance_settlements')
      .select(sql<string>`coalesce(sum(amount), 0)`.as('n'))
      .where('advance_id', '=', advanceId)
      .where('state', '=', 'done')
      .executeTakeFirstOrThrow();
    if (Money.of(done.n).equals(advance.amount))
      await this.db.tx
        .updateTable('expense_advances')
        .set({ state: 'settled' })
        .where('id', '=', advanceId)
        .execute();
  }
}

export function toClaimResponse(c: ExpenseClaim) {
  return {
    id: c.id,
    companyId: c.company_id,
    employeeId: c.employee_id,
    number: c.number,
    title: c.title,
    advanceId: c.advance_id,
    total: c.total,
    advanceApplied: c.advance_applied,
    payable: c.payable,
    state: c.state,
    approvalRequestId: c.approval_request_id,
    postingVoucherId: c.posting_voucher_id,
    paymentVoucherId: c.payment_voucher_id,
    submittedAt: c.submitted_at,
    paidAt: c.paid_at,
    createdAt: c.created_at,
    version: c.version,
  };
}

function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 150) || 'file';
}
