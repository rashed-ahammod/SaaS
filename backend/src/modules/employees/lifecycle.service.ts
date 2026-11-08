/**
 * Employee lifecycle after onboarding (spec §6.1 steps 3, 5, 6; employee audit 2026-10-21).
 *
 * Probation:  the worker reminds the Dept Head 15 days before the probation ends
 *             (event employee.probation_ending); the Dept Head recommends confirm,
 *             extend or end; HR decides. Confirm -> active; extend -> new end date;
 *             end -> a separation ("end of probation").
 *
 * Separation: HR records the notice (resignation, termination, retirement, contract
 *             end): notice given vs the company's notice period, the shortfall. Four
 *             clearances (IT, Admin assets, Accounts advances, Dept Head handover)
 *             must be done before the final settlement run; HR may clear any of them.
 *             A notice can be withdrawn while no final settlement exists. The approved
 *             final settlement separates the employee (EmployeesService.markSeparated);
 *             HR then prints the experience certificate.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import {
  addDays,
  addMonths,
  businessDate,
  daysBetween,
  todayInDhaka,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type {
  ClearanceItem,
  Employee,
  Separation,
} from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { Money } from '../../platform/money/money.js';
import { OutboxService } from '../../platform/outbox/outbox.service.js';
import { AccessService } from '../identity/access/access.service.js';
import type { PermissionKey } from '../identity/access/permissions.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import {
  CLEARANCE_ITEMS,
  type NoticeDto,
  type ProbationDecisionDto,
  type ProbationRecommendationDto,
} from './dto/lifecycle.dto.js';
import { EmployeeAccess } from './employee-access.js';
import { EmployeeDirectory } from './employee-directory.service.js';
import { EmployeesService } from './employees.service.js';
import { renderExperienceCertificatePdf } from './experience-certificate-pdf.js';

/** Days before the probation end date when the Dept Head is reminded (spec §6.1). */
export const PROBATION_REMINDER_DAYS = 15;

/** Who clears each item (HR, with employee.manage, may clear any). */
const CLEARED_BY: Record<ClearanceItem, PermissionKey> = {
  it: 'users.manage',
  admin_assets: 'org.structure.manage',
  accounts_advances: 'payroll.disburse',
  dept_handover: 'employee.lifecycle.review',
};

@Injectable()
export class LifecycleService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employeeAccess: EmployeeAccess,
    private readonly directory: EmployeeDirectory,
    private readonly org: OrgLookupService,
    private readonly employees: EmployeesService,
  ) {}

  private today() {
    return todayInDhaka(this.clock.now());
  }

  // ================================================================ probation

  /** Employees whose probation ends within `withinDays` (or has already ended), with the review so far. */
  async probationDue(companyId: string, withinDays = 30) {
    await this.org.assertCompanyExists(companyId);
    const limit = addDays(this.today(), withinDays);
    const rows = await this.db.tx
      .selectFrom('employees')
      .select([
        'id',
        'employee_code',
        'full_name_en',
        'full_name_bn',
        'join_date',
        'probation_end_date',
      ])
      .where('company_id', '=', companyId)
      .where('status', '=', 'probation')
      .where('probation_end_date', 'is not', null)
      .where('probation_end_date', '<=', limit)
      .orderBy('probation_end_date')
      .execute();

    const out = [];
    for (const r of rows) {
      const resource = await this.employeeAccess.resourceOf(
        await this.employeeAccess.find(r.id),
      );
      if (
        !this.access.allows('employee.manage', resource) &&
        !this.access.allows('employee.lifecycle.review', resource)
      )
        continue;
      const review = await this.reviewOf(r.id, r.probation_end_date!);
      out.push({
        employeeId: r.id,
        employeeCode: r.employee_code,
        fullNameEn: r.full_name_en,
        fullNameBn: r.full_name_bn,
        joinDate: r.join_date,
        probationEndDate: r.probation_end_date,
        daysLeft: daysBetween(
          this.today(),
          businessDate(r.probation_end_date!),
        ),
        departmentId: resource.departmentId ?? null,
        review,
      });
    }
    return out;
  }

  /** The Dept Head (or HR) recommends; nobody reviews their own probation. */
  async recommend(employeeId: string, dto: ProbationRecommendationDto) {
    const employee = await this.onProbation(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows('employee.lifecycle.review', resource) &&
      !this.access.allows('employee.manage', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (this.access.current().employeeId === employee.id)
      throw new ForbiddenException(MSG.FORBIDDEN);

    const values = {
      recommendation: dto.outcome,
      recommend_months: dto.outcome === 'extend' ? dto.months! : null,
      recommend_note: dto.note,
      recommended_by: this.access.current().userId,
      recommended_at: this.clock.now(),
    };
    await this.upsertReview(employee, values);
    await this.audit.record({
      action: 'employee.probation_recommended',
      entity: 'employee',
      entityId: employee.id,
      after: dto,
    });
    return this.reviewOf(employee.id, employee.probation_end_date!);
  }

  /** HR decides: confirm, extend or end. */
  async decide(employeeId: string, dto: ProbationDecisionDto) {
    const employee = await this.onProbation(employeeId);
    this.access.assert(
      'employee.manage',
      await this.employeeAccess.resourceOf(employee),
    );
    if (this.access.current().employeeId === employee.id)
      throw new ForbiddenException(MSG.FORBIDDEN);

    const values = {
      decision: dto.outcome,
      decision_months: dto.outcome === 'extend' ? dto.months! : null,
      decision_note: dto.note,
      decided_by: this.access.current().userId,
      decided_at: this.clock.now(),
    };
    await this.upsertReview(employee, values);

    if (dto.outcome === 'confirm') {
      await this.db.tx
        .updateTable('employees')
        .set({ status: 'active', confirmed_at: this.clock.now() })
        .where('id', '=', employee.id)
        .execute();
    } else if (dto.outcome === 'extend') {
      const newEnd = addMonths(
        businessDate(employee.probation_end_date!),
        dto.months!,
      );
      await this.db.tx
        .updateTable('employees')
        .set({ probation_end_date: newEnd })
        .where('id', '=', employee.id)
        .execute();
    } else {
      await this.createSeparation(employee, {
        kind: 'probation_end',
        noticeDate: this.today(),
        lastWorkingDay: dto.lastWorkingDay!,
        reason: dto.note,
      });
    }
    await this.audit.record({
      action: 'employee.probation_decided',
      entity: 'employee',
      entityId: employee.id,
      before: {
        status: employee.status,
        probationEndDate: employee.probation_end_date,
      },
      after: dto,
    });
    return this.employees.getEmployee(employee.id);
  }

  /**
   * Worker: for every probation ending within 15 days (and not reminded for that
   * date yet), an employee.probation_ending event; notifications tell the Dept Head.
   */
  async remindProbationsDue(): Promise<number> {
    const today = this.today();
    const due = await this.db.tx
      .selectFrom('employees')
      .select(['id', 'company_id', 'probation_end_date'])
      .where('status', '=', 'probation')
      .where('probation_end_date', '>=', today)
      .where(
        'probation_end_date',
        '<=',
        addDays(today, PROBATION_REMINDER_DAYS),
      )
      .execute();
    let sent = 0;
    for (const e of due) {
      const review = await this.db.tx
        .selectFrom('probation_reviews')
        .select(['id', 'reminded_at'])
        .where('employee_id', '=', e.id)
        .where('probation_end_date', '=', e.probation_end_date!)
        .executeTakeFirst();
      if (review?.reminded_at) continue;
      if (review)
        await this.db.tx
          .updateTable('probation_reviews')
          .set({ reminded_at: this.clock.now() })
          .where('id', '=', review.id)
          .execute();
      else
        await this.db.tx
          .insertInto('probation_reviews')
          .values({
            employee_id: e.id,
            probation_end_date: e.probation_end_date!,
            reminded_at: this.clock.now(),
          })
          .execute();
      await this.outbox.add({
        type: 'employee.probation_ending',
        entityId: e.id,
        payload: {
          employeeId: e.id,
          companyId: e.company_id,
          probationEndDate: e.probation_end_date,
        },
      });
      sent += 1;
    }
    return sent;
  }

  private async onProbation(employeeId: string): Promise<Employee> {
    const employee = await this.employeeAccess.find(employeeId);
    if (employee.status !== 'probation' || !employee.probation_end_date)
      throw new BadRequestException(MSG.NOT_ON_PROBATION);
    return employee;
  }

  private async upsertReview(
    employee: Employee,
    values: Record<string, unknown>,
  ) {
    await this.db.tx
      .insertInto('probation_reviews')
      .values({
        employee_id: employee.id,
        probation_end_date: employee.probation_end_date!,
        ...values,
      })
      .onConflict((oc) =>
        oc
          .columns(['tenant_id', 'employee_id', 'probation_end_date'])
          .doUpdateSet(values),
      )
      .execute();
  }

  private async reviewOf(employeeId: string, probationEndDate: string) {
    const r = await this.db.tx
      .selectFrom('probation_reviews')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('probation_end_date', '=', probationEndDate)
      .executeTakeFirst();
    if (!r) return null;
    const names = await this.userNames([r.recommended_by, r.decided_by]);
    return {
      remindedAt: r.reminded_at,
      recommendation: r.recommendation,
      recommendMonths: r.recommend_months,
      recommendNote: r.recommend_note,
      recommendedBy: r.recommended_by
        ? (names.get(r.recommended_by) ?? null)
        : null,
      recommendedAt: r.recommended_at,
      decision: r.decision,
      decisionMonths: r.decision_months,
      decisionNote: r.decision_note,
      decidedBy: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
      decidedAt: r.decided_at,
    };
  }

  // ================================================================ separation

  /** HR records the notice; the employee works until the last working day. */
  async recordNotice(employeeId: string, dto: NoticeDto) {
    const employee = await this.employeeAccess.check(
      'employee.manage',
      employeeId,
    );
    if (employee.status !== 'probation' && employee.status !== 'active') {
      if (employee.status === 'notice')
        throw new ConflictException(MSG.SEPARATION_EXISTS);
      throw new BadRequestException(`Employee is ${employee.status}`);
    }
    await this.createSeparation(employee, {
      kind: dto.kind ?? 'resignation',
      noticeDate: dto.noticeDate ?? this.today(),
      lastWorkingDay: dto.lastWorkingDay,
      reason: dto.reason,
    });
    return this.employees.getEmployee(employee.id);
  }

  /**
   * A resignation the employee handed in from the app and the approvers accepted
   * (ResignationService): the same notice HR would record, without HR's permission check.
   */
  async recordAcceptedResignation(
    employeeId: string,
    s: { noticeDate: string; lastWorkingDay: string; reason: string },
  ) {
    const employee = await this.employeeAccess.find(employeeId);
    if (employee.status !== 'probation' && employee.status !== 'active')
      throw new ConflictException(MSG.SEPARATION_EXISTS);
    return this.createSeparation(employee, { kind: 'resignation', ...s });
  }

  private async createSeparation(
    employee: Employee,
    s: {
      kind: Separation['kind'];
      noticeDate: string;
      lastWorkingDay: string;
      reason: string;
    },
  ) {
    if (s.lastWorkingDay < employee.join_date)
      throw new BadRequestException(
        'The last working day is before the join date',
      );
    if (s.lastWorkingDay < s.noticeDate)
      throw new BadRequestException(
        'The last working day is before the notice date',
      );
    const rules = await this.org.getCompanyRules(employee.company_id);
    const required =
      s.kind === 'resignation'
        ? rules.noticeDaysResignation
        : s.kind === 'termination'
          ? rules.noticeDaysTermination
          : 0;
    const given = daysBetween(
      businessDate(s.noticeDate),
      businessDate(s.lastWorkingDay),
    );
    const shortfall = Math.max(0, required - given);

    const separation = await this.db.tx
      .insertInto('separations')
      .values({
        employee_id: employee.id,
        company_id: employee.company_id,
        kind: s.kind,
        notice_date: s.noticeDate,
        last_working_day: s.lastWorkingDay,
        required_notice_days: required,
        shortfall_days: shortfall,
        reason: s.reason,
        previous_status: employee.status as 'probation' | 'active',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.db.tx
      .insertInto('separation_clearances')
      .values(
        CLEARANCE_ITEMS.map((item) => ({ separation_id: separation.id, item })),
      )
      .execute();
    await this.db.tx
      .updateTable('employees')
      .set({ status: 'notice', last_working_day: s.lastWorkingDay })
      .where('id', '=', employee.id)
      .execute();

    await this.audit.record({
      action: 'employee.notice_recorded',
      entity: 'employee',
      entityId: employee.id,
      before: {
        status: employee.status,
        lastWorkingDay: employee.last_working_day,
      },
      after: {
        status: 'notice',
        separationId: separation.id,
        kind: s.kind,
        noticeDate: s.noticeDate,
        lastWorkingDay: s.lastWorkingDay,
        requiredNoticeDays: required,
        shortfallDays: shortfall,
        reason: s.reason,
      },
    });
    await this.outbox.add({
      type: 'employee.separation_recorded',
      entityId: employee.id,
      payload: {
        employeeId: employee.id,
        separationId: separation.id,
        kind: s.kind,
        lastWorkingDay: s.lastWorkingDay,
      },
    });
    return separation;
  }

  /** The latest separation of an employee (any state) with its clearances. */
  async separationOf(employeeId: string) {
    const employee = await this.employeeAccess.find(employeeId);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (!this.canSeeSeparation(resource))
      throw new ForbiddenException(MSG.FORBIDDEN);
    const separation = await this.db.tx
      .selectFrom('separations')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!separation) throw new NotFoundException(MSG.SEPARATION_NOT_FOUND);
    return this.toResponse(separation, employee);
  }

  /** Leavers of a company, newest first: HR, Admin, IT, Accounts see all; a Dept Head their department. */
  async listSeparations(companyId: string, state?: Separation['state']) {
    await this.org.assertCompanyExists(companyId);
    let q = this.db.tx
      .selectFrom('separations')
      .selectAll()
      .where('company_id', '=', companyId);
    if (state) q = q.where('state', '=', state);
    const rows = await q.orderBy('created_at', 'desc').limit(200).execute();
    const out = [];
    for (const s of rows) {
      const employee = await this.employeeAccess.find(s.employee_id);
      if (
        !this.canSeeSeparation(await this.employeeAccess.resourceOf(employee))
      )
        continue;
      out.push(await this.toResponse(s, employee));
    }
    return out;
  }

  /** One department clears the leaver (HR may clear any item). */
  async clear(separationId: string, item: ClearanceItem, note?: string) {
    const separation = await this.findSeparation(separationId);
    if (separation.state !== 'in_notice')
      throw new ConflictException(MSG.SEPARATION_NOT_FOUND);
    const employee = await this.employeeAccess.find(separation.employee_id);
    const resource = await this.employeeAccess.resourceOf(employee);
    if (
      !this.access.allows(CLEARED_BY[item], resource) &&
      !this.access.allows('employee.manage', resource)
    )
      throw new ForbiddenException(MSG.FORBIDDEN);
    if (this.access.current().employeeId === employee.id)
      throw new ForbiddenException(MSG.FORBIDDEN);
    // "assets returned" cannot be cleared while the register still shows assets with the leaver
    if (item === 'admin_assets') {
      const assets = await this.assetsHeldBy(employee.id);
      if (assets.length)
        throw new ConflictException({
          message: MSG.ASSETS_NOT_RETURNED,
          details: { assets: assets.map((a) => a.tag) },
        });
    }

    await this.db.tx
      .updateTable('separation_clearances')
      .set({
        cleared_by: this.access.current().userId,
        cleared_at: this.clock.now(),
        note: note ?? null,
      })
      .where('separation_id', '=', separationId)
      .where('item', '=', item)
      .where('cleared_at', 'is', null)
      .execute();
    await this.audit.record({
      action: 'employee.clearance_given',
      entity: 'employee',
      entityId: employee.id,
      after: { separationId, item, note },
    });
    return this.toResponse(separation, employee);
  }

  /** HR: the employee stays after all (only while no final settlement run exists). */
  async withdraw(separationId: string, reason: string) {
    const separation = await this.findSeparation(separationId);
    if (separation.state !== 'in_notice')
      throw new ConflictException(MSG.SEPARATION_NOT_FOUND);
    const employee = await this.employeeAccess.check(
      'employee.manage',
      separation.employee_id,
    );
    const settlement = await this.db.tx
      .selectFrom('payroll_runs')
      .select('id')
      .where('employee_id', '=', employee.id)
      .where('run_type', '=', 'final_settlement')
      .where('state', '!=', 'cancelled')
      .executeTakeFirst();
    if (settlement) throw new ConflictException(MSG.SEPARATION_HAS_SETTLEMENT);

    await this.db.tx
      .updateTable('separations')
      .set({ state: 'withdrawn', withdrawn_reason: reason })
      .where('id', '=', separationId)
      .execute();
    await this.db.tx
      .updateTable('employees')
      .set({ status: separation.previous_status, last_working_day: null })
      .where('id', '=', employee.id)
      .execute();
    await this.audit.record({
      action: 'employee.notice_withdrawn',
      entity: 'employee',
      entityId: employee.id,
      before: { status: 'notice', lastWorkingDay: separation.last_working_day },
      after: { status: separation.previous_status, reason },
    });
    return this.employees.getEmployee(employee.id);
  }

  /**
   * Payroll, before a final settlement run: every clearance must be done. Returns
   * the notice shortfall the employee owes (a resignation without enough notice).
   * Employees put on notice before clearance existed have no separation record.
   */
  async settlementCheck(
    employeeId: string,
  ): Promise<{ shortfallDays: number }> {
    // company assets still with the employee block the settlement (WP19), with or without clearance
    const assets = await this.assetsHeldBy(employeeId);
    if (assets.length)
      throw new BadRequestException({
        message: MSG.ASSETS_NOT_RETURNED,
        details: { assets: assets.map((a) => a.tag) },
      });
    const separation = await this.db.tx
      .selectFrom('separations')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'in_notice')
      .executeTakeFirst();
    if (!separation) return { shortfallDays: 0 };
    const open = await this.db.tx
      .selectFrom('separation_clearances')
      .select('item')
      .where('separation_id', '=', separation.id)
      .where('cleared_at', 'is', null)
      .execute();
    // in the checklist's own order (the database gives none)
    if (open.length)
      throw new BadRequestException({
        message: MSG.SEPARATION_NOT_CLEARED,
        details: {
          open: CLEARANCE_ITEMS.filter((i) => open.some((o) => o.item === i)),
        },
      });
    return {
      shortfallDays:
        separation.kind === 'resignation' ? separation.shortfall_days : 0,
    };
  }

  /** HR: the experience certificate of a separated employee (Bangla or English). */
  async experienceCertificate(employeeId: string, lang: 'bn' | 'en') {
    const employee = await this.employeeAccess.check(
      'employee.manage',
      employeeId,
    );
    if (employee.status !== 'separated' || !employee.last_working_day)
      throw new BadRequestException(MSG.NOT_SEPARATED);
    const company = await this.org.companyNames(employee.company_id);
    const placement =
      (await this.directory.placementOn(
        employeeId,
        businessDate(employee.last_working_day),
      )) ?? (await this.directory.currentOrFirstPlacement(employeeId));
    const names = await this.org.names({
      departmentIds: placement ? [placement.departmentId] : [],
      designationIds: placement ? [placement.designationId] : [],
    });
    const designation = placement
      ? names.designations.get(placement.designationId)
      : undefined;
    const content = await renderExperienceCertificatePdf({
      lang,
      companyName: company.legalName,
      number: `EC-${employee.employee_code}`,
      issuedOn: this.today(),
      employee: {
        code: employee.employee_code,
        name:
          lang === 'bn'
            ? (employee.full_name_bn ?? employee.full_name_en)
            : employee.full_name_en,
        gender: employee.gender,
        designation: designation
          ? lang === 'bn'
            ? (designation.nameBn ?? designation.nameEn)
            : designation.nameEn
          : null,
        department: placement
          ? (names.departments.get(placement.departmentId)?.name ?? null)
          : null,
        joinDate: employee.join_date,
        lastWorkingDay: employee.last_working_day,
      },
    });
    await this.audit.record({
      action: 'employee.experience_certificate_printed',
      entity: 'employee',
      entityId: employee.id,
      after: { lang },
    });
    return {
      fileName: `experience-certificate-${employee.employee_code}.pdf`,
      content,
    };
  }

  // ---------------------------------------------------------------- helpers

  /** HR, the Dept Head, and the people who clear an item (IT, Admin, Accounts). */
  private canSeeSeparation(resource: {
    companyId?: string | null;
    departmentId?: string | null;
    employeeId?: string | null;
  }) {
    return (
      ['employee.manage', ...Object.values(CLEARED_BY)] as PermissionKey[]
    ).some((p) => this.access.allows(p, resource));
  }

  private async findSeparation(id: string): Promise<Separation> {
    const s = await this.db.tx
      .selectFrom('separations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!s) throw new NotFoundException(MSG.SEPARATION_NOT_FOUND);
    return s;
  }

  private async toResponse(s: Separation, employee: Employee) {
    const clearances = (
      await this.db.tx
        .selectFrom('separation_clearances')
        .selectAll()
        .where('separation_id', '=', s.id)
        .execute()
    ).sort(
      (x, y) =>
        CLEARANCE_ITEMS.indexOf(x.item as (typeof CLEARANCE_ITEMS)[number]) -
        CLEARANCE_ITEMS.indexOf(y.item as (typeof CLEARANCE_ITEMS)[number]),
    );
    const names = await this.userNames(clearances.map((c) => c.cleared_by));
    const resource = await this.employeeAccess.resourceOf(employee);
    return {
      id: s.id,
      employeeId: employee.id,
      employeeCode: employee.employee_code,
      fullNameEn: employee.full_name_en,
      fullNameBn: employee.full_name_bn,
      kind: s.kind,
      noticeDate: s.notice_date,
      lastWorkingDay: s.last_working_day,
      requiredNoticeDays: s.required_notice_days,
      givenNoticeDays: daysBetween(
        businessDate(s.notice_date),
        businessDate(s.last_working_day),
      ),
      shortfallDays: s.shortfall_days,
      reason: s.reason,
      state: s.state,
      withdrawnReason: s.withdrawn_reason,
      separatedAt: s.separated_at,
      clearances: CLEARANCE_ITEMS.map((item) => {
        const c = clearances.find((x) => x.item === item);
        return {
          item,
          cleared: Boolean(c?.cleared_at),
          clearedAt: c?.cleared_at ?? null,
          clearedBy: c?.cleared_by ? (names.get(c.cleared_by) ?? null) : null,
          note: c?.note ?? null,
          canClear:
            s.state === 'in_notice' &&
            !c?.cleared_at &&
            (this.access.allows(CLEARED_BY[item], resource) ||
              this.access.allows('employee.manage', resource)) &&
            this.access.current().employeeId !== employee.id,
        };
      }),
      // what Accounts looks at before clearing (the final settlement recovers it)
      owed: await this.owedBy(employee.id),
    };
  }

  /** Assets of the register still assigned to the employee (WP19). */
  private async assetsHeldBy(employeeId: string) {
    return this.db.tx
      .selectFrom('asset_assignments as g')
      .innerJoin('assets as a', 'a.id', 'g.asset_id')
      .select(['a.id', 'a.tag', 'a.name', 'g.assigned_on'])
      .where('g.employee_id', '=', employeeId)
      .where('g.returned_on', 'is', null)
      .orderBy('a.tag')
      .execute();
  }

  /** Salary advances still to recover, cash advances not yet settled and assets not returned. */
  private async owedBy(employeeId: string) {
    const loans = await this.db.tx
      .selectFrom('loans')
      .select(['id', 'principal'])
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'approved')
      .execute();
    let salaryAdvances = Money.zero();
    for (const l of loans) {
      const back = await this.db.tx
        .selectFrom('loan_recoveries')
        .select('amount')
        .where('loan_id', '=', l.id)
        .execute();
      salaryAdvances = salaryAdvances.plus(
        back.reduce((a, r) => a.minus(r.amount), Money.of(l.principal)),
      );
    }
    const advances = await this.db.tx
      .selectFrom('expense_advances')
      .select(['id', 'amount'])
      .where('employee_id', '=', employeeId)
      .where('state', '=', 'paid')
      .execute();
    let cashAdvances = Money.zero();
    for (const a of advances) {
      const back = await this.db.tx
        .selectFrom('advance_settlements')
        .select('amount')
        .where('advance_id', '=', a.id)
        .execute();
      cashAdvances = cashAdvances.plus(
        back.reduce((x, r) => x.minus(r.amount), Money.of(a.amount)),
      );
    }
    const assets = (await this.assetsHeldBy(employeeId)).map((a) => ({
      id: a.id,
      tag: a.tag,
      name: a.name,
      assignedOn: a.assigned_on,
    }));
    return {
      salaryAdvances: salaryAdvances.toDb(),
      cashAdvances: cashAdvances.toDb(),
      assets,
    };
  }

  /** User id -> the person's name (their employee record, else the login). */
  private async userNames(
    ids: Array<string | null>,
  ): Promise<Map<string, string>> {
    const list = [...new Set(ids.filter((x): x is string => Boolean(x)))];
    if (!list.length) return new Map();
    const rows = await this.db.tx
      .selectFrom('users as u')
      .leftJoin('employees as e', 'e.id', 'u.employee_id')
      .select(['u.id', 'u.email', 'e.full_name_en'])
      .where('u.id', 'in', list)
      .execute();
    return new Map(rows.map((r) => [r.id, r.full_name_en ?? r.email]));
  }
}
