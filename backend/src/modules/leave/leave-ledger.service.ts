/**
 * The leave ledger (guide §7.6): balances are ALWAYS the sum of ledger entries.
 *
 *   balance(asOf)  = SUM(days) of entries dated on or before asOf
 *   available      = SUM(days) of all entries (incl. approved future leave) - pending requests
 *
 * Jobs (accrual, year end) use a period key ("grant:2026", "month:2026-10",
 * "year_end:2026"), so running them twice writes nothing new.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { sql } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  addMonths,
  businessDate,
  daysInMonth,
  toBusinessDate,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  LeaveEligibility,
  LeaveType,
  LedgerKind,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { AttendanceService } from '../attendance/attendance.service.js';
import { EmployeeAccess } from '../employees/employee-access.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { RulesService } from '../rules/rules.service.js';
import type { LedgerEntryDto } from './dto/leave.dto.js';
import {
  leaveYearOf,
  prorate,
  round2,
  yearEndSplit,
  type LeaveYear,
} from './leave-rules.js';
import { LeaveTypesService } from './leave-types.service.js';

export interface BalanceLine {
  leaveTypeId: string;
  code: string;
  nameEn: string;
  nameBn: string | null;
  usesBalance: boolean;
  balance: number; // ledger sum up to the date
  pending: number; // days in requests waiting for approval
  available: number; // what can still be requested
}

@Injectable()
export class LeaveLedgerService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly employees: EmployeeDirectory,
    private readonly types: LeaveTypesService,
    private readonly rules: RulesService,
    private readonly attendance: AttendanceService,
    private readonly org: OrgLookupService,
  ) {}

  // ================================================================ balances

  async balances(
    employeeId: string,
    asOf?: string,
  ): Promise<{
    employeeId: string;
    asOf: BusinessDate;
    balances: BalanceLine[];
  }> {
    const employee = await this.employeeAccess.find(employeeId);
    await this.assertCanSee(employeeId);
    const date = asOf ? businessDate(asOf) : this.today();
    const types = await this.db.tx
      .selectFrom('leave_types')
      .selectAll()
      .where('company_id', '=', employee.company_id)
      .where('is_active', '=', true)
      .orderBy('code')
      .execute();

    const sums = await this.db.tx
      .selectFrom('leave_ledger')
      .select([
        'leave_type_id',
        sql<string>`coalesce(sum(days) filter (where entry_date <= ${date}), 0)`.as(
          'to_date',
        ),
        sql<string>`coalesce(sum(days), 0)`.as('all_time'),
      ])
      .where('employee_id', '=', employeeId)
      .groupBy('leave_type_id')
      .execute();
    const pending = await this.db.tx
      .selectFrom('leave_requests')
      .select(['leave_type_id', sql<string>`sum(days_counted)`.as('days')])
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'pending')
      .groupBy('leave_type_id')
      .execute();

    return {
      employeeId,
      asOf: date,
      balances: types.map((t) => {
        const s = sums.find((x) => x.leave_type_id === t.id);
        const p = Number(
          pending.find((x) => x.leave_type_id === t.id)?.days ?? 0,
        );
        return {
          leaveTypeId: t.id,
          code: t.code,
          nameEn: t.name_en,
          nameBn: t.name_bn,
          usesBalance: t.accrual_method !== 'none',
          balance: Number(s?.to_date ?? 0),
          pending: p,
          available: round2(Number(s?.all_time ?? 0) - p),
        };
      }),
    };
  }

  /** What can still be requested of one type (used when applying and approving). */
  async available(
    employeeId: string,
    leaveTypeId: string,
    excludeRequestId?: string,
  ): Promise<number> {
    const { total } = await this.db.tx
      .selectFrom('leave_ledger')
      .select(sql<string>`coalesce(sum(days), 0)`.as('total'))
      .where('employee_id', '=', employeeId)
      .where('leave_type_id', '=', leaveTypeId)
      .executeTakeFirstOrThrow();
    let pendingQuery = this.db.tx
      .selectFrom('leave_requests')
      .select(sql<string>`coalesce(sum(days_counted), 0)`.as('days'))
      .where('employee_id', '=', employeeId)
      .where('leave_type_id', '=', leaveTypeId)
      .where('state', '=', 'pending');
    if (excludeRequestId)
      pendingQuery = pendingQuery.where('id', '<>', excludeRequestId);
    const { days } = await pendingQuery.executeTakeFirstOrThrow();
    return round2(Number(total) - Number(days));
  }

  /** Every entry, oldest first, with a running balance. */
  async statement(employeeId: string, leaveTypeId?: string) {
    await this.employeeAccess.find(employeeId);
    await this.assertCanSee(employeeId);
    let q = this.db.tx
      .selectFrom('leave_ledger as l')
      .innerJoin('leave_types as t', 't.id', 'l.leave_type_id')
      .select([
        'l.id',
        'l.leave_type_id',
        't.code',
        'l.entry_date',
        'l.kind',
        'l.days',
        'l.leave_year',
        'l.source_type',
        'l.source_id',
        'l.note',
        'l.created_at',
      ])
      .where('l.employee_id', '=', employeeId);
    if (leaveTypeId) q = q.where('l.leave_type_id', '=', leaveTypeId);
    const rows = await q
      .orderBy('l.entry_date')
      .orderBy('l.created_at')
      .execute();

    const running = new Map<string, number>();
    return rows.map((r) => {
      const balance = round2(
        (running.get(r.leave_type_id) ?? 0) + Number(r.days),
      );
      running.set(r.leave_type_id, balance);
      return { ...r, days: Number(r.days), balanceAfter: balance };
    });
  }

  // ================================================================ writes

  /** Used by LeaveRequestsService: taken / reversal entries. */
  async write(entry: {
    employeeId: string;
    leaveTypeId: string;
    entryDate: BusinessDate;
    kind: LedgerKind;
    days: number;
    leaveYear: string;
    sourceType?: string;
    sourceId?: string;
    periodKey?: string;
    note?: string;
  }): Promise<boolean> {
    if (round2(entry.days) === 0) return false;
    const row = await this.db.tx
      .insertInto('leave_ledger')
      .values({
        employee_id: entry.employeeId,
        leave_type_id: entry.leaveTypeId,
        entry_date: entry.entryDate,
        kind: entry.kind,
        days: round2(entry.days).toFixed(2),
        leave_year: entry.leaveYear,
        period_key: entry.periodKey ?? null,
        source_type: entry.sourceType ?? null,
        source_id: entry.sourceId ?? null,
        note: entry.note ?? null,
      })
      .onConflict((oc) =>
        oc
          .columns([
            'tenant_id',
            'employee_id',
            'leave_type_id',
            'kind',
            'period_key',
          ])
          .where('period_key', 'is not', null)
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  /** HR: opening balance at go-live (migration, spec §10) or a manual adjustment. */
  async addManualEntry(employeeId: string, dto: LedgerEntryDto) {
    const employee = await this.employeeAccess.check(
      'leave.manage',
      employeeId,
    );
    const type = await this.types.findType(dto.leaveTypeId);
    if (type.company_id !== employee.company_id)
      throw new BadRequestException('Leave type belongs to another company');
    const policy = await this.types.policyFor(employee.company_id);
    const date = businessDate(dto.entryDate);

    await this.write({
      employeeId,
      leaveTypeId: type.id,
      entryDate: date,
      kind: dto.kind,
      days: dto.days,
      leaveYear: leaveYearOf(date, policy.leaveYearStart).label,
      note: dto.note,
    });
    await this.audit.record({
      action: `leave.ledger_${dto.kind}`,
      entity: 'employee',
      entityId: employeeId,
      after: { leaveType: type.code, ...dto },
    });
    return this.balances(employeeId, dto.entryDate);
  }

  // ================================================================ accrual job

  /**
   * Accrue leave up to `asOf` for every employee of a company (idempotent):
   *   annual_grant     the leave year's entitlement (prorated for joiners), once per year
   *   monthly          entitlement / 12 for each completed month of the leave year
   *   per_worked_days  worked days / N for each completed month (from attendance)
   */
  async runAccruals(
    companyId: string,
    asOf?: string,
  ): Promise<{ entries: number }> {
    this.access.assert('leave.manage', { companyId });
    const date = asOf ? businessDate(asOf) : this.today();
    const policy = await this.types.policyFor(companyId);
    const year = leaveYearOf(date, policy.leaveYearStart);
    const types = (
      await this.db.tx
        .selectFrom('leave_types')
        .selectAll()
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .execute()
    ).filter((t) => t.accrual_method !== 'none');

    let entries = 0;
    for (const placement of await this.employees.employedOn(date, {
      companyId,
    })) {
      const employee = await this.employeeAccess.find(placement.employeeId);
      if (employee.status === 'draft' || employee.status === 'separated')
        continue;
      const joinDate = businessDate(employee.join_date);

      for (const type of types) {
        if (!this.genderAllows(type, employee.gender)) continue;
        const entitlement = await this.entitlement(type, date);

        if (type.accrual_method === 'annual_grant') {
          const days = prorate(entitlement, joinDate, year);
          const added = await this.write({
            employeeId: employee.id,
            leaveTypeId: type.id,
            entryDate: joinDate > year.from ? joinDate : year.from,
            kind: 'accrual',
            days,
            leaveYear: year.label,
            periodKey: `grant:${year.label}`,
            note: `Entitlement ${year.label}${days < entitlement ? ' (prorated)' : ''}`,
          });
          if (added) entries++;
          continue;
        }

        // monthly and per_worked_days: each completed month of the leave year since joining
        for (const month of completedMonths(year, date)) {
          if (month.to < joinDate) continue;
          const days =
            type.accrual_method === 'monthly'
              ? round2(entitlement / 12)
              : round2(
                  (await this.attendance.workedDays(
                    employee.id,
                    month.from,
                    month.to,
                  )) / entitlement,
                );
          const added = await this.write({
            employeeId: employee.id,
            leaveTypeId: type.id,
            entryDate: month.to,
            kind: 'accrual',
            days,
            leaveYear: year.label,
            periodKey: `month:${month.label}`,
            note:
              type.accrual_method === 'per_worked_days'
                ? `Earned for ${month.label} (1 day per ${entitlement} worked)`
                : `Monthly accrual ${month.label}`,
          });
          if (added) entries++;
        }
      }
    }
    await this.audit.record({
      action: 'leave.accruals_run',
      entity: 'company',
      entityId: companyId,
      after: { asOf: date, entries },
    });
    return { entries };
  }

  // ================================================================ year end

  /**
   * Close a finished leave year (idempotent): per employee and type,
   *   lapse    closes the year's balance
   *   encash   the part above the carry cap of encashable types -> leave_encashments for payroll
   *   carry_in the carried part opens the next year
   */
  async runYearEnd(companyId: string, leaveYearLabel: string) {
    this.access.assert('leave.manage', { companyId });
    const policy = await this.types.policyFor(companyId);
    const year = leaveYearOf(
      businessDate(`${leaveYearLabel.slice(0, 4)}-${policy.leaveYearStart}`),
      policy.leaveYearStart,
    );
    if (year.label !== leaveYearLabel)
      throw new BadRequestException(
        `Leave years of this company look like "${year.label}"`,
      );
    if (year.to >= this.today())
      throw new BadRequestException('The leave year has not ended yet');
    const nextYear = leaveYearOf(addDays(year.to, 1), policy.leaveYearStart);

    const types = (
      await this.db.tx
        .selectFrom('leave_types')
        .selectAll()
        .where('company_id', '=', companyId)
        .execute()
    ).filter((t) => t.accrual_method !== 'none');
    const employeeIds = await this.db.tx
      .selectFrom('leave_ledger as l')
      .innerJoin('employees as e', 'e.id', 'l.employee_id')
      .select('l.employee_id')
      .distinct()
      .where('e.company_id', '=', companyId)
      .execute();

    const summary = { lapsed: 0, carried: 0, encashed: 0 };
    for (const { employee_id } of employeeIds) {
      for (const type of types) {
        const { balance } = await this.db.tx
          .selectFrom('leave_ledger')
          .select(sql<string>`coalesce(sum(days), 0)`.as('balance'))
          .where('employee_id', '=', employee_id)
          .where('leave_type_id', '=', type.id)
          .where('entry_date', '<=', year.to)
          .executeTakeFirstOrThrow();
        const split = yearEndSplit(
          Number(balance),
          type.year_end_action,
          type.carry_cap_days !== null ? Number(type.carry_cap_days) : null,
          type.encashable,
        );
        const base = {
          employeeId: employee_id,
          leaveTypeId: type.id,
          leaveYear: year.label,
        };

        if (split.encash > 0) {
          const added = await this.write({
            ...base,
            entryDate: year.to,
            kind: 'encash',
            days: -split.encash,
            periodKey: `year_end:${year.label}`,
            note: `Encashed at the end of ${year.label}`,
          });
          if (added) {
            await this.db.tx
              .insertInto('leave_encashments')
              .values({
                employee_id,
                leave_type_id: type.id,
                leave_year: year.label,
                days: split.encash.toFixed(2),
              })
              .onConflict((oc) => oc.doNothing())
              .execute();
            summary.encashed += split.encash;
          }
        }
        const close = round2(Number(balance) - split.encash);
        if (close > 0) {
          const added = await this.write({
            ...base,
            entryDate: year.to,
            kind: 'lapse',
            days: -close,
            periodKey: `year_end:${year.label}`,
            note: `Year ${year.label} closed (${split.carry} carried, ${split.lapse} lapsed)`,
          });
          if (added) summary.lapsed += split.lapse;
        }
        if (split.carry > 0) {
          const added = await this.write({
            ...base,
            entryDate: nextYear.from,
            kind: 'carry_in',
            days: split.carry,
            leaveYear: nextYear.label,
            periodKey: `year_end:${year.label}`,
            note: `Carried from ${year.label}`,
          });
          if (added) summary.carried += split.carry;
        }
      }
    }
    await this.audit.record({
      action: 'leave.year_end_run',
      entity: 'company',
      entityId: companyId,
      after: { leaveYear: year.label, ...summary },
    });
    return { leaveYear: year.label, ...summary };
  }

  /**
   * Daily job (worker): accruals up to today for every company, and closing the
   * previous leave year once it has ended. Both are idempotent.
   */
  async runScheduled(): Promise<{ companies: number; entries: number }> {
    let entries = 0;
    const companyIds = await this.org.activeCompanyIds();
    for (const companyId of companyIds) {
      entries += (await this.runAccruals(companyId)).entries;
      const policy = await this.types.policyFor(companyId);
      const previous = leaveYearOf(
        addDays(leaveYearOf(this.today(), policy.leaveYearStart).from, -1),
        policy.leaveYearStart,
      );
      await this.runYearEnd(companyId, previous.label);
    }
    return { companies: companyIds.length, entries };
  }

  async encashments(companyId: string) {
    this.access.assert('leave.view', { companyId });
    return this.db.tx
      .selectFrom('leave_encashments as x')
      .innerJoin('employees as e', 'e.id', 'x.employee_id')
      .innerJoin('leave_types as t', 't.id', 'x.leave_type_id')
      .select([
        'x.id',
        'x.employee_id',
        'e.employee_code',
        'e.full_name_en',
        't.code as leave_type',
        'x.leave_year',
        'x.days',
        'x.status',
        'x.payroll_period',
      ])
      .where('e.company_id', '=', companyId)
      .orderBy('x.leave_year', 'desc')
      .execute();
  }

  // ================================================================ data migration (WP8)

  /** Leave types of a company by code (for the migration templates). */
  async typesByCode(
    companyId: string,
  ): Promise<Map<string, { id: string; usesBalance: boolean }>> {
    const rows = await this.db.tx
      .selectFrom('leave_types')
      .select(['id', 'code', 'accrual_method'])
      .where('company_id', '=', companyId)
      .where('is_active', '=', true)
      .execute();
    return new Map(
      rows.map((t) => [
        t.code,
        { id: t.id, usesBalance: t.accrual_method !== 'none' },
      ]),
    );
  }

  /** "<employeeId>|<leaveTypeId>" pairs that have an opening entry already. */
  async openingPairs(employeeIds: string[]): Promise<Set<string>> {
    if (employeeIds.length === 0) return new Set();
    const rows = await this.db.tx
      .selectFrom('leave_ledger')
      .select(['employee_id', 'leave_type_id'])
      .where('kind', '=', 'opening')
      .where('employee_id', 'in', employeeIds)
      .execute();
    return new Set(rows.map((r) => `${r.employee_id}|${r.leave_type_id}`));
  }

  /**
   * The balance at go-live as an "opening" entry dated the day before cut-over,
   * so all later logic (accrual, year end, requests) treats it like any entry.
   * Returns the ledger entry id.
   */
  async importOpening(
    row: { employeeId: string; leaveTypeId: string; days: number },
    cutOverDate: string,
    companyId: string,
  ): Promise<string | null> {
    if (row.days === 0) return null;
    const policy = await this.types.policyFor(companyId);
    const asOf = addDays(businessDate(cutOverDate), -1);
    const saved = await this.db.tx
      .insertInto('leave_ledger')
      .values({
        employee_id: row.employeeId,
        leave_type_id: row.leaveTypeId,
        entry_date: asOf,
        kind: 'opening',
        days: round2(row.days).toFixed(2),
        leave_year: leaveYearOf(asOf, policy.leaveYearStart).label,
        source_type: 'data_import',
        note: 'Balance at go-live (data migration)',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return saved.id;
  }

  /** Balance per leave type on a date, summed over employees (reconciliation report). */
  async balanceTotals(
    employeeIds: string[],
    asOf: string,
  ): Promise<Array<{ code: string; employees: number; days: string }>> {
    if (employeeIds.length === 0) return [];
    const rows = await this.db.tx
      .selectFrom('leave_ledger as l')
      .innerJoin('leave_types as t', 't.id', 'l.leave_type_id')
      .select([
        't.code',
        sql<number>`count(DISTINCT l.employee_id)::int`.as('employees'),
        sql<string>`sum(l.days)`.as('days'),
      ])
      .where('l.employee_id', 'in', employeeIds)
      .where('l.entry_date', '<=', asOf)
      .groupBy('t.code')
      .orderBy('t.code')
      .execute();
    return rows.map((r) => ({
      code: r.code,
      employees: r.employees,
      days: Number(r.days).toFixed(2),
    }));
  }

  // ================================================================ for payroll (WP6)

  /**
   * Approved leave in a date range that payroll treats specially, per employee:
   *   unpaid     leave without pay (paid = false): ranges, payroll keeps the days attendance shows "on leave"
   *   maternity  maternity leave (rule key leave.maternity.days): every calendar day is paid as maternity pay
   */
  async payrollLeave(companyId: string, from: BusinessDate, to: BusinessDate) {
    const rows = await this.db.tx
      .selectFrom('leave_requests as r')
      .innerJoin('leave_types as t', 't.id', 'r.leave_type_id')
      .select([
        'r.employee_id',
        'r.from_date',
        'r.to_date',
        't.paid',
        't.max_days_rule_key',
      ])
      .where('r.company_id', '=', companyId)
      .where('r.state', '=', 'approved')
      .where('r.from_date', '<=', to)
      .where('r.to_date', '>=', from)
      .execute();
    return rows
      .filter((r) => !r.paid || r.max_days_rule_key === 'leave.maternity.days')
      .map((r) => ({
        employeeId: r.employee_id,
        from: r.from_date,
        to: r.to_date,
        kind: r.paid ? ('maternity' as const) : ('unpaid' as const),
      }));
  }

  /** Year-end encashments waiting for payroll. */
  async pendingEncashments(companyId: string) {
    const rows = await this.db.tx
      .selectFrom('leave_encashments as x')
      .innerJoin('employees as e', 'e.id', 'x.employee_id')
      .select(['x.id', 'x.employee_id', 'x.days'])
      .where('e.company_id', '=', companyId)
      .where('x.status', '=', 'pending_payroll')
      .execute();
    return rows.map((r) => ({
      id: r.id,
      employeeId: r.employee_id,
      days: r.days,
    }));
  }

  /** Called inside the payroll approval. */
  async markEncashmentsPaid(ids: string[], period: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db.tx
      .updateTable('leave_encashments')
      .set({ status: 'paid', payroll_period: period })
      .where('id', 'in', ids)
      .execute();
  }

  /** Final settlement: unused balance of encashable leave types on the last working day. */
  async encashableBalance(
    employeeId: string,
    asOf: BusinessDate,
  ): Promise<string> {
    const row = await this.db.tx
      .selectFrom('leave_ledger as l')
      .innerJoin('leave_types as t', 't.id', 'l.leave_type_id')
      .select(sql<string>`COALESCE(SUM(l.days), 0)`.as('days'))
      .where('l.employee_id', '=', employeeId)
      .where('t.encashable', '=', true)
      .where('l.entry_date', '<=', asOf)
      .executeTakeFirstOrThrow();
    return Number(row.days) > 0 ? Number(row.days).toFixed(2) : '0';
  }

  // ================================================================ helpers

  /** Entitlement on a date: a fixed number, or the rule pack value (refused in production while unverified). */
  async entitlement(type: LeaveType, date: BusinessDate): Promise<number> {
    if (type.entitlement_rule_key)
      return Number(
        (await this.rules.get(type.entitlement_rule_key, date)).value,
      );
    return Number(type.entitlement_days ?? 0);
  }

  genderAllows(type: LeaveType, gender: string | null): boolean {
    const rule = (type.eligibility as LeaveEligibility).gender;
    return !rule || rule === gender;
  }

  private async assertCanSee(employeeId: string): Promise<void> {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    // own record, or within leave.view scope (Dept Head: department, HR: company)
    if (
      !this.access.allows('leave.view', resource) &&
      !this.access.allows('leave.apply_own', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
  }

  private today(): BusinessDate {
    return toBusinessDate(this.clock.now());
  }
}

/** Completed calendar months of a leave year up to (not including) the month of `asOf`. */
function completedMonths(
  year: LeaveYear,
  asOf: BusinessDate,
): Array<{ label: string; from: BusinessDate; to: BusinessDate }> {
  const months = [];
  for (let from = year.from; from <= year.to; from = addMonths(from, 1)) {
    const [y, m] = from.split('-').map(Number);
    const to = businessDate(
      `${from.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`,
    );
    if (to >= asOf) break;
    months.push({ label: from.slice(0, 7), from, to });
  }
  return months;
}
