/**
 * Punch review (attendance misuse review, 2026-10-17). A browser cannot prove where a
 * phone is, so HR looks at patterns instead. Four rules, over phone and web punches
 * and refused phone attempts in a date range:
 *
 *   repeated_coordinates  the same coordinates to the last decimal on 2+ days
 *                         (real GPS always moves a little; a fake location does not)
 *   impossible_travel     two locations of the same person further apart than a car
 *                         could go in the time between (> 120 km/h, at least 1 km)
 *   many_refused          3+ refused phone punches (outside the area, weak GPS,
 *                         unknown phone) in the range
 *   shared_ip             punches of 2+ different employees from one IP within 10
 *                         minutes (one phone or computer punching for others)
 *
 * A finding is a reason to look, not proof (an office Wi-Fi is one IP for everyone:
 * shared_ip on the office network is normal and is shown separately as "office").
 * Locations are blanked after the retention period, so the review covers recent months.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { businessDate } from '../../platform/dates/business-date.js';
import { DatabaseService } from '../../platform/db/database.service.js';
import { OrgLookupService } from '../org/org-lookup.service.js';
import { AttendanceService } from './attendance.service.js';
import { distanceMetres } from './day-status.js';

const IMPOSSIBLE_KMH = 120;
const MIN_TRAVEL_M = 1000;
const TRAVEL_WINDOW_MIN = 120;
const REFUSED_THRESHOLD = 3;
const SHARED_IP_WINDOW_MIN = 10;

interface Point {
  employeeId: string;
  at: Date;
  lat: number;
  lng: number;
  kind: 'punch' | 'refused';
}

@Injectable()
export class PunchReviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly org: OrgLookupService,
    private readonly attendance: AttendanceService,
  ) {}

  async review(companyId: string, from: string, to: string) {
    await this.org.assertCompanyExists(companyId);
    const scope = this.attendance.viewScope(companyId);
    if (businessDate(to) < businessDate(from))
      throw new BadRequestException('to must be on or after from');
    const start = new Date(`${from}T00:00:00+06:00`);
    const end = new Date(`${to}T23:59:59.999+06:00`);

    // the people in scope (a Dept Head: those placed in the department in the range)
    let people = this.db.tx
      .selectFrom('employees as e')
      .select(['e.id', 'e.employee_code', 'e.full_name_en'])
      .where('e.company_id', '=', companyId);
    if (!scope.all) {
      people = people.where((eb) =>
        eb.exists(
          eb
            .selectFrom('attendance_days as d')
            .select('d.id')
            .whereRef('d.employee_id', '=', 'e.id')
            .where('d.department_id', 'in', scope.departmentIds)
            .where('d.work_date', '>=', from)
            .where('d.work_date', '<=', to),
        ),
      );
    }
    const employees = await people.execute();
    const ids = employees.map((e) => e.id);
    const who = new Map(
      employees.map((e) => [
        e.id,
        { id: e.id, code: e.employee_code, name: e.full_name_en },
      ]),
    );
    if (!ids.length) return { from, to, findings: [], totals: {} };

    const punches = await this.db.tx
      .selectFrom('attendance_punches')
      .select([
        'employee_id',
        'punched_at',
        'source',
        'latitude',
        'longitude',
        'accuracy_m',
        'ip',
      ])
      .where('employee_id', 'in', ids)
      .where('source', 'in', ['mobile', 'web'])
      .where('punched_at', '>=', start)
      .where('punched_at', '<=', end)
      .orderBy('punched_at')
      .execute();
    const attempts = await this.db.tx
      .selectFrom('punch_attempts')
      .select([
        'employee_id',
        'attempted_at',
        'outcome',
        'latitude',
        'longitude',
        'distance_m',
        'ip',
      ])
      .where('employee_id', 'in', ids)
      .where('attempted_at', '>=', start)
      .where('attempted_at', '<=', end)
      .orderBy('attempted_at')
      .execute();

    const findings: Array<{
      rule: string;
      employee: { id: string; code: string; name: string };
      at: string;
      detail: Record<string, unknown>;
    }> = [];
    const day = (d: Date) =>
      new Date(d.getTime() + 6 * 3600_000).toISOString().slice(0, 10);

    // 1. the same coordinates to the last decimal on two or more days
    const byPlace = new Map<string, Set<string>>();
    for (const p of punches) {
      if (p.source !== 'mobile' || p.latitude === null || p.longitude === null)
        continue;
      const key = `${p.employee_id}|${p.latitude}|${p.longitude}`;
      byPlace.set(key, (byPlace.get(key) ?? new Set()).add(day(p.punched_at)));
    }
    for (const [key, days] of byPlace) {
      if (days.size < 2) continue;
      const [employeeId, lat, lng] = key.split('|');
      const dates = [...days].sort();
      findings.push({
        rule: 'repeated_coordinates',
        employee: who.get(employeeId)!,
        at: dates[0],
        detail: { latitude: Number(lat), longitude: Number(lng), days: dates },
      });
    }

    // 2. impossible travel between two locations of the same person
    const points: Point[] = [
      ...punches
        .filter((p) => p.latitude !== null && p.longitude !== null)
        .map((p) => ({
          employeeId: p.employee_id,
          at: p.punched_at,
          lat: p.latitude!,
          lng: p.longitude!,
          kind: 'punch' as const,
        })),
      ...attempts
        .filter((a) => a.latitude !== null && a.longitude !== null)
        .map((a) => ({
          employeeId: a.employee_id,
          at: a.attempted_at,
          lat: a.latitude!,
          lng: a.longitude!,
          kind: 'refused' as const,
        })),
    ].sort(
      (a, b) =>
        a.employeeId.localeCompare(b.employeeId) ||
        a.at.getTime() - b.at.getTime(),
    );
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (a.employeeId !== b.employeeId) continue;
      const minutes = (b.at.getTime() - a.at.getTime()) / 60_000;
      if (minutes > TRAVEL_WINDOW_MIN) continue;
      const metres = distanceMetres(a.lat, a.lng, b.lat, b.lng);
      const kmh = metres / 1000 / Math.max(minutes / 60, 1 / 60);
      if (metres >= MIN_TRAVEL_M && kmh > IMPOSSIBLE_KMH) {
        findings.push({
          rule: 'impossible_travel',
          employee: who.get(b.employeeId)!,
          at: b.at.toISOString(),
          detail: {
            fromAt: a.at.toISOString(),
            fromKind: a.kind,
            toKind: b.kind,
            distanceM: metres,
            minutes: Math.round(minutes),
            kmh: Math.round(kmh),
          },
        });
      }
    }

    // 3. many refused phone punches
    const refused = new Map<string, Record<string, number>>();
    for (const a of attempts) {
      const counts = refused.get(a.employee_id) ?? {};
      counts[a.outcome] = (counts[a.outcome] ?? 0) + 1;
      refused.set(a.employee_id, counts);
    }
    for (const [employeeId, counts] of refused) {
      const total = Object.values(counts).reduce((n, c) => n + c, 0);
      if (total >= REFUSED_THRESHOLD) {
        const last = attempts
          .filter((a) => a.employee_id === employeeId)
          .at(-1)!;
        findings.push({
          rule: 'many_refused',
          employee: who.get(employeeId)!,
          at: last.attempted_at.toISOString(),
          detail: { total, ...counts },
        });
      }
    }

    // 4. one IP punching for several employees within minutes
    const byIp = new Map<string, typeof punches>();
    for (const p of punches)
      if (p.ip) byIp.set(p.ip, [...(byIp.get(p.ip) ?? []), p]);
    for (const [ip, list] of byIp) {
      for (let i = 0; i < list.length; i++) {
        const window = list.filter(
          (q) =>
            Math.abs(q.punched_at.getTime() - list[i].punched_at.getTime()) <=
            SHARED_IP_WINDOW_MIN * 60_000,
        );
        const others = [...new Set(window.map((q) => q.employee_id))];
        if (others.length < 2) continue;
        const employeeId = list[i].employee_id;
        if (
          findings.some(
            (f) =>
              f.rule === 'shared_ip' &&
              f.employee.id === employeeId &&
              f.detail.ip === ip &&
              f.at.slice(0, 10) ===
                list[i].punched_at.toISOString().slice(0, 10),
          )
        )
          continue;
        findings.push({
          rule: 'shared_ip',
          employee: who.get(employeeId)!,
          at: list[i].punched_at.toISOString(),
          detail: {
            ip,
            withEmployees: others
              .filter((o) => o !== employeeId)
              .map((o) => who.get(o)?.code ?? o),
            source: list[i].source,
          },
        });
      }
    }

    findings.sort(
      (a, b) => a.rule.localeCompare(b.rule) || b.at.localeCompare(a.at),
    );
    const totals: Record<string, number> = {};
    for (const f of findings) totals[f.rule] = (totals[f.rule] ?? 0) + 1;
    return {
      from,
      to,
      findings,
      totals,
      refusedAttempts: attempts.length,
      phonePunches: punches.filter((p) => p.source === 'mobile').length,
    };
  }
}
