/**
 * Bank reconciliation (WP20): the company's bank accounts, their statements, matching
 * statement lines to the posted ledger lines of the same account, and the reconciliation.
 *
 *   listAccounts / createAccount / updateAccount / getAccount
 *   importStatement(id, file, source)  parse (statement-formats.ts); refuse a bad or
 *                       repeated file; skip lines before the start and lines already
 *                       imported from an overlapping file; then auto-match
 *   statementLines / ledgerLines       with their match, filtered by state and dates
 *   autoMatch(id)       the pairs matching.ts calls safe (kind auto)
 *   match / undo        by a person: any number of lines on each side, equal totals;
 *                       undone with a reason, never deleted
 *   options(lineId)     what the bank line could be (single lines and pairs), for a
 *                       person or the AI (BankAiService) to choose from
 *   recordLine(lineId)  a draft voucher for a charge or interest the books lack
 *   reconciliation(id, asOf)
 *       bank balance    = opening bank balance + statement lines up to asOf
 *       + ledger lines not yet cleared by the bank (deposits in transit, cheques not presented)
 *       - statement lines not yet in the books (charges, interest, direct credits)
 *       = adjusted bank balance, which must equal the ledger balance; the difference is
 *         shown, never forced (non-zero = the opening balance or a line is wrong)
 *       A line is cleared at asOf when it is in an active match whose every line is
 *       dated on or before asOf. Ledger lines before the start count only when matched
 *       (an old cheque presented after the start).
 *   runScheduled()      the worker: auto-match every active account
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  businessDate,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { CompanyBankAccount } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { VouchersService } from '../ledger/vouchers.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  BankAccountDto,
  LinesQueryDto,
  MatchDto,
  RecordLineDto,
  UpdateBankAccountDto,
} from './dto/bank.dto.js';
import {
  autoMatch,
  DAYS_AFTER,
  options,
  type BankLine,
  type LedgerLine,
} from './matching.js';
import { parseStatement } from './statement-formats.js';

export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;

type StatementRow = BankLine & {
  lineNo: number;
  statementId: string;
  valueDate: string | null;
  balance: string | null;
  matchId: string | null;
};
type LedgerRow = LedgerLine & {
  voucherId: string;
  voucherType: string;
  matchId: string | null;
};

@Injectable()
export class BankService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly vouchers: VouchersService,
  ) {}

  private today() {
    return todayInDhaka(this.clock.now());
  }

  // ================================================================ accounts

  async listAccounts(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('bank.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('company_bank_accounts as b')
      .innerJoin('accounts as a', 'a.id', 'b.account_id')
      .selectAll('b')
      .select(['a.code as account_code', 'a.name_en as account_name_en'])
      .select((eb) => [
        eb
          .selectFrom('bank_statement_lines as s')
          .select(sql<string | null>`max(s.txn_date)::text`.as('d'))
          .whereRef('s.bank_account_id', '=', 'b.id')
          .as('last_statement_date'),
        eb
          .selectFrom('bank_statement_lines as s')
          .select(sql<number>`count(*)::int`.as('n'))
          .whereRef('s.bank_account_id', '=', 'b.id')
          .where(({ not, exists, selectFrom }) =>
            not(
              exists(
                selectFrom('bank_match_items as i')
                  .select('i.id')
                  .whereRef('i.statement_line_id', '=', 's.id')
                  .where('i.active', '=', true),
              ),
            ),
          )
          .as('unmatched_statement_lines'),
      ])
      .where('b.company_id', '=', companyId)
      .orderBy('b.bank_name')
      .execute();
    return Promise.all(
      rows.map(async (b) => ({
        ...this.toAccount(b),
        accountCode: b.account_code,
        accountNameEn: b.account_name_en,
        ledgerBalance: await this.ledgerBalance(b.account_id, this.today()),
        lastStatementDate: b.last_statement_date,
        unmatchedStatementLines: b.unmatched_statement_lines ?? 0,
      })),
    );
  }

  async getAccount(id: string) {
    const b = await this.findAccount(id);
    this.access.assert('bank.view', { companyId: b.company_id });
    const ledger = await this.db.tx
      .selectFrom('accounts')
      .select(['code', 'name_en'])
      .where('id', '=', b.account_id)
      .executeTakeFirstOrThrow();
    const statements = await this.db.tx
      .selectFrom('bank_statements')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('bank_account_id', '=', id)
      .executeTakeFirstOrThrow();
    return {
      ...this.toAccount(b),
      accountCode: ledger.code,
      accountNameEn: ledger.name_en,
      statements: statements.n,
      ledgerBalance: await this.ledgerBalance(b.account_id, this.today()),
    };
  }

  async createAccount(companyId: string, dto: BankAccountDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('bank.reconcile', { companyId });
    await this.assertBankLedgerAccount(companyId, dto.accountId);
    const row = await this.db.tx
      .insertInto('company_bank_accounts')
      .values({
        company_id: companyId,
        account_id: dto.accountId,
        bank_name: dto.bankName,
        branch: dto.branch ?? null,
        account_name: dto.accountName,
        account_no: dto.accountNo,
        statement_format: dto.statementFormat,
        reconcile_from: dto.reconcileFrom,
        opening_bank_balance: Money.of(dto.openingBankBalance).toDb(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'bank_account.created',
      entity: 'company_bank_account',
      entityId: row.id,
      after: {
        bank: dto.bankName,
        accountNo: dto.accountNo,
        reconcileFrom: dto.reconcileFrom,
        openingBankBalance: row.opening_bank_balance,
      },
    });
    return this.getAccount(row.id);
  }

  async updateAccount(id: string, dto: UpdateBankAccountDto) {
    const b = await this.findAccount(id);
    this.access.assert('bank.reconcile', { companyId: b.company_id });
    if (b.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    const startChanges =
      (dto.reconcileFrom !== undefined &&
        dto.reconcileFrom !== b.reconcile_from) ||
      (dto.openingBankBalance !== undefined &&
        !Money.of(dto.openingBankBalance).equals(b.opening_bank_balance));
    if (startChanges) {
      const any = await this.db.tx
        .selectFrom('bank_statements')
        .select('id')
        .where('bank_account_id', '=', id)
        .executeTakeFirst();
      if (any) throw new ConflictException(MSG.BANK_ACCOUNT_HAS_STATEMENTS);
    }
    const row = await this.db.tx
      .updateTable('company_bank_accounts')
      .set({
        ...(dto.bankName !== undefined ? { bank_name: dto.bankName } : {}),
        ...(dto.branch !== undefined ? { branch: dto.branch || null } : {}),
        ...(dto.accountName !== undefined
          ? { account_name: dto.accountName }
          : {}),
        ...(dto.statementFormat !== undefined
          ? { statement_format: dto.statementFormat }
          : {}),
        ...(dto.reconcileFrom !== undefined
          ? { reconcile_from: dto.reconcileFrom }
          : {}),
        ...(dto.openingBankBalance !== undefined
          ? { opening_bank_balance: Money.of(dto.openingBankBalance).toDb() }
          : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        version: b.version + 1,
      })
      .where('id', '=', id)
      .where('version', '=', dto.version)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new ConflictException(MSG.STALE_VERSION);
    await this.audit.record({
      action: 'bank_account.updated',
      entity: 'company_bank_account',
      entityId: id,
      before: this.toAccount(b),
      after: this.toAccount(row),
    });
    return this.getAccount(id);
  }

  // ================================================================ statements

  /** A CSV uploaded in the portal. */
  async importUpload(id: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer?.length || file.size > MAX_STATEMENT_BYTES)
      throw new BadRequestException(MSG.BANK_FILE_MISSING);
    return this.importStatement(
      id,
      { name: file.originalname, content: file.buffer.toString('utf8') },
      'upload',
    );
  }

  async importStatement(
    id: string,
    file: { name: string; content: string },
    source: 'upload' | 'n8n',
  ) {
    const b = await this.findAccount(id);
    this.access.assert(source === 'n8n' ? 'bank.import' : 'bank.reconcile', {
      companyId: b.company_id,
    });
    if (!b.is_active)
      throw new BadRequestException(MSG.COMPANY_BANK_ACCOUNT_NOT_FOUND);
    const sha256 = createHash('sha256')
      .update(file.content, 'utf8')
      .digest('hex');
    const repeated = await this.db.tx
      .selectFrom('bank_statements')
      .select('id')
      .where('bank_account_id', '=', id)
      .where('file_sha256', '=', sha256)
      .executeTakeFirst();
    if (repeated)
      throw new ConflictException({
        message: MSG.BANK_STATEMENT_DUPLICATE,
        details: { statementId: repeated.id },
      });

    const parsed = parseStatement(b.statement_format, file.content);
    if (parsed.problems.length)
      throw new BadRequestException({
        message: MSG.BANK_STATEMENT_INVALID,
        details: { problems: parsed.problems.slice(0, 20) },
      });

    // before the start, or already imported from an overlapping file
    const inRange = parsed.lines.filter((l) => l.txnDate >= b.reconcile_from);
    const known = inRange.length
      ? new Set(
          (
            await this.db.tx
              .selectFrom('bank_statement_lines')
              .select('line_key')
              .where('bank_account_id', '=', id)
              .where(
                'line_key',
                'in',
                inRange.map((l) => l.key),
              )
              .execute()
          ).map((r) => r.line_key),
        )
      : new Set<string>();
    const fresh = inRange.filter((l) => !known.has(l.key));

    const statement = await this.db.tx
      .insertInto('bank_statements')
      .values({
        bank_account_id: id,
        source,
        file_name: file.name,
        file_sha256: sha256,
        period_from: parsed.periodFrom!,
        period_to: parsed.periodTo!,
        opening_balance: parsed.openingBalance,
        closing_balance: parsed.closingBalance,
        lines_imported: fresh.length,
        lines_skipped: parsed.lines.length - fresh.length,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (fresh.length) {
      await this.db.tx
        .insertInto('bank_statement_lines')
        .values(
          fresh.map((l, i) => ({
            bank_account_id: id,
            statement_id: statement.id,
            line_no: i + 1,
            txn_date: l.txnDate,
            value_date: l.valueDate,
            description: l.description,
            reference: l.reference,
            amount: l.amount,
            balance: l.balance,
            line_key: l.key,
          })),
        )
        .execute();
    }
    await this.audit.record({
      action: 'bank_statement.imported',
      entity: 'bank_statement',
      entityId: statement.id,
      after: {
        file: file.name,
        source,
        from: statement.period_from,
        to: statement.period_to,
        imported: fresh.length,
        skipped: statement.lines_skipped,
      },
    });
    const autoMatched = await this.matchAutomatically(b);
    return {
      statement: this.toStatement(statement),
      imported: fresh.length,
      skipped: statement.lines_skipped,
      autoMatched,
    };
  }

  async listStatements(id: string) {
    const b = await this.findAccount(id);
    this.access.assert('bank.view', { companyId: b.company_id });
    const rows = await this.db.tx
      .selectFrom('bank_statements')
      .selectAll()
      .where('bank_account_id', '=', id)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((s) => this.toStatement(s));
  }

  // ================================================================ lines

  async statementLines(id: string, query: LinesQueryDto) {
    const b = await this.findAccount(id);
    this.access.assert('bank.view', { companyId: b.company_id });
    return this.loadStatementLines(id, query);
  }

  async ledgerLines(id: string, query: LinesQueryDto) {
    const b = await this.findAccount(id);
    this.access.assert('bank.view', { companyId: b.company_id });
    // unmatched lines from a month before the start (old cheques presented after it)
    return this.loadLedgerLines(b, {
      ...query,
      from:
        query.from ??
        (query.state === 'unmatched'
          ? addDays(businessDate(b.reconcile_from), -DAYS_AFTER)
          : undefined),
    });
  }

  // ================================================================ matching

  async autoMatch(id: string) {
    const b = await this.findAccount(id);
    this.access.assert('bank.reconcile', { companyId: b.company_id });
    return { matched: await this.matchAutomatically(b) };
  }

  async match(id: string, dto: MatchDto) {
    const b = await this.findAccount(id);
    this.access.assert('bank.reconcile', { companyId: b.company_id });
    const statementIds = [...new Set(dto.statementLineIds)];
    const ledgerIds = [...new Set(dto.ledgerLineIds)];
    const bankLines = await this.loadStatementLines(
      id,
      { state: 'all' },
      statementIds,
    );
    const ledger = await this.loadLedgerLines(b, { state: 'all' }, ledgerIds);
    if (
      bankLines.length !== statementIds.length ||
      ledger.length !== ledgerIds.length
    )
      throw new NotFoundException(MSG.BANK_LINE_NOT_FOUND);
    if ([...bankLines, ...ledger].some((l) => l.matchId))
      throw new ConflictException(MSG.BANK_LINE_ALREADY_MATCHED);
    if (
      !Money.sum(bankLines.map((l) => l.amount)).equals(
        Money.sum(ledger.map((l) => l.amount)),
      )
    )
      throw new BadRequestException(MSG.BANK_MATCH_UNBALANCED);
    const matchId = await this.insertMatch(
      b,
      dto.fromSuggestion ? 'suggestion' : 'manual',
      bankLines,
      ledger,
      dto.note ?? null,
    );
    await this.audit.record({
      action: 'bank_match.created',
      entity: 'bank_match',
      entityId: matchId,
      after: {
        kind: dto.fromSuggestion ? 'suggestion' : 'manual',
        statementLines: statementIds,
        ledgerLines: ledgerIds,
        note: dto.note,
      },
    });
    return this.getMatch(matchId);
  }

  async undo(matchId: string, reason: string) {
    const m = await this.db.tx
      .selectFrom('bank_matches')
      .selectAll()
      .where('id', '=', matchId)
      .executeTakeFirst();
    if (!m) throw new NotFoundException(MSG.BANK_MATCH_NOT_FOUND);
    const b = await this.findAccount(m.bank_account_id);
    this.access.assert('bank.reconcile', { companyId: b.company_id });
    if (m.undone_at) throw new ConflictException(MSG.BANK_MATCH_UNDONE);
    await this.db.tx
      .updateTable('bank_matches')
      .set({
        undone_at: this.clock.now(),
        undone_by: this.access.current().userId ?? null,
        undo_reason: reason,
      })
      .where('id', '=', matchId)
      .execute();
    await this.audit.record({
      action: 'bank_match.undone',
      entity: 'bank_match',
      entityId: matchId,
      after: { reason },
    });
    return this.getMatch(matchId);
  }

  async getMatch(matchId: string) {
    const m = await this.db.tx
      .selectFrom('bank_matches')
      .selectAll()
      .where('id', '=', matchId)
      .executeTakeFirst();
    if (!m) throw new NotFoundException(MSG.BANK_MATCH_NOT_FOUND);
    const b = await this.findAccount(m.bank_account_id);
    this.access.assert('bank.view', { companyId: b.company_id });
    const items = await this.db.tx
      .selectFrom('bank_match_items')
      .select(['statement_line_id', 'voucher_line_id', 'amount'])
      .where('match_id', '=', matchId)
      .execute();
    return {
      id: m.id,
      bankAccountId: m.bank_account_id,
      kind: m.kind,
      note: m.note,
      matchedAt: m.matched_at,
      undoneAt: m.undone_at,
      undoReason: m.undo_reason,
      statementLineIds: items
        .filter((i) => i.statement_line_id)
        .map((i) => i.statement_line_id!),
      ledgerLineIds: items
        .filter((i) => i.voucher_line_id)
        .map((i) => i.voucher_line_id!),
      total: Money.sum(
        items.filter((i) => i.statement_line_id).map((i) => i.amount),
      ).toDb(),
    };
  }

  /** What an unmatched statement line could be: single ledger lines and pairs, best first. */
  async options(statementLineId: string) {
    const { b, line } = await this.statementLine(statementLineId);
    this.access.assert('bank.view', { companyId: b.company_id });
    const ledger = await this.loadLedgerLines(b, {
      state: 'unmatched',
      from: addDays(businessDate(line.date), -DAYS_AFTER),
      to: addDays(businessDate(line.date), DAYS_AFTER),
    });
    const byId = new Map(ledger.map((l) => [l.id, l]));
    return {
      line: this.publicStatementLine(line),
      options: line.matchId
        ? []
        : options(line, ledger).map((o) => ({
            ...o,
            lines: o.ledgerLineIds.map((lid) =>
              this.publicLedgerLine(byId.get(lid)!),
            ),
          })),
    };
  }

  /** A draft voucher (payment or receipt) for a bank line the books do not have yet. */
  async recordLine(statementLineId: string, dto: RecordLineDto) {
    const { b, line } = await this.statementLine(statementLineId);
    this.access.assert('bank.reconcile', { companyId: b.company_id });
    if (line.matchId) throw new ConflictException(MSG.BANK_LINE_NOT_UNRECORDED);
    const amount = Money.of(line.amount);
    const value = (amount.isNegative() ? amount.negate() : amount).toDb();
    const reference = [line.description, line.reference]
      .filter(Boolean)
      .join(' / ');
    return this.vouchers.create(b.company_id, {
      voucherType: amount.isNegative() ? 'payment' : 'receipt',
      voucherDate: line.date,
      narration: `${dto.narration} (bank: ${reference})`.slice(0, 500),
      lines: amount.isNegative()
        ? [
            {
              accountId: dto.accountId,
              departmentId: dto.departmentId,
              debit: value,
            },
            {
              accountId: b.account_id,
              credit: value,
              narration: reference.slice(0, 200),
            },
          ]
        : [
            {
              accountId: b.account_id,
              debit: value,
              narration: reference.slice(0, 200),
            },
            {
              accountId: dto.accountId,
              departmentId: dto.departmentId,
              credit: value,
            },
          ],
    });
  }

  // ================================================================ reconciliation

  async reconciliation(id: string, asOf?: string) {
    const b = await this.findAccount(id);
    this.access.assert('bank.view', { companyId: b.company_id });
    const date = asOf ?? this.today();

    // matches not complete by the date: their lines are still open at the date
    const late = await this.db.tx
      .selectFrom('bank_match_items as i')
      .leftJoin('bank_statement_lines as s', 's.id', 'i.statement_line_id')
      .leftJoin('voucher_lines as vl', 'vl.id', 'i.voucher_line_id')
      .leftJoin('vouchers as v', 'v.id', 'vl.voucher_id')
      .select('i.match_id')
      .where('i.bank_account_id', '=', id)
      .where('i.active', '=', true)
      .groupBy('i.match_id')
      .having(
        sql<boolean>`max(coalesce(s.txn_date, v.voucher_date)) > ${date}::date`,
      )
      .execute();
    const lateIds = new Set(late.map((m) => m.match_id));
    const open = <T extends { matchId: string | null }>(l: T) =>
      !l.matchId || lateIds.has(l.matchId);

    const statementLines = (
      await this.loadStatementLines(id, { state: 'all', to: date })
    ).filter(open);
    const ledgerLines = (
      await this.loadLedgerLines(b, { state: 'all', to: date })
    ).filter((l) => open(l) && (l.date >= b.reconcile_from || l.matchId));

    const statementSum = await this.db.tx
      .selectFrom('bank_statement_lines')
      .select(sql<string>`coalesce(sum(amount), 0)::text`.as('s'))
      .where('bank_account_id', '=', id)
      .where('txn_date', '<=', date)
      .executeTakeFirstOrThrow();
    // the opening balance is the bank's at the end of the day before the start
    const bankBalance =
      date < addDays(businessDate(b.reconcile_from), -1)
        ? null
        : Money.of(b.opening_bank_balance).plus(statementSum.s);
    const ledgerBalance = Money.of(
      await this.ledgerBalance(b.account_id, date),
    );
    // the bank's own balance on its last line up to the date, as a cross-check
    const lastLine = await this.db.tx
      .selectFrom('bank_statement_lines')
      .select(['balance', 'txn_date'])
      .where('bank_account_id', '=', id)
      .where('txn_date', '<=', date)
      .where('balance', 'is not', null)
      .orderBy('txn_date', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('line_no', 'desc')
      .limit(1)
      .executeTakeFirst();

    const sum = (rows: Array<{ amount: string }>) =>
      Money.sum(rows.map((r) => r.amount));
    const depositsInTransit = ledgerLines.filter((l) =>
      Money.of(l.amount).isPositive(),
    );
    const unpresentedPayments = ledgerLines.filter((l) =>
      Money.of(l.amount).isNegative(),
    );
    const bankCredits = statementLines.filter((l) =>
      Money.of(l.amount).isPositive(),
    );
    const bankDebits = statementLines.filter((l) =>
      Money.of(l.amount).isNegative(),
    );
    const adjusted =
      bankBalance?.plus(sum(ledgerLines)).minus(sum(statementLines)) ?? null;
    return {
      bankAccountId: id,
      asOf: date,
      reconcileFrom: b.reconcile_from,
      ledgerBalance: ledgerBalance.toDb(),
      bankBalance: bankBalance?.toDb() ?? null,
      lastStatementDate: lastLine?.txn_date ?? null,
      statementShowsBalance: lastLine?.balance ?? null,
      // the bank's balance column agrees with our running total (a missing statement shows here)
      statementAgrees:
        lastLine && bankBalance
          ? Money.of(lastLine.balance!).equals(
              Money.of(b.opening_bank_balance).plus(
                await this.statementSumTo(id, lastLine.txn_date),
              ),
            )
          : null,
      depositsInTransit: {
        total: sum(depositsInTransit).toDb(),
        lines: depositsInTransit.map((l) => this.publicLedgerLine(l)),
      },
      unpresentedPayments: {
        total: sum(unpresentedPayments).toDb(),
        lines: unpresentedPayments.map((l) => this.publicLedgerLine(l)),
      },
      bankCreditsNotInBooks: {
        total: sum(bankCredits).toDb(),
        lines: bankCredits.map((l) => this.publicStatementLine(l)),
      },
      bankDebitsNotInBooks: {
        total: sum(bankDebits).toDb(),
        lines: bankDebits.map((l) => this.publicStatementLine(l)),
      },
      adjustedBankBalance: adjusted?.toDb() ?? null,
      difference: adjusted ? ledgerBalance.minus(adjusted).toDb() : null,
      reconciled: adjusted ? ledgerBalance.equals(adjusted) : false,
    };
  }

  /** The worker: auto-match every active bank account of the tenant. */
  async runScheduled(): Promise<number> {
    const accounts = await this.db.tx
      .selectFrom('company_bank_accounts')
      .selectAll()
      .where('is_active', '=', true)
      .execute();
    let matched = 0;
    for (const b of accounts) matched += await this.matchAutomatically(b);
    return matched;
  }

  // ================================================================ internals

  private async matchAutomatically(b: CompanyBankAccount): Promise<number> {
    const bankLines = await this.loadStatementLines(b.id, {
      state: 'unmatched',
    });
    if (!bankLines.length) return 0;
    const ledger = await this.loadLedgerLines(b, {
      state: 'unmatched',
      from: addDays(businessDate(b.reconcile_from), -DAYS_AFTER),
    });
    const pairs = autoMatch(bankLines, ledger);
    const bankById = new Map(bankLines.map((l) => [l.id, l]));
    const ledgerById = new Map(ledger.map((l) => [l.id, l]));
    for (const p of pairs) {
      const matchId = await this.insertMatch(
        b,
        'auto',
        [bankById.get(p.statementLineId)!],
        [ledgerById.get(p.ledgerLineId)!],
        p.reason === 'reference'
          ? 'Same amount and reference'
          : 'Only line of this amount',
      );
      await this.audit.record({
        action: 'bank_match.created',
        entity: 'bank_match',
        entityId: matchId,
        after: {
          kind: 'auto',
          reason: p.reason,
          statementLines: [p.statementLineId],
          ledgerLines: [p.ledgerLineId],
        },
      });
    }
    return pairs.length;
  }

  private async insertMatch(
    b: CompanyBankAccount,
    kind: 'auto' | 'manual' | 'suggestion',
    bankLines: StatementRow[],
    ledger: LedgerRow[],
    note: string | null,
  ) {
    const m = await this.db.tx
      .insertInto('bank_matches')
      .values({ bank_account_id: b.id, kind, note })
      .returning('id')
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('bank_match_items')
      .values([
        ...bankLines.map((l) => ({
          match_id: m.id,
          bank_account_id: b.id,
          statement_line_id: l.id,
          voucher_line_id: null,
          amount: l.amount,
        })),
        ...ledger.map((l) => ({
          match_id: m.id,
          bank_account_id: b.id,
          statement_line_id: null,
          voucher_line_id: l.id,
          amount: l.amount,
        })),
      ])
      .execute();
    return m.id;
  }

  private async loadStatementLines(
    id: string,
    query: LinesQueryDto,
    ids?: string[],
  ): Promise<StatementRow[]> {
    if (ids && !ids.length) return [];
    let q = this.db.tx
      .selectFrom('bank_statement_lines as s')
      .leftJoin('bank_match_items as i', (j) =>
        j.onRef('i.statement_line_id', '=', 's.id').on('i.active', '=', true),
      )
      .select([
        's.id',
        's.statement_id',
        's.line_no',
        's.txn_date',
        's.value_date',
        's.description',
        's.reference',
        's.amount',
        's.balance',
        'i.match_id',
      ])
      .where('s.bank_account_id', '=', id);
    if (ids) q = q.where('s.id', 'in', ids);
    if (query.state === 'unmatched') q = q.where('i.match_id', 'is', null);
    if (query.state === 'matched') q = q.where('i.match_id', 'is not', null);
    if (query.from) q = q.where('s.txn_date', '>=', query.from);
    if (query.to) q = q.where('s.txn_date', '<=', query.to);
    const rows = await q
      .orderBy('s.txn_date')
      .orderBy('s.created_at')
      .orderBy('s.line_no')
      .limit(2000)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      statementId: r.statement_id,
      lineNo: r.line_no,
      date: r.txn_date,
      valueDate: r.value_date,
      description: r.description,
      reference: r.reference,
      amount: r.amount,
      balance: r.balance,
      matchId: r.match_id,
    }));
  }

  private async loadLedgerLines(
    b: CompanyBankAccount,
    query: LinesQueryDto,
    ids?: string[],
  ): Promise<LedgerRow[]> {
    if (ids && !ids.length) return [];
    let q = this.db.tx
      .selectFrom('voucher_lines as vl')
      .innerJoin('vouchers as v', 'v.id', 'vl.voucher_id')
      .leftJoin('vendor_payments as p', 'p.voucher_id', 'v.id')
      .leftJoin('bank_match_items as i', (j) =>
        j.onRef('i.voucher_line_id', '=', 'vl.id').on('i.active', '=', true),
      )
      .select([
        'vl.id',
        'v.id as voucher_id',
        'v.voucher_type',
        'v.number',
        'v.voucher_date',
        'v.narration',
        'vl.narration as line_narration',
        'p.reference',
        'i.match_id',
      ])
      .select(sql<string>`(vl.debit - vl.credit)::text`.as('amount'))
      .where('vl.account_id', '=', b.account_id)
      .where('v.state', '=', 'posted');
    if (ids) q = q.where('vl.id', 'in', ids);
    if (query.state === 'unmatched') q = q.where('i.match_id', 'is', null);
    if (query.state === 'matched') q = q.where('i.match_id', 'is not', null);
    if (query.from) q = q.where('v.voucher_date', '>=', query.from);
    if (query.to) q = q.where('v.voucher_date', '<=', query.to);
    const rows = await q
      .orderBy('v.voucher_date')
      .orderBy('v.number')
      .limit(5000)
      .execute();
    return rows.map((r) => ({
      id: r.id,
      voucherId: r.voucher_id,
      voucherType: r.voucher_type,
      voucherNumber: r.number,
      date: r.voucher_date,
      narration: [r.narration, r.line_narration].filter(Boolean).join(' · '),
      reference: r.reference,
      amount: Money.of(r.amount).toDb(),
      matchId: r.match_id,
    }));
  }

  private async statementLine(statementLineId: string) {
    const row = await this.db.tx
      .selectFrom('bank_statement_lines')
      .select('bank_account_id')
      .where('id', '=', statementLineId)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.BANK_LINE_NOT_FOUND);
    const b = await this.findAccount(row.bank_account_id);
    const [line] = await this.loadStatementLines(b.id, { state: 'all' }, [
      statementLineId,
    ]);
    return { b, line };
  }

  private async ledgerBalance(
    accountId: string,
    asOf: string,
  ): Promise<string> {
    const r = await this.db.tx
      .selectFrom('voucher_lines as vl')
      .innerJoin('vouchers as v', 'v.id', 'vl.voucher_id')
      .select(sql<string>`coalesce(sum(vl.debit - vl.credit), 0)::text`.as('b'))
      .where('vl.account_id', '=', accountId)
      .where('v.state', '=', 'posted')
      .where('v.voucher_date', '<=', asOf)
      .executeTakeFirstOrThrow();
    return Money.of(r.b).toDb();
  }

  private async statementSumTo(id: string, date: string): Promise<string> {
    const r = await this.db.tx
      .selectFrom('bank_statement_lines')
      .select(sql<string>`coalesce(sum(amount), 0)::text`.as('s'))
      .where('bank_account_id', '=', id)
      .where('txn_date', '<=', date)
      .executeTakeFirstOrThrow();
    return r.s;
  }

  private async assertBankLedgerAccount(companyId: string, accountId: string) {
    const a = await this.db.tx
      .selectFrom('accounts')
      .select(['company_id', 'role', 'postable', 'is_active'])
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (
      !a ||
      a.company_id !== companyId ||
      a.role !== 'bank' ||
      !a.postable ||
      !a.is_active
    )
      throw new BadRequestException(MSG.BANK_LEDGER_ACCOUNT_INVALID);
  }

  private async findAccount(id: string): Promise<CompanyBankAccount> {
    const b = await this.db.tx
      .selectFrom('company_bank_accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!b) throw new NotFoundException(MSG.COMPANY_BANK_ACCOUNT_NOT_FOUND);
    if (
      !this.access.allows('bank.view', { companyId: b.company_id }) &&
      !this.access.allows('bank.import', { companyId: b.company_id })
    ) {
      throw new ForbiddenException(MSG.FORBIDDEN);
    }
    return b;
  }

  private toAccount(b: CompanyBankAccount) {
    return {
      id: b.id,
      companyId: b.company_id,
      accountId: b.account_id,
      bankName: b.bank_name,
      branch: b.branch,
      accountName: b.account_name,
      accountNo: b.account_no,
      statementFormat: b.statement_format,
      reconcileFrom: b.reconcile_from,
      openingBankBalance: b.opening_bank_balance,
      isActive: b.is_active,
      version: b.version,
    };
  }

  private toStatement(s: {
    id: string;
    source: string;
    file_name: string;
    period_from: string;
    period_to: string;
    opening_balance: string | null;
    closing_balance: string | null;
    lines_imported: number;
    lines_skipped: number;
    created_at: Date;
  }) {
    return {
      id: s.id,
      source: s.source,
      fileName: s.file_name,
      periodFrom: s.period_from,
      periodTo: s.period_to,
      openingBalance: s.opening_balance,
      closingBalance: s.closing_balance,
      linesImported: s.lines_imported,
      linesSkipped: s.lines_skipped,
      importedAt: s.created_at,
    };
  }

  publicStatementLine(l: StatementRow) {
    return {
      id: l.id,
      date: l.date,
      valueDate: l.valueDate,
      description: l.description,
      reference: l.reference,
      amount: l.amount,
      balance: l.balance,
      matchId: l.matchId,
    };
  }

  publicLedgerLine(l: LedgerRow) {
    return {
      id: l.id,
      voucherId: l.voucherId,
      voucherType: l.voucherType,
      voucherNumber: l.voucherNumber,
      date: l.date,
      narration: l.narration,
      reference: l.reference,
      amount: l.amount,
      matchId: l.matchId,
    };
  }
}
