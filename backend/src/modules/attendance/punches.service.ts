/**
 * Punches (guide §10 rules 1-3). Raw punches are stored once and never edited;
 * every punch recomputes the affected attendance day(s).
 *
 *   mobile  employee's own approved phone, inside the branch geo-fence;
 *           the SERVER clock is the punch time (the phone's clock is not trusted).
 *           A browser cannot prove its location (fake GPS, location override), so
 *           a reading worse than 100 m is refused, the allowance outside the fence
 *           follows the reported accuracy (at most 50 m), accuracy / IP / browser
 *           are stored with the punch, and every refused attempt is recorded for
 *           HR's punch review (misuse review 2026-10-17).
 *   web     only for employees marked "web punch allowed" (approved remote staff)
 *   device  batches from the office biometric sync agent (service key). Duplicates
 *           are dropped by the unique index, so an agent may resend safely; old
 *           punches after an outage are simply processed late ("catch up").
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Insertable } from 'kysely';
import { AuditService } from '../../platform/audit/audit.service.js';
import { Clock } from '../../platform/clock.js';
import { toBusinessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import type { PunchAttemptsTable } from '../../platform/db/schema.js';
import { MSG } from '../../platform/i18n/messages.js';
import { requestContext } from '../../platform/tenancy/request-context.js';
import { EmployeeDirectory } from '../employees/employee-directory.service.js';
import { AccessService } from '../identity/access/access.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { AttendanceComputeService } from './attendance-compute.service.js';
import { ConsentsService } from './consents.service.js';
import { distanceMetres } from './day-status.js';
import type {
  DeviceBatchDto,
  MobilePunchDto,
  ReasonDto,
  RegisterDeviceDto,
} from './dto/attendance.dto.js';

/** At most this many metres are allowed outside the fence radius (GPS error on phones). */
export const GEOFENCE_TOLERANCE_M = 50;
/** A phone reading less accurate than this is refused ("step near a window"). */
export const MAX_GPS_ACCURACY_M = 100;
/** Device clock drift above this is reported back to the agent and on the device. */
export const CLOCK_DRIFT_WARNING_SECONDS = 300;

@Injectable()
export class PunchesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly access: AccessService,
    private readonly employees: EmployeeDirectory,
    private readonly org: OrgLookupService,
    private readonly compute: AttendanceComputeService,
    private readonly consents: ConsentsService,
  ) {}

  // ------------------------------------------------------------- phones

  /** An employee registers the phone they will punch with; HR approves it. */
  async registerOwnDevice(dto: RegisterDeviceDto) {
    const employeeId = this.ownEmployeeId();
    this.access.assert('attendance.own', { employeeId });
    // phone punches send the location: consent first (spec §11)
    await this.consents.require(employeeId, 'location_attendance');

    const device = await this.db.tx
      .insertInto('employee_devices')
      .values({
        employee_id: employeeId,
        device_id: dto.deviceId,
        name: dto.name.trim(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'attendance.device_registered',
      entity: 'employee',
      entityId: employeeId,
      after: { deviceId: dto.deviceId, name: dto.name },
    });
    return toDeviceResponse(device);
  }

  async listOwnDevices() {
    const employeeId = this.ownEmployeeId();
    const rows = await this.db.tx
      .selectFrom('employee_devices')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map(toDeviceResponse);
  }

  /** HR: phones waiting for approval (or all), within HR's scope. */
  async listDevices(status?: 'pending' | 'active' | 'revoked') {
    let q = this.db.tx
      .selectFrom('employee_devices as d')
      .innerJoin('employees as e', 'e.id', 'd.employee_id')
      .select([
        'd.id',
        'd.employee_id',
        'd.device_id',
        'd.name',
        'd.status',
        'd.created_at',
        'd.approved_at',
        'e.employee_code',
        'e.full_name_en',
        'e.company_id',
      ]);
    if (status) q = q.where('d.status', '=', status);
    const rows = await q.orderBy('d.created_at', 'desc').limit(500).execute();
    return rows
      .filter((r) =>
        this.access.allows('attendance.manage', {
          companyId: r.company_id,
          employeeId: r.employee_id,
        }),
      )
      .map((r) => ({
        id: r.id,
        employeeId: r.employee_id,
        employeeCode: r.employee_code,
        employeeName: r.full_name_en,
        deviceId: r.device_id,
        name: r.name,
        status: r.status,
        registeredAt: r.created_at,
        approvedAt: r.approved_at,
      }));
  }

  /** Approving a phone replaces the employee's previous one. */
  async approveDevice(id: string) {
    const device = await this.findDevice(id);
    await this.assertManages(device.employee_id);
    if (device.status !== 'pending')
      throw new ConflictException('Only a pending device can be approved');

    await this.db.tx
      .updateTable('employee_devices')
      .set({
        status: 'revoked',
        revoked_reason: 'Replaced by a newly approved device',
      })
      .where('employee_id', '=', device.employee_id)
      .where('status', '=', 'active')
      .execute();
    const approved = await this.db.tx
      .updateTable('employee_devices')
      .set({
        status: 'active',
        approved_by: requestContext.get().userId ?? null,
        approved_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'attendance.device_approved',
      entity: 'employee',
      entityId: device.employee_id,
      after: { deviceId: device.device_id },
    });
    return toDeviceResponse(approved);
  }

  async revokeDevice(id: string, dto: ReasonDto) {
    const device = await this.findDevice(id);
    await this.assertManages(device.employee_id);
    const revoked = await this.db.tx
      .updateTable('employee_devices')
      .set({ status: 'revoked', revoked_reason: dto.reason })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    await this.audit.record({
      action: 'attendance.device_revoked',
      entity: 'employee',
      entityId: device.employee_id,
      after: { deviceId: device.device_id, reason: dto.reason },
    });
    return toDeviceResponse(revoked);
  }

  // ------------------------------------------------------------- punches

  async mobilePunch(dto: MobilePunchDto) {
    const employeeId = this.ownEmployeeId();
    this.access.assert('attendance.own', { employeeId });
    const now = this.clock.now();

    // location consent still in force (it can be withdrawn after the phone was approved)
    await this.consents.require(employeeId, 'location_attendance');

    // what the phone and the network said (evidence for the punch review)
    const accuracy = Math.round(dto.accuracy);
    const ctx = requestContext.get();
    const seen = {
      employee_id: employeeId,
      device_ref: dto.deviceId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracy_m: accuracy,
      ip: ctx.ip ?? null,
      user_agent: ctx.device ?? null,
    };

    // this employee's approved phone?
    const device = await this.db.tx
      .selectFrom('employee_devices')
      .select('id')
      .where('employee_id', '=', employeeId)
      .where('device_id', '=', dto.deviceId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!device) {
      await this.recordAttempt({ ...seen, outcome: 'unknown_device' });
      throw new ForbiddenException(MSG.ATTENDANCE_DEVICE_NOT_REGISTERED);
    }

    // inside today's branch geo-fence, with a usable GPS reading?
    const placement = await this.employees.placementOn(
      employeeId,
      toBusinessDate(now),
    );
    if (!placement) throw new BadRequestException(MSG.ATTENDANCE_NOT_EMPLOYED);
    const branch = await this.org.branchInfo(placement.branchId);
    if (!branch.geoFence) {
      await this.recordAttempt({
        ...seen,
        outcome: 'no_geofence',
        branch_id: branch.id,
      });
      throw new BadRequestException(MSG.ATTENDANCE_GEOFENCE_NOT_SET);
    }
    const distance = distanceMetres(
      dto.latitude,
      dto.longitude,
      branch.geoFence.lat,
      branch.geoFence.lng,
    );
    if (accuracy > MAX_GPS_ACCURACY_M) {
      await this.recordAttempt({
        ...seen,
        outcome: 'weak_gps',
        branch_id: branch.id,
        distance_m: distance,
      });
      throw new BadRequestException({
        message: MSG.ATTENDANCE_WEAK_GPS,
        details: { accuracyM: accuracy, neededM: MAX_GPS_ACCURACY_M },
      });
    }
    // the reading may be off by its accuracy: allow that much outside the fence, at most 50 m
    const allowedM =
      branch.geoFence.radiusM + Math.min(accuracy, GEOFENCE_TOLERANCE_M);
    if (distance > allowedM) {
      await this.recordAttempt({
        ...seen,
        outcome: 'outside_area',
        branch_id: branch.id,
        distance_m: distance,
      });
      throw new ForbiddenException({
        message: MSG.ATTENDANCE_OUTSIDE_GEOFENCE,
        details: { distanceM: distance, allowedM, branch: branch.name },
      });
    }

    // save and recompute
    await this.insertPunch({
      ...seen,
      punched_at: now,
      source: 'mobile',
      distance_m: distance,
    });
    await this.compute.recomputeForPunches(employeeId, [now], 'punch');
    return {
      punchedAt: now,
      source: 'mobile',
      distanceM: distance,
      today: await this.dayOf(employeeId, toBusinessDate(now)),
    };
  }

  async webPunch() {
    const employeeId = this.ownEmployeeId();
    this.access.assert('attendance.own', { employeeId });
    const profile = await this.db.tx
      .selectFrom('attendance_profiles')
      .select('web_punch_allowed')
      .where('employee_id', '=', employeeId)
      .executeTakeFirst();
    if (!profile?.web_punch_allowed)
      throw new ForbiddenException(MSG.ATTENDANCE_WEB_PUNCH_NOT_ALLOWED);

    const now = this.clock.now();
    const ctx = requestContext.get();
    await this.insertPunch({
      employee_id: employeeId,
      punched_at: now,
      source: 'web',
      device_ref: 'web',
      ip: ctx.ip ?? null,
      user_agent: ctx.device ?? null,
    });
    await this.compute.recomputeForPunches(employeeId, [now], 'punch');
    return {
      punchedAt: now,
      source: 'web',
      today: await this.dayOf(employeeId, toBusinessDate(now)),
    };
  }

  /** Upload from the office sync agent (service key with attendance.ingest). */
  async deviceBatch(dto: DeviceBatchDto) {
    const now = this.clock.now();

    // the branch must be in the key's company
    const branch = await this.org.branchInfo(dto.branchId);
    this.access.assert('attendance.ingest', { companyId: branch.companyId });

    // device record and clock drift (positive = device clock is behind)
    const driftSeconds = Math.round(
      (now.getTime() - new Date(dto.deviceTime).getTime()) / 1000,
    );
    await this.db.tx
      .insertInto('attendance_devices')
      .values({
        company_id: branch.companyId,
        branch_id: dto.branchId,
        serial: dto.deviceSerial,
        brand: dto.brand ?? null,
        last_seen_at: now,
        last_clock_drift_seconds: driftSeconds,
      })
      .onConflict((oc) =>
        oc.columns(['tenant_id', 'serial']).doUpdateSet({
          last_seen_at: now,
          last_clock_drift_seconds: driftSeconds,
          branch_id: dto.branchId,
        }),
      )
      .execute();

    // device user numbers -> employees of the company
    const userIds = [...new Set(dto.punches.map((p) => p.deviceUserId))];
    const profiles = await this.db.tx
      .selectFrom('attendance_profiles')
      .select(['device_user_id', 'employee_id'])
      .where('company_id', '=', branch.companyId)
      .where('device_user_id', 'in', userIds)
      .execute();
    const employeeOf = new Map(
      profiles.map((p) => [p.device_user_id!, p.employee_id]),
    );
    // biometric data only for people who consented (spec §11); others are counted, not stored
    const consented = await this.consents.consented(
      [...new Set(employeeOf.values())],
      'biometric_attendance',
    );
    let noConsent = 0;

    // store; duplicates (same employee, time, device) are skipped by the unique index
    let inserted = 0;
    let known = 0;
    const unknownUsers = new Set<string>();
    const touched = new Map<string, Date[]>();
    for (const p of dto.punches) {
      const employeeId = employeeOf.get(p.deviceUserId);
      if (!employeeId) {
        unknownUsers.add(p.deviceUserId);
        continue;
      }
      if (!consented.has(employeeId)) {
        noConsent++;
        continue;
      }
      known++;
      const at = new Date(p.punchedAt);
      const added = await this.insertPunch({
        employee_id: employeeId,
        punched_at: at,
        source: 'device',
        device_ref: dto.deviceSerial,
        raw_ref: JSON.stringify({
          deviceUserId: p.deviceUserId,
          punchedAt: p.punchedAt,
        }),
      });
      if (added) {
        inserted++;
        touched.set(employeeId, [...(touched.get(employeeId) ?? []), at]);
      }
    }

    // recompute the days the new punches belong to (old ones too: catch-up after an outage)
    for (const [employeeId, instants] of touched)
      await this.compute.recomputeForPunches(
        employeeId,
        instants,
        'device_upload',
      );

    return {
      received: dto.punches.length,
      inserted,
      duplicates: known - inserted,
      noConsent,
      unknownDeviceUsers: [...unknownUsers].sort(),
      clockDriftSeconds: driftSeconds,
      clockWarning:
        Math.abs(driftSeconds) > CLOCK_DRIFT_WARNING_SECONDS
          ? 'Device clock differs from server time by more than 5 minutes; please correct it'
          : null,
    };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * A refused phone punch, kept for the punch review. Written in its own short
   * transaction: the refusal itself rolls back the request's transaction.
   */
  private async recordAttempt(values: Insertable<PunchAttemptsTable>) {
    const { tx: _open, ...ctx } = requestContext.get();
    const row = {
      ...values,
      attempted_at: values.attempted_at ?? this.clock.now(),
    };
    await requestContext.run(ctx, () =>
      this.db.withTenant(ctx, () =>
        this.db.tx.insertInto('punch_attempts').values(row).execute(),
      ),
    );
  }

  /** Insert one punch; false if it was a duplicate. */
  private async insertPunch(values: {
    employee_id: string;
    punched_at: Date;
    source: 'device' | 'mobile' | 'web' | 'correction';
    device_ref: string;
    latitude?: number;
    longitude?: number;
    distance_m?: number;
    accuracy_m?: number;
    ip?: string | null;
    user_agent?: string | null;
    raw_ref?: string;
  }): Promise<boolean> {
    const row = await this.db.tx
      .insertInto('attendance_punches')
      .values(values)
      .onConflict((oc) =>
        oc
          .columns([
            'tenant_id',
            'employee_id',
            'punched_at',
            'source',
            'device_ref',
          ])
          .doNothing(),
      )
      .returning('id')
      .executeTakeFirst();
    return row !== undefined;
  }

  private async dayOf(employeeId: string, date: string) {
    const day = await this.db.tx
      .selectFrom('attendance_days')
      .selectAll()
      .where('employee_id', '=', employeeId)
      .where('work_date', '=', date)
      .executeTakeFirst();
    return day
      ? {
          date: day.work_date,
          status: day.status,
          firstIn: day.first_in,
          lastOut: day.last_out,
          lateMinutes: day.late_minutes,
        }
      : null;
  }

  private ownEmployeeId(): string {
    const employeeId = this.access.current().employeeId;
    if (!employeeId) throw new NotFoundException(MSG.EMPLOYEE_NOT_FOUND);
    return employeeId;
  }

  private async findDevice(id: string) {
    const device = await this.db.tx
      .selectFrom('employee_devices')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!device) throw new NotFoundException(MSG.DEVICE_NOT_FOUND);
    return device;
  }

  private async assertManages(employeeId: string): Promise<void> {
    const companyId = await this.employees.companyOf(employeeId);
    this.access.assert('attendance.manage', { companyId, employeeId });
  }
}

function toDeviceResponse(d: {
  id: string;
  employee_id: string;
  device_id: string;
  name: string;
  status: string;
  approved_at: Date | null;
  revoked_reason: string | null;
  created_at: Date;
}) {
  return {
    id: d.id,
    employeeId: d.employee_id,
    deviceId: d.device_id,
    name: d.name,
    status: d.status,
    registeredAt: d.created_at,
    approvedAt: d.approved_at,
    revokedReason: d.revoked_reason,
  };
}
