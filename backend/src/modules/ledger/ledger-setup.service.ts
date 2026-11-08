/**
 * Setting up a company's books (spec §6.6; Phase 2 WP14):
 *
 *   setUp(companyId)        chart of accounts from the Bangladesh template, the
 *                           default posting accounts, and the fiscal year of the
 *                           given date with its twelve monthly periods. Safe to
 *                           run again: only what is missing is created.
 *   accounts                list, add, rename / deactivate (codes and types stay)
 *   posting accounts        which account each automatic posting uses
 *   fiscal years, periods   open the next year; close a month (for good)
 *
 * Owned by Accounts (ledger.setup / ledger.periods.close); everyone with
 * ledger.view may read.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  businessDate,
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Account, FiscalYear } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { CHART_TEMPLATE, DEFAULT_POSTING_ACCOUNTS } from './chart-template.js';
import type {
  CreateAccountDto,
  SetPostingAccountDto,
  UpdateAccountDto,
} from './dto/ledger.dto.js';
import { fiscalYearFor } from './fiscal.js';

@Injectable()
export class LedgerSetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly org: OrgLookupService,
  ) {}

  // ================================================================== status

  async status(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(sql<number>`count(*)::int`.as('n'))
      .where('company_id', '=', companyId)
      .executeTakeFirstOrThrow();
    const years = await this.fiscalYears(companyId);
    const missing = await this.missingPostingKeys(companyId);
    return {
      companyId,
      setUp: accounts.n > 0 && years.length > 0,
      accounts: accounts.n,
      fiscalYears: years,
      missingPostingAccounts: missing,
    };
  }

  /** Chart, posting accounts and the fiscal year of asOf (default today). Only what is missing. */
  async setUp(companyId: string, asOf?: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });

    // chart of accounts (only for a company without one)
    const existing = await this.db.tx
      .selectFrom('accounts')
      .select('id')
      .where('company_id', '=', companyId)
      .limit(1)
      .executeTakeFirst();
    let created = 0;
    if (!existing) {
      const idByCode = new Map<string, string>();
      for (const a of CHART_TEMPLATE) {
        const row = await this.db.tx
          .insertInto('accounts')
          .values({
            company_id: companyId,
            code: a.code,
            name_en: a.nameEn,
            name_bn: a.nameBn,
            type: a.type,
            parent_id: a.parent ? idByCode.get(a.parent)! : null,
            postable: !a.group,
            role: a.role ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        idByCode.set(a.code, row.id);
        created++;
      }
    } else {
      // a chart made before newer template accounts (e.g. WP19 disposal gain / loss): add the missing ones
      const have = new Map(
        (
          await this.db.tx
            .selectFrom('accounts')
            .select(['id', 'code'])
            .where('company_id', '=', companyId)
            .execute()
        ).map((a) => [a.code, a.id]),
      );
      for (const a of CHART_TEMPLATE) {
        if (have.has(a.code) || (a.parent && !have.has(a.parent))) continue;
        const row = await this.db.tx
          .insertInto('accounts')
          .values({
            company_id: companyId,
            code: a.code,
            name_en: a.nameEn,
            name_bn: a.nameBn,
            type: a.type,
            parent_id: a.parent ? have.get(a.parent)! : null,
            postable: !a.group,
            role: a.role ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        have.set(a.code, row.id);
        created++;
      }
    }

    // default posting accounts (keys not set yet)
    const accounts = await this.db.tx
      .selectFrom('accounts')
      .select(['id', 'code'])
      .where('company_id', '=', companyId)
      .execute();
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const [key, code] of Object.entries(DEFAULT_POSTING_ACCOUNTS)) {
      const accountId = byCode.get(code);
      if (!accountId) continue;
      await this.db.tx
        .insertInto('posting_accounts')
        .values({ company_id: companyId, key, account_id: accountId })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'company_id', 'key']).doNothing(),
        )
        .execute();
    }

    // the fiscal year of the date
    const year = await this.openFiscalYearFor(
      companyId,
      businessDate(asOf ?? todayInDhaka(this.clock.now())),
    );
    await this.audit.record({
      action: 'ledger.set_up',
      entity: 'company',
      entityId: companyId,
      after: { accountsCreated: created, fiscalYear: year.code },
    });
    return this.status(companyId);
  }

  // ================================================================ accounts

  /** The chart in code order, each with its depth in the tree. */
  async listAccounts(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('accounts')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('code')
      .execute();
    const depthOf = (a: Account, seen = 0): number => {
      const parent = a.parent_id
        ? rows.find((r) => r.id === a.parent_id)
        : undefined;
      return parent && seen < 10 ? 1 + depthOf(parent, seen + 1) : 0;
    };
    return rows.map((a) => ({ ...toAccountResponse(a), depth: depthOf(a) }));
  }

  async createAccount(companyId: string, dto: CreateAccountDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    // the parent: a group account of the same company and type
    if (dto.parentId) {
      const parent = await this.findAccount(dto.parentId);
      if (
        parent.company_id !== companyId ||
        parent.postable ||
        parent.type !== dto.type
      )
        throw new BadRequestException(MSG.VALIDATION_FAILED);
    }
    const row = await this.db.tx
      .insertInto('accounts')
      .values({
        company_id: companyId,
        code: dto.code,
        name_en: dto.nameEn,
        name_bn: dto.nameBn ?? null,
        type: dto.type,
        parent_id: dto.parentId ?? null,
        postable: dto.postable ?? true,
        role: dto.role ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'account.created',
      entity: 'account',
      entityId: row.id,
      after: dto,
    });
    return toAccountResponse(row);
  }

  /** Name, role and active flag only: code, type and tree position stay (postings depend on them). */
  async updateAccount(id: string, dto: UpdateAccountDto) {
    const account = await this.findAccount(id);
    this.access.assert('ledger.setup', { companyId: account.company_id });
    if (account.version !== dto.version)
      throw new ConflictException(MSG.STALE_VERSION);
    const row = await this.db.tx
      .updateTable('accounts')
      .set({
        ...(dto.nameEn !== undefined ? { name_en: dto.nameEn } : {}),
        ...(dto.nameBn !== undefined ? { name_bn: dto.nameBn } : {}),
        ...(dto.isActive !== undefined ? { is_active: dto.isActive } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'account.updated',
      entity: 'account',
      entityId: id,
      before: toAccountResponse(account),
      after: toAccountResponse(row),
    });
    return toAccountResponse(row);
  }

  async findAccount(id: string): Promise<Account> {
    const row = await this.db.tx
      .selectFrom('accounts')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.ACCOUNT_NOT_FOUND);
    return row;
  }

  // ========================================================= posting accounts

  async postingAccounts(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    const rows = await this.db.tx
      .selectFrom('posting_accounts as p')
      .innerJoin('accounts as a', 'a.id', 'p.account_id')
      .select(['p.key', 'a.id', 'a.code', 'a.name_en'])
      .where('p.company_id', '=', companyId)
      .orderBy('p.key')
      .execute();
    const set = new Map(rows.map((r) => [r.key, r]));
    const keys = [
      ...new Set([...Object.keys(DEFAULT_POSTING_ACCOUNTS), ...set.keys()]),
    ].sort();
    return keys.map((key) => {
      const r = set.get(key);
      return {
        key,
        accountId: r?.id ?? null,
        accountCode: r?.code ?? null,
        accountName: r?.name_en ?? null,
      };
    });
  }

  async setPostingAccount(companyId: string, dto: SetPostingAccountDto) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    const account = await this.findAccount(dto.accountId);
    if (
      account.company_id !== companyId ||
      !account.postable ||
      !account.is_active
    )
      throw new BadRequestException(MSG.ACCOUNT_NOT_POSTABLE);
    await this.db.tx
      .insertInto('posting_accounts')
      .values({ company_id: companyId, key: dto.key, account_id: account.id })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'company_id', 'key']).doUpdateSet({
          account_id: account.id,
          updated_at: this.clock.now(),
        }),
      )
      .execute();
    await this.audit.record({
      action: 'posting_account.set',
      entity: 'company',
      entityId: companyId,
      after: { key: dto.key, account: account.code },
    });
    return this.postingAccounts(companyId);
  }

  /**
   * The account for a posting key: the key itself, else its general key
   * ("payroll.earning.OVERTIME" -> "payroll.earnings"). Null when neither is set.
   */
  async resolvePostingAccounts(
    companyId: string,
  ): Promise<(key: string, fallback?: string) => string | null> {
    const rows = await this.db.tx
      .selectFrom('posting_accounts')
      .select(['key', 'account_id'])
      .where('company_id', '=', companyId)
      .execute();
    const map = new Map(rows.map((r) => [r.key, r.account_id]));
    return (key, fallback) =>
      map.get(key) ?? (fallback ? (map.get(fallback) ?? null) : null);
  }

  // ===================================================== fiscal years, periods

  async listFiscalYears(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    return this.fiscalYears(companyId);
  }

  async fiscalYears(companyId: string) {
    const years = await this.db.tx
      .selectFrom('fiscal_years')
      .selectAll()
      .where('company_id', '=', companyId)
      .orderBy('starts_on', 'desc')
      .execute();
    const periods = await this.db.tx
      .selectFrom('accounting_periods')
      .select(['fiscal_year_id', 'state'])
      .where('company_id', '=', companyId)
      .execute();
    return years.map((y) => ({
      id: y.id,
      code: y.code,
      startsOn: y.starts_on,
      endsOn: y.ends_on,
      closedPeriods: periods.filter(
        (p) => p.fiscal_year_id === y.id && p.state === 'closed',
      ).length,
    }));
  }

  async openFiscalYear(companyId: string, forDate: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.setup', { companyId });
    const year = await this.openFiscalYearFor(companyId, businessDate(forDate));
    return {
      id: year.id,
      code: year.code,
      startsOn: year.starts_on,
      endsOn: year.ends_on,
    };
  }

  async listPeriods(companyId: string, fiscalYearId?: string) {
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.view', { companyId });
    let q = this.db.tx
      .selectFrom('accounting_periods')
      .selectAll()
      .where('company_id', '=', companyId);
    if (fiscalYearId) q = q.where('fiscal_year_id', '=', fiscalYearId);
    const rows = await q.orderBy('period').execute();
    return rows.map((p) => ({
      period: p.period,
      startsOn: p.starts_on,
      endsOn: p.ends_on,
      state: p.state,
      closedAt: p.closed_at,
      closedBy: p.closed_by,
    }));
  }

  /**
   * Close a month for good (spec §6.6): earlier months must be closed first, and
   * no voucher dated in it may still be a draft or waiting for approval.
   */
  async closePeriod(companyId: string, period: string) {
    if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new BadRequestException(MSG.VALIDATION_FAILED);
    await this.org.assertCompanyExists(companyId);
    this.access.assert('ledger.periods.close', { companyId });
    const row = await this.db.tx
      .selectFrom('accounting_periods')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('period', '=', period)
      .executeTakeFirst();
    if (!row) throw new NotFoundException(MSG.PERIOD_NOT_FOUND);
    if (row.state === 'closed') throw new ConflictException(MSG.PERIOD_CLOSED);

    const earlierOpen = await this.db.tx
      .selectFrom('accounting_periods')
      .select('period')
      .where('company_id', '=', companyId)
      .where('period', '<', period)
      .where('state', '=', 'open')
      .orderBy('period')
      .execute();
    if (earlierOpen.length)
      throw new ConflictException({
        message: MSG.VOUCHER_WRONG_STATE,
        details: { closeFirst: earlierOpen.map((p) => p.period) },
      });
    const unfinished = await this.db.tx
      .selectFrom('vouchers')
      .select(['number', 'state'])
      .where('company_id', '=', companyId)
      .where('state', 'in', ['draft', 'in_approval'])
      .where('voucher_date', '>=', row.starts_on)
      .where('voucher_date', '<=', row.ends_on)
      .execute();
    if (unfinished.length)
      throw new ConflictException({
        message: MSG.VOUCHER_WRONG_STATE,
        details: {
          unfinishedVouchers: unfinished.map((v) => `${v.number} (${v.state})`),
        },
      });

    await this.db.tx
      .updateTable('accounting_periods')
      .set({
        state: 'closed',
        closed_by: requestContext.get().userId ?? null,
        closed_at: this.clock.now(),
      })
      .where('id', '=', row.id)
      .execute();
    await this.audit.record({
      action: 'accounting_period.closed',
      entity: 'company',
      entityId: companyId,
      after: { period },
    });
    return { period, state: 'closed' as const };
  }

  /** The fiscal year containing a date (and its periods), created when missing. */
  private async openFiscalYearFor(
    companyId: string,
    date: BusinessDate,
  ): Promise<FiscalYear> {
    const company = await this.db.tx
      .selectFrom('companies')
      .select('fiscal_year_start')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow();
    const span = fiscalYearFor(date, company.fiscal_year_start);
    const found = await this.db.tx
      .selectFrom('fiscal_years')
      .selectAll()
      .where('company_id', '=', companyId)
      .where('code', '=', span.code)
      .executeTakeFirst();
    if (found) return found;
    const year = await this.db.tx
      .insertInto('fiscal_years')
      .values({
        company_id: companyId,
        code: span.code,
        starts_on: span.startsOn,
        ends_on: span.endsOn,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('accounting_periods')
      .values(
        span.periods.map((p) => ({
          company_id: companyId,
          fiscal_year_id: year.id,
          period: p.period,
          starts_on: p.startsOn,
          ends_on: p.endsOn,
        })),
      )
      .execute();
    await this.audit.record({
      action: 'fiscal_year.opened',
      entity: 'company',
      entityId: companyId,
      after: { code: span.code },
    });
    return year;
  }

  private async missingPostingKeys(companyId: string): Promise<string[]> {
    const rows = await this.db.tx
      .selectFrom('posting_accounts')
      .select('key')
      .where('company_id', '=', companyId)
      .execute();
    const set = new Set(rows.map((r) => r.key));
    return Object.keys(DEFAULT_POSTING_ACCOUNTS).filter((k) => !set.has(k));
  }
}

export function toAccountResponse(a: Account) {
  return {
    id: a.id,
    code: a.code,
    nameEn: a.name_en,
    nameBn: a.name_bn,
    type: a.type,
    parentId: a.parent_id,
    postable: a.postable,
    role: a.role,
    isActive: a.is_active,
    version: a.version,
  };
}
