/**
 * Job history: transfers, promotions, designation/grade/manager changes
 * (spec §6.1 "Changes", guide §5 rule 4 "History is effective-dated").
 *
 *   employee_job_events   every decision, as recorded (never edited; cancel with a reason)
 *   employee_assignments  the timeline, rebuilt from the active events by buildTimeline()
 *
 * Back-dated changes are allowed; payroll (WP6) will turn changes inside an
 * already-paid month into arrears.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../platform/audit/audit.service.js';
import {
  businessDate,
  todayInDhaka,
  type BusinessDate,
} from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { Employee, EmployeeJobEvent } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import type {
  CancelJobEventDto,
  CreateJobEventDto,
} from './dto/job-event.dto.js';
import { EmployeeAccess } from './employee-access.js';
import {
  buildTimeline,
  placementOn,
  sameTimeline,
  TimelineError,
  type PlacementChanges,
  type TimelineSegment,
} from './job-timeline.js';

@Injectable()
export class JobHistoryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly org: OrgLookupService,
    private readonly employeeAccess: EmployeeAccess,
  ) {}

  /** Called by EmployeesService when an employee is created. */
  async recordJoining(
    employee: Employee,
    changes: PlacementChanges,
  ): Promise<void> {
    await this.checkManagers(employee, changes);
    await this.db.tx
      .insertInto('employee_job_events')
      .values({
        employee_id: employee.id,
        effective_from: employee.join_date,
        event_type: 'joining',
        changes: JSON.stringify(changes),
        reason: 'Joining',
      })
      .execute();
    await this.rebuildTimeline(employee);
  }

  /**
   * Called by EmployeesService when a draft employee's joining date changes:
   * moves the joining event and rebuilds the timeline.
   */
  async moveJoiningDate(
    employee: Employee,
    newJoinDate: BusinessDate,
  ): Promise<void> {
    // no other change may start before the new joining date
    const earlier = await this.db.tx
      .selectFrom('employee_job_events')
      .select('id')
      .where('employee_id', '=', employee.id)
      .where('status', '=', 'active')
      .where('event_type', '<>', 'joining')
      .where('effective_from', '<', newJoinDate)
      .executeTakeFirst();
    if (earlier) throw new BadRequestException(MSG.JOB_EVENT_BEFORE_JOINING);

    await this.db.tx
      .updateTable('employee_job_events')
      .set({ effective_from: newJoinDate })
      .where('employee_id', '=', employee.id)
      .where('event_type', '=', 'joining')
      .where('status', '=', 'active')
      .execute();
    await this.rebuildTimeline({ ...employee, join_date: newJoinDate });
  }

  /** Record a transfer / promotion / other change. */
  async createJobEvent(employeeId: string, dto: CreateJobEventDto) {
    // find employee and check access
    const employee = await this.employeeAccess.check(
      'employee.manage',
      employeeId,
    );
    if (employee.status === 'separated')
      throw new BadRequestException('Employee is separated');

    // the change cannot start before joining
    const effectiveFrom = businessDate(dto.effectiveFrom);
    if (effectiveFrom < employee.join_date)
      throw new BadRequestException(MSG.JOB_EVENT_BEFORE_JOINING);

    // collect what changes; check org records and managers
    const changes = changesFromDto(dto);
    if (Object.keys(changes).length === 0)
      throw new BadRequestException(MSG.JOB_EVENT_NO_CHANGES);
    await this.org.assertPlacement(employee.company_id, {
      branchId: dto.branchId,
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      gradeId: dto.gradeId,
    });
    await this.checkManagers(employee, changes);

    // save the event and rebuild the timeline
    const before = await this.loadTimeline(employeeId);
    const event = await this.db.tx
      .insertInto('employee_job_events')
      .values({
        employee_id: employeeId,
        effective_from: effectiveFrom,
        event_type: dto.type,
        changes: JSON.stringify(changes),
        reason: dto.reason ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const after = await this.rebuildTimeline(employee);

    // a change that changes nothing is refused (the transaction rolls back)
    if (sameTimeline(before, after))
      throw new BadRequestException(MSG.JOB_EVENT_NO_CHANGES);

    await this.audit.record({
      action: `employee.${dto.type}`,
      entity: 'employee',
      entityId: employeeId,
      after: {
        eventId: event.id,
        effectiveFrom,
        changes,
        reason: dto.reason ?? null,
        backDated: effectiveFrom < todayInDhaka(),
      },
    });
    return {
      event: toJobEventResponse(event),
      assignments: await this.describeTimeline(after),
    };
  }

  /** Cancel a wrongly recorded change. The event stays visible as cancelled. */
  async cancelJobEvent(
    employeeId: string,
    eventId: string,
    dto: CancelJobEventDto,
  ) {
    // find employee (check access) and event
    const employee = await this.employeeAccess.check(
      'employee.manage',
      employeeId,
    );
    const event = await this.db.tx
      .selectFrom('employee_job_events')
      .selectAll()
      .where('id', '=', eventId)
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    if (!event) throw new NotFoundException(MSG.JOB_EVENT_NOT_FOUND);
    if (event.event_type === 'joining')
      throw new BadRequestException(MSG.JOINING_EVENT_CANNOT_CANCEL);
    if (event.status === 'cancelled')
      throw new ConflictException(MSG.JOB_EVENT_ALREADY_CANCELLED);

    // cancel and rebuild
    const cancelled = await this.db.tx
      .updateTable('employee_job_events')
      .set({
        status: 'cancelled',
        cancelled_reason: dto.reason,
        cancelled_at: new Date(),
        cancelled_by: requestContext.get().userId ?? null,
      })
      .where('id', '=', eventId)
      .returningAll()
      .executeTakeFirstOrThrow();
    const timeline = await this.rebuildTimeline(employee);

    await this.audit.record({
      action: 'employee.job_event_cancelled',
      entity: 'employee',
      entityId: employeeId,
      after: { eventId, reason: dto.reason },
    });
    return {
      event: toJobEventResponse(cancelled),
      assignments: await this.describeTimeline(timeline),
    };
  }

  /** All recorded changes, oldest effective date first (cancelled ones included). */
  async listJobEvents(employeeId: string) {
    await this.employeeAccess.check('employee.view', employeeId);
    const events = await this.db.tx
      .selectFrom('employee_job_events')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('effective_from')
      .orderBy('seq')
      .execute();
    return events.map(toJobEventResponse);
  }

  /** The assignment timeline, or only the period in force on `asOf`. */
  async getAssignments(employeeId: string, asOf?: string) {
    await this.employeeAccess.check('employee.view', employeeId);
    const timeline = await this.loadTimeline(employeeId);
    if (!asOf) return this.describeTimeline(timeline);
    const segment = placementOn(timeline, businessDate(asOf));
    return segment ? (await this.describeTimeline([segment]))[0] : null;
  }

  /** Current placements (today) of many employees, for lists. */
  async currentPlacements(employeeIds: string[]) {
    if (employeeIds.length === 0)
      return new Map<string, ReturnType<typeof toPlacementView>>();
    const today = todayInDhaka();
    const rows = await this.db.tx
      .selectFrom('employee_assignments')
      .selectAll()
      .where('employee_id', 'in', employeeIds)
      .where('effective_from', '<=', today)
      .where((eb) =>
        eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', today)]),
      )
      .execute();
    const segments = rows.map(rowToSegment);
    const described = await this.describeTimeline(segments);
    return new Map(rows.map((r, i) => [r.employee_id, described[i]]));
  }

  // ------------------------------------------------------------------ helpers

  /** Recompute employee_assignments from the active events. Returns the new timeline. */
  private async rebuildTimeline(
    employee: Employee,
  ): Promise<TimelineSegment[]> {
    const events = await this.db.tx
      .selectFrom('employee_job_events')
      .select(['id', 'seq', 'effective_from', 'changes'])
      .where('employee_id', '=', employee.id)
      .where('status', '=', 'active')
      .execute();

    let timeline: TimelineSegment[];
    try {
      timeline = buildTimeline(
        events.map((e) => ({
          id: e.id,
          seq: e.seq,
          effectiveFrom: e.effective_from as BusinessDate,
          changes: e.changes as PlacementChanges,
        })),
      );
    } catch (err) {
      if (err instanceof TimelineError)
        throw new BadRequestException(err.message);
      throw err;
    }

    await this.db.tx
      .deleteFrom('employee_assignments')
      .where('employee_id', '=', employee.id)
      .execute();
    await this.db.tx
      .insertInto('employee_assignments')
      .values(
        timeline.map((s) => ({
          employee_id: employee.id,
          company_id: employee.company_id,
          effective_from: s.effectiveFrom,
          effective_to: s.effectiveTo,
          branch_id: s.branch_id!,
          department_id: s.department_id!,
          designation_id: s.designation_id!,
          grade_id: s.grade_id!,
          line_manager_id: s.line_manager_id,
          functional_manager_id: s.functional_manager_id,
          source_event_id: s.sourceEventId,
        })),
      )
      .execute();
    return timeline;
  }

  private async loadTimeline(employeeId: string): Promise<TimelineSegment[]> {
    const rows = await this.db.tx
      .selectFrom('employee_assignments')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('effective_from')
      .execute();
    return rows.map(rowToSegment);
  }

  /**
   * Managers must be other employees of the same company who have not left.
   * (Loops such as A manages B and B manages A are guarded in the approval engine, WP2.)
   */
  private async checkManagers(
    employee: Employee,
    changes: PlacementChanges,
  ): Promise<void> {
    for (const managerId of [
      changes.line_manager_id,
      changes.functional_manager_id,
    ]) {
      if (!managerId) continue;
      if (managerId === employee.id)
        throw new BadRequestException(MSG.MANAGER_INVALID);
      const manager = await this.db.tx
        .selectFrom('employees')
        .select(['company_id', 'status'])
        .where('id', '=', managerId)
        .executeTakeFirst();
      if (
        !manager ||
        manager.company_id !== employee.company_id ||
        manager.status === 'separated'
      ) {
        throw new BadRequestException(MSG.MANAGER_INVALID);
      }
    }
  }

  /** Adds names of branch, department, designation, grade and managers to each period. */
  private async describeTimeline(segments: TimelineSegment[]) {
    const names = await this.org.names({
      branchIds: segments.map((s) => s.branch_id!),
      departmentIds: segments.map((s) => s.department_id!),
      designationIds: segments.map((s) => s.designation_id!),
      gradeIds: segments.map((s) => s.grade_id!),
    });
    const managerIds = [
      ...new Set(
        segments
          .flatMap((s) => [s.line_manager_id, s.functional_manager_id])
          .filter((x): x is string => !!x),
      ),
    ];
    const managers = managerIds.length
      ? await this.db.tx
          .selectFrom('employees')
          .select(['id', 'employee_code', 'full_name_en'])
          .where('id', 'in', managerIds)
          .execute()
      : [];
    const managerById = new Map(
      managers.map((m) => [
        m.id,
        { id: m.id, employeeCode: m.employee_code, fullNameEn: m.full_name_en },
      ]),
    );

    return segments.map((s) => toPlacementView(s, names, managerById));
  }
}

function changesFromDto(dto: CreateJobEventDto): PlacementChanges {
  const changes: PlacementChanges = {};
  if (dto.branchId !== undefined) changes.branch_id = dto.branchId;
  if (dto.departmentId !== undefined) changes.department_id = dto.departmentId;
  if (dto.designationId !== undefined)
    changes.designation_id = dto.designationId;
  if (dto.gradeId !== undefined) changes.grade_id = dto.gradeId;
  if (dto.lineManagerId !== undefined)
    changes.line_manager_id = dto.lineManagerId;
  if (dto.functionalManagerId !== undefined)
    changes.functional_manager_id = dto.functionalManagerId;
  return changes;
}

function rowToSegment(r: {
  effective_from: string;
  effective_to: string | null;
  branch_id: string;
  department_id: string;
  designation_id: string;
  grade_id: string;
  line_manager_id: string | null;
  functional_manager_id: string | null;
  source_event_id: string;
}): TimelineSegment {
  return {
    effectiveFrom: r.effective_from as BusinessDate,
    effectiveTo: r.effective_to as BusinessDate | null,
    branch_id: r.branch_id,
    department_id: r.department_id,
    designation_id: r.designation_id,
    grade_id: r.grade_id,
    line_manager_id: r.line_manager_id,
    functional_manager_id: r.functional_manager_id,
    sourceEventId: r.source_event_id,
  };
}

type ManagerView = { id: string; employeeCode: string; fullNameEn: string };

function toPlacementView(
  s: TimelineSegment,
  names: Awaited<ReturnType<OrgLookupService['names']>>,
  managers: Map<string, ManagerView>,
) {
  return {
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo, // exclusive; null = current
    branch: { id: s.branch_id, ...names.branches.get(s.branch_id!) },
    department: {
      id: s.department_id,
      ...names.departments.get(s.department_id!),
    },
    designation: {
      id: s.designation_id,
      ...names.designations.get(s.designation_id!),
    },
    grade: { id: s.grade_id, ...names.grades.get(s.grade_id!) },
    lineManager: s.line_manager_id
      ? (managers.get(s.line_manager_id) ?? { id: s.line_manager_id })
      : null,
    functionalManager: s.functional_manager_id
      ? (managers.get(s.functional_manager_id) ?? {
          id: s.functional_manager_id,
        })
      : null,
    sourceEventId: s.sourceEventId,
  };
}

export function toJobEventResponse(e: EmployeeJobEvent) {
  return {
    id: e.id,
    type: e.event_type,
    effectiveFrom: e.effective_from,
    changes: e.changes,
    reason: e.reason,
    status: e.status,
    cancelledReason: e.cancelled_reason,
    cancelledAt: e.cancelled_at,
    recordedAt: e.created_at,
    recordedBy: e.created_by,
  };
}
