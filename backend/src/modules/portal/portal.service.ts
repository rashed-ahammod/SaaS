/**
 * What the HR & Admin portal's home screen needs in one call: how far the
 * company's setup has got, and what is waiting for this user today.
 *
 * It owns no tables. Like AccessService (ADR 0005) it is a documented exception
 * to "a module owns its tables": it only counts rows of other modules' tables,
 * read-only, and never writes or interprets them. Anything beyond a count
 * belongs on that module's own screen, which every item here links to.
 */
import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock } from '../../platform/clock.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { addDays, todayInDhaka } from '../../platform/dates/business-date.js';
import { ApprovalsService } from '../approvals/approvals.service.js';
import { AccessService } from '../identity/access/access.service.js';
import type { PermissionKey } from '../identity/access/permissions.js';
import { OrgLookupService } from '../org/org-lookup.service.js';

/** One step of "set the company up", in the order a tenant does them. */
export interface SetupStep {
  /** Text key the portal shows (p.home.setup.<key>). */
  key: string;
  done: boolean;
  /** How many records exist (for 'salaries': how many are still missing). */
  count: number;
  /** The screen that finishes this step. */
  href: string;
}

/** One thing waiting for the user now. */
export interface AttentionItem {
  /** Text key the portal shows (p.home.task.<key>). */
  key: string;
  count: number;
  tone: 'warn' | 'info';
  href: string;
}

const COUNT = sql<number>`count(*)::int`.as('n');
const ACTIVE_STATUS = ['probation', 'active', 'notice'] as const;

/** The month before this one, as 'YYYY-MM' (Dhaka). */
function previousPeriod(now: Date): string {
  const [year, month] = todayInDhaka(now).split('-').map(Number);
  return month === 1
    ? `${year - 1}-12`
    : `${year}-${String(month - 1).padStart(2, '0')}`;
}

function rows(row: { n: number } | undefined): number {
  return row?.n ?? 0;
}

@Injectable()
export class PortalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: AccessService,
    private readonly approvals: ApprovalsService,
    private readonly org: OrgLookupService,
    private readonly clock: Clock,
  ) {}

  /** Setup progress and the user's waiting work for one company. */
  async overview(companyId: string) {
    await this.org.assertCompanyExists(companyId);
    const [setup, attention] = await Promise.all([
      this.setup(companyId),
      this.attention(companyId),
    ]);
    const steps = setup.filter((s): s is SetupStep => s !== null);
    return {
      companyId,
      setup: {
        steps,
        done: steps.filter((s) => s.done).length,
        total: steps.length,
        complete: steps.length > 0 && steps.every((s) => s.done),
      },
      attention: attention.filter(
        (a): a is AttentionItem => a !== null && a.count > 0,
      ),
    };
  }

  // ------------------------------------------------------------------ setup

  /** One step per thing a new company must create; null when the user cannot do it. */
  private async setup(companyId: string): Promise<Array<SetupStep | null>> {
    const tx = this.db.tx;
    const [
      branches,
      departments,
      designations,
      grades,
      shifts,
      holidays,
      leaveTypes,
      employees,
      structures,
      missingSalary,
      users,
      runs,
      gate1,
    ] = await Promise.all([
      tx
        .selectFrom('branches')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('departments')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('designations')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('grades')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('shifts')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('holidays as h')
        .innerJoin('holiday_calendars as c', 'c.id', 'h.calendar_id')
        .select(COUNT)
        .where('c.company_id', '=', companyId)
        .where('h.is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('leave_types')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('employees')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('status', 'in', ACTIVE_STATUS)
        .executeTakeFirst(),
      tx
        .selectFrom('salary_structures')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('is_active', '=', true)
        .executeTakeFirst(),
      tx
        .selectFrom('employees as e')
        .select(COUNT)
        .where('e.company_id', '=', companyId)
        .where('e.status', 'in', ACTIVE_STATUS)
        .where((eb) =>
          eb.not(
            eb.exists(
              eb
                .selectFrom('employee_salaries as s')
                .select('s.id')
                .whereRef('s.employee_id', '=', 'e.id')
                .where('s.status', '=', 'active'),
            ),
          ),
        )
        .executeTakeFirst(),
      tx
        .selectFrom('users')
        .select(COUNT)
        .where('status', '=', 'active')
        .executeTakeFirst(),
      tx
        .selectFrom('payroll_runs')
        .select(COUNT)
        .where('company_id', '=', companyId)
        .where('state', '!=', 'cancelled')
        .executeTakeFirst(),
      tx
        .selectFrom('parallel_run_comparisons')
        .select(sql<number>`count(distinct period)::int`.as('n'))
        .where('company_id', '=', companyId)
        .where('status', '=', 'accepted')
        .executeTakeFirst(),
    ]);

    const step = (
      key: string,
      needs: PermissionKey[],
      count: number,
      done: boolean,
      href: string,
    ): SetupStep | null =>
      needs.some((p) => this.access.allows(p, { companyId }))
        ? { key, done, count, href }
        : null;
    const people = rows(employees);
    const withoutSalary = rows(missingSalary);

    return [
      step(
        'branches',
        ['org.structure.manage'],
        rows(branches),
        rows(branches) > 0,
        '/portal/organization',
      ),
      step(
        'departments',
        ['org.structure.manage'],
        rows(departments),
        rows(departments) > 0,
        '/portal/organization',
      ),
      step(
        'designations',
        ['org.jobs.manage'],
        rows(designations),
        rows(designations) > 0,
        '/portal/organization',
      ),
      step(
        'grades',
        ['org.jobs.manage'],
        rows(grades),
        rows(grades) > 0,
        '/portal/organization',
      ),
      step(
        'shifts',
        ['attendance.manage'],
        rows(shifts),
        rows(shifts) > 0,
        '/portal/attendance',
      ),
      step(
        'holidays',
        ['attendance.manage'],
        rows(holidays),
        rows(holidays) > 0,
        '/portal/attendance',
      ),
      step(
        'leaveTypes',
        ['leave.manage'],
        rows(leaveTypes),
        rows(leaveTypes) > 0,
        '/portal/leave',
      ),
      step(
        'employees',
        ['employee.manage', 'employee.view'],
        people,
        people > 0,
        '/portal/employees',
      ),
      step(
        'structures',
        ['payroll.prepare'],
        rows(structures),
        rows(structures) > 0,
        '/portal/payroll/setup',
      ),
      step(
        'salaries',
        ['payroll.prepare'],
        withoutSalary,
        people > 0 && withoutSalary === 0,
        '/portal/employees',
      ),
      step(
        'users',
        ['users.manage'],
        rows(users),
        rows(users) > 0,
        '/portal/users',
      ),
      step(
        'firstRun',
        ['payroll.prepare', 'payroll.verify', 'payroll.approve'],
        rows(runs),
        rows(runs) > 0,
        '/portal/payroll',
      ),
      step(
        'gate1',
        ['payroll.prepare', 'payroll.verify', 'payroll.approve'],
        rows(gate1),
        rows(gate1) >= 3,
        '/portal/gate-1',
      ),
    ];
  }

  // -------------------------------------------------------------- attention

  /** Counts of work waiting for this user; only what their permissions cover is queried. */
  private async attention(
    companyId: string,
  ): Promise<Array<AttentionItem | null>> {
    const tx = this.db.tx;
    const today = todayInDhaka(this.clock.now());
    const lastMonth = previousPeriod(this.clock.now());
    const can = (...needs: PermissionKey[]) =>
      needs.some((p) => this.access.allows(p, { companyId }));

    const [
      inbox,
      phones,
      bankAccounts,
      leaveRequests,
      probation,
      lock,
      openRuns,
      papers,
    ] = await Promise.all([
      this.approvals.inbox(),
      can('attendance.manage')
        ? tx
            .selectFrom('employee_devices as d')
            .innerJoin('employees as e', 'e.id', 'd.employee_id')
            .select(COUNT)
            .where('e.company_id', '=', companyId)
            .where('d.status', '=', 'pending')
            .executeTakeFirst()
        : undefined,
      can('payroll.disburse', 'employee.manage')
        ? tx
            .selectFrom('employee_bank_accounts as b')
            .innerJoin('employees as e', 'e.id', 'b.employee_id')
            .select(COUNT)
            .where('e.company_id', '=', companyId)
            .where('b.status', '=', 'pending')
            .executeTakeFirst()
        : undefined,
      can('leave.manage')
        ? tx
            .selectFrom('leave_requests')
            .select(COUNT)
            .where('company_id', '=', companyId)
            .where('state', '=', 'pending')
            .executeTakeFirst()
        : undefined,
      can('employee.manage')
        ? tx
            .selectFrom('employees')
            .select(COUNT)
            .where('company_id', '=', companyId)
            .where('status', '=', 'probation')
            .where('probation_end_date', 'is not', null)
            .where('probation_end_date', '<=', addDays(today, 30))
            .executeTakeFirst()
        : undefined,
      can('attendance.manage')
        ? tx
            .selectFrom('attendance_locks')
            .select(COUNT)
            .where('company_id', '=', companyId)
            .where('period', '=', lastMonth)
            .executeTakeFirst()
        : undefined,
      can(
        'payroll.prepare',
        'payroll.verify',
        'payroll.approve',
        'payroll.disburse',
      )
        ? tx
            .selectFrom('payroll_runs')
            .select(COUNT)
            .where('company_id', '=', companyId)
            .where('state', 'in', [
              'draft',
              'calculated',
              'verified',
              'approved',
            ])
            .executeTakeFirst()
        : undefined,
      // contracts, NIDs and licences that have expired or expire within a month
      can('employee.manage', 'employee.documents.view')
        ? tx
            .selectFrom('employee_documents as d')
            .innerJoin('employees as e', 'e.id', 'd.employee_id')
            .select(COUNT)
            .where('e.company_id', '=', companyId)
            .where('e.status', '!=', 'separated')
            .where('d.status', '=', 'active')
            .where('d.expires_on', 'is not', null)
            .where('d.expires_on', '<=', addDays(today, 30))
            .executeTakeFirst()
        : undefined,
    ]);

    const item = (
      key: string,
      count: number,
      tone: 'warn' | 'info',
      href: string,
    ): AttentionItem => ({ key, count, tone, href });
    return [
      item('approvals', inbox.length, 'warn', '/portal/approvals'),
      phones
        ? item('phones', rows(phones), 'warn', '/portal/attendance')
        : null,
      bankAccounts
        ? item('bankAccounts', rows(bankAccounts), 'warn', '/portal/approvals')
        : null,
      leaveRequests
        ? item('leaveRequests', rows(leaveRequests), 'info', '/portal/leave')
        : null,
      probation
        ? item('probation', rows(probation), 'info', '/portal/lifecycle')
        : null,
      // the month payroll needs is unlocked: one reminder, not a count
      lock
        ? item(
            'attendanceLock',
            rows(lock) === 0 ? 1 : 0,
            'info',
            '/portal/attendance',
          )
        : null,
      openRuns
        ? item('openRuns', rows(openRuns), 'info', '/portal/payroll')
        : null,
      papers
        ? item(
            'documentExpiry',
            rows(papers),
            'warn',
            '/portal/lifecycle?tab=papers',
          )
        : null,
    ];
  }
}
