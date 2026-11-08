/**
 * Gate 2 (spec §12): "a pilot closes one month fully in the system, and the trial balance
 * reconciles with its old system".
 *
 *   compare(company, file, asOf)   the old system's trial balance on a date (old account
 *                    codes) against ours: each old balance goes to our account through the
 *                    account map kept from the opening import; per account the difference;
 *                    old codes with a balance and no mapping. Stored, never changed.
 *   map(company, oldCode, account)   an old account that first appears after cut-over
 *                    (e.g. the old system's income accounts) mapped to ours
 *   report(company)  the gate, criterion by criterion:
 *                      opening balances from the old system posted
 *                      a month after cut-over closed in the system
 *                      that month's checklist complete
 *                      the old system's trial balance at that month end matches ours
 *                      the nightly checks pass
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { AccessService } from '../identity/access/access.service.js';
import { LedgerReportsService } from '../ledger/ledger-reports.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { MAX_TB_BYTES } from './opening-balances.service.js';
import { MonthCloseService, monthEnd } from './month-close.service.js';
import { compare, parseOldTrialBalance } from './trial-balance-files.js';

@Injectable()
export class Gate2Service {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
    private readonly reports: LedgerReportsService,
    private readonly monthClose: MonthCloseService,
  ) {}

  async upload(
    companyId: string,
    file: Express.Multer.File | undefined,
    asOf: string,
    note?: string,
  ) {
    if (!file?.buffer?.length || file.size > MAX_TB_BYTES)
      throw new BadRequestException(MSG.BANK_FILE_MISSING);
    return this.compare(
      companyId,
      { name: file.originalname, content: file.buffer.toString('utf8') },
      asOf,
      note,
    );
  }

  async compare(
    companyId: string,
    file: { name: string; content: string },
    asOf: string,
    note?: string,
  ) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    const parsed = parseOldTrialBalance(file.content);
    if (parsed.problems.length)
      throw new BadRequestException({
        message: MSG.OLD_TB_INVALID,
        details: { problems: parsed.problems.slice(0, 30) },
      });
    const map = new Map(
      (
        await this.db.tx
          .selectFrom('account_map')
          .select(['old_code', 'account_id'])
          .where('company_id', '=', companyId)
          .execute()
      ).map((m) => [m.old_code, m.account_id]),
    );
    const ours = await this.balances(companyId, asOf);
    const result = compare(parsed.rows, map, ours);
    const row = await this.db.tx
      .insertInto('old_system_comparisons')
      .values({
        company_id: companyId,
        as_of: asOf,
        file_name: file.name,
        file_sha256: createHash('sha256').update(file.content).digest('hex'),
        result: JSON.stringify({
          lines: result.lines,
          unmappedAccounts: result.unmapped,
        }),
        differences: result.differences,
        unmapped: result.unmapped.length,
        matched: result.matched,
        note: note ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'old_system.compared',
      entity: 'old_system_comparison',
      entityId: row.id,
      after: {
        asOf,
        file: file.name,
        differences: row.differences,
        unmapped: row.unmapped,
        matched: row.matched,
      },
    });
    return this.get(row.id);
  }

  async accountMap(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('account_map as m')
      .innerJoin('accounts as a', 'a.id', 'm.account_id')
      .select([
        'm.old_code',
        'm.old_name',
        'm.account_id',
        'a.code',
        'a.name_en',
      ])
      .where('m.company_id', '=', companyId)
      .orderBy('m.old_code')
      .execute();
    return rows.map((r) => ({
      oldCode: r.old_code,
      oldName: r.old_name,
      accountId: r.account_id,
      accountCode: r.code,
      accountName: r.name_en,
    }));
  }

  async map(
    companyId: string,
    dto: { oldCode: string; oldName?: string; accountId: string },
  ) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    const a = await this.db.tx
      .selectFrom('accounts')
      .select(['company_id', 'postable'])
      .where('id', '=', dto.accountId)
      .executeTakeFirst();
    if (!a || a.company_id !== companyId || !a.postable)
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
    await this.db.tx
      .insertInto('account_map')
      .values({
        company_id: companyId,
        old_code: dto.oldCode,
        old_name: dto.oldName ?? null,
        account_id: dto.accountId,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'company_id', 'old_code']).doUpdateSet({
          old_name: dto.oldName ?? null,
          account_id: dto.accountId,
        }),
      )
      .execute();
    await this.audit.record({
      action: 'account_map.set',
      entity: 'company',
      entityId: companyId,
      after: dto,
    });
    return this.accountMap(companyId);
  }

  async list(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('old_system_comparisons')
      .select([
        'id',
        'as_of',
        'file_name',
        'differences',
        'unmapped',
        'matched',
        'note',
        'created_at',
      ])
      .where('company_id', '=', companyId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      asOf: r.as_of,
      fileName: r.file_name,
      differences: r.differences,
      unmapped: r.unmapped,
      matched: r.matched,
      note: r.note,
      createdAt: r.created_at,
    }));
  }

  async get(id: string) {
    const r = await this.db.tx
      .selectFrom('old_system_comparisons')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!r) throw new NotFoundException(MSG.NOT_FOUND);
    this.access.assert('ledger.view', { companyId: r.company_id });
    return {
      ...(r.result as object),
      id: r.id,
      asOf: r.as_of,
      fileName: r.file_name,
      differences: r.differences,
      unmapped: r.unmapped,
      matched: r.matched,
      note: r.note,
      createdAt: r.created_at,
    };
  }

  async report(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const opening = await this.db.tx
      .selectFrom('opening_balance_imports')
      .select(['cut_over_date', 'state'])
      .where('company_id', '=', companyId)
      .where('state', '=', 'posted')
      .executeTakeFirst();
    const closed = (await this.monthClose.closedPeriods(companyId)).filter(
      (p) => opening && `${p.period}-01` >= opening.cut_over_date,
    );
    const month = closed[0]?.period ?? null;
    const checklist = month
      ? await this.monthClose.checklist(companyId, month)
      : null;
    const comparison = month
      ? await this.db.tx
          .selectFrom('old_system_comparisons')
          .select(['id', 'matched', 'differences', 'unmapped', 'created_at'])
          .where('company_id', '=', companyId)
          .where('as_of', '=', monthEnd(month))
          .orderBy('created_at', 'desc')
          .limit(1)
          .executeTakeFirst()
      : undefined;
    const checks = await this.reports.checks(companyId, { skipAccess: true });
    const criteria = [
      {
        key: 'opening_posted',
        ok: !!opening,
        detail: opening
          ? `cut-over ${opening.cut_over_date}`
          : 'Import the opening trial balance from the old system',
      },
      {
        key: 'month_closed',
        ok: !!month,
        detail: month ?? 'Close a month after the cut-over (month-end close)',
      },
      {
        key: 'checklist_complete',
        ok: !!checklist?.ready,
        detail: checklist
          ? checklist.ready
            ? null
            : checklist.items
                .filter((i) => !i.ok)
                .map((i) => i.key)
                .join(', ')
          : null,
      },
      {
        key: 'old_system_matches',
        ok: !!comparison?.matched,
        detail: !month
          ? null
          : !comparison
            ? `Compare the old system's trial balance at ${monthEnd(month)}`
            : comparison.matched
              ? null
              : `${comparison.differences} account(s) differ, ${comparison.unmapped} old account(s) not mapped`,
      },
      {
        key: 'books_checks',
        ok: checks.ok,
        detail:
          checks.problems.map((p) => `${p.check}: ${p.detail}`).join('; ') ||
          null,
      },
    ];
    return {
      companyId,
      month,
      cutOverDate: opening?.cut_over_date ?? null,
      comparisonId: comparison?.id ?? null,
      criteria,
      passed: criteria.every((c) => c.ok),
    };
  }

  /** debit - credit per postable account, posted up to and including the date. */
  private async balances(companyId: string, asOf: string) {
    const rows = await this.db.tx
      .selectFrom('accounts as a')
      .leftJoin(
        (eb) =>
          eb
            .selectFrom('voucher_lines as l')
            .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
            .select([
              'l.account_id',
              sql<string>`sum(l.debit - l.credit)::text`.as('b'),
            ])
            .where('v.company_id', '=', companyId)
            .where('v.state', '=', 'posted')
            .where('v.voucher_date', '<=', asOf)
            .groupBy('l.account_id')
            .as('s'),
        (j) => j.onRef('s.account_id', '=', 'a.id'),
      )
      .select(['a.id', 'a.code', 'a.name_en', 's.b'])
      .where('a.company_id', '=', companyId)
      .where('a.postable', '=', true)
      .orderBy('a.code')
      .execute();
    return rows.map((r) => ({
      accountId: r.id,
      code: r.code,
      name: r.name_en,
      balance: Money.of(r.b ?? '0').toDb(),
    }));
  }
}
