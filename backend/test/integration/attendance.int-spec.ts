/**
 * WP4 attendance through the API, with the Meghna Foods test company
 * (Dhaka HQ, weekend Friday + Saturday). Acceptance criteria (guide §24):
 *   - moving a holiday recomputes unlocked days;
 *   - duplicate punches are ignored;
 *   - an offline agent catches up.
 *
 * The app clock is fixed at Monday 12 Oct 2026, 12:00 Dhaka.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-12T12:00:00+06:00'));
const GULSHAN = { lat: 23.7925, lng: 90.4078 };
const BANANI = { lat: 23.7937, lng: 90.4191 }; // ~1.2 km away

let app: INestApplication;
let co: BdCompany;
let calendarId: string;
let agentKey: string;

/** The office sync agent posting a batch (service key, fresh idempotency key unless given). */
function agentUpload(
  body: object,
  idempotencyKey: string = randomUUID(),
  key = agentKey,
) {
  return request(app.getHttpServer())
    .post('/attendance/device-batches')
    .set('Authorization', key)
    .set('Idempotency-Key', idempotencyKey)
    .send(body);
}

const batch = (
  punches: Array<[string, string]>,
  deviceTime = '2026-10-12T12:00:00+06:00',
) => ({
  deviceSerial: 'ZK-DHK-001',
  branchId: co.branchId,
  brand: 'not decided yet',
  deviceTime,
  punches: punches.map(([deviceUserId, punchedAt]) => ({
    deviceUserId,
    punchedAt,
  })),
});

async function day(employeeId: string, date: string) {
  const res = await co.hr.api
    .get(`/employees/${employeeId}/attendance?from=${date}&to=${date}`)
    .expect(200);
  return res.body.days[0];
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  const c = `/companies/${co.companyId}`;

  // General shift 09:00-18:00, 15 min grace, < 4 h = half day; OT-eligible grade
  await co.hr.api
    .post(`${c}/shifts`, {
      code: 'GEN',
      name: 'General',
      startTime: '09:00',
      endTime: '18:00',
      graceMinutes: 15,
      halfDayMinutes: 240,
      isDefault: true,
    })
    .expect(201);
  const grade = (await co.hr.api.get(`${c}/grades`).expect(200)).body[0];
  await co.hr.api
    .patch(`/grades/${grade.id}`, { otEligible: true, version: grade.version })
    .expect(200);

  // holiday calendar + geo-fence on Dhaka HQ
  calendarId = (
    await co.hr.api
      .post(`${c}/holiday-calendars`, { name: 'Bangladesh 2026' })
      .expect(201)
  ).body.id;
  const branch = (await co.owner.get(`/branches/${co.branchId}`).expect(200))
    .body;
  await co.owner
    .patch(`/branches/${co.branchId}`, {
      holidayCalendarId: calendarId,
      geoLat: GULSHAN.lat,
      geoLng: GULSHAN.lng,
      geoRadiusM: 150,
      version: branch.version,
    })
    .expect(200);

  // biometric user numbers: only after a signed consent form (WP12)
  const refused = await co.hr.api
    .patch(`/employees/${co.rafi.employeeId}/attendance-profile`, {
      deviceUserId: '1006',
    })
    .expect(403);
  expect(refused.body.code).toBe('CONSENT_REQUIRED_BIOMETRIC');
  for (const p of [co.rafi, co.financeOfficer]) {
    await co.hr.api
      .post(`/employees/${p.employeeId}/consents`, {
        purpose: 'biometric_attendance',
        granted: true,
      })
      .expect(201);
  }
  await co.hr.api
    .patch(`/employees/${co.rafi.employeeId}/attendance-profile`, {
      deviceUserId: '1006',
    })
    .expect(200);
  await co.hr.api
    .patch(`/employees/${co.financeOfficer.employeeId}/attendance-profile`, {
      deviceUserId: '1004',
    })
    .expect(200);

  // service key for the Dhaka HQ agent
  agentKey = (
    await co.owner
      .post('/service-keys', {
        name: 'Dhaka HQ biometric agent',
        permissions: ['attendance.ingest'],
        companyId: co.companyId,
      })
      .expect(201)
  ).body.authorizationHeader;
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('device uploads (office sync agent)', () => {
  it('stores punches and computes the day', async () => {
    const res = await agentUpload(
      batch([
        ['1006', '2026-10-11T09:05:00+06:00'],
        ['1006', '2026-10-11T18:02:00+06:00'],
      ]),
    ).expect(200);
    expect(res.body).toMatchObject({ received: 2, inserted: 2, duplicates: 0 });
    expect(await day(co.rafi.employeeId, '2026-10-11')).toMatchObject({
      status: 'present',
      workedMinutes: 537,
      lateMinutes: 0,
    });
  });

  it('acceptance: duplicate punches are ignored (agent resends the same batch)', async () => {
    const res = await agentUpload(
      batch([
        ['1006', '2026-10-11T09:05:00+06:00'],
        ['1006', '2026-10-11T18:02:00+06:00'],
      ]),
    ).expect(200);
    expect(res.body).toMatchObject({ received: 2, inserted: 0, duplicates: 2 });
    const punches = await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .selectFrom('attendance_punches')
        .select('id')
        .where('employee_id', '=', co.rafi.employeeId)
        .where('source', '=', 'device')
        .execute(),
    );
    expect(punches).toHaveLength(2);
  });

  it('the same Idempotency-Key replays the first answer', async () => {
    const key = randomUUID();
    const body = batch([
      ['1004', '2026-10-11T08:58:00+06:00'],
      ['1004', '2026-10-11T17:59:00+06:00'],
    ]);
    const first = await agentUpload(body, key).expect(200);
    const again = await agentUpload(body, key).expect(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
  });

  it('acceptance: an offline agent catches up (old punches fix old days); clock drift is reported', async () => {
    // Thursday 8 Oct: computed while the office internet was down -> absent
    await co.hr.api
      .post('/attendance/recompute', {
        companyId: co.companyId,
        from: '2026-10-08',
        to: '2026-10-08',
      })
      .expect(201);
    expect((await day(co.rafi.employeeId, '2026-10-08')).status).toBe('absent');

    // the agent comes back online and sends Thursday's punches; its clock is 10 minutes behind
    const res = await agentUpload(
      batch(
        [
          ['1006', '2026-10-08T09:40:00+06:00'],
          ['1006', '2026-10-08T18:10:00+06:00'],
        ],
        '2026-10-12T11:50:00+06:00',
      ),
    ).expect(200);
    expect(res.body).toMatchObject({ inserted: 2, clockDriftSeconds: 600 });
    expect(res.body.clockWarning).toMatch(/more than 5 minutes/);
    expect(await day(co.rafi.employeeId, '2026-10-08')).toMatchObject({
      status: 'late',
      lateMinutes: 40,
    });
  });

  it('reports device users it does not know', async () => {
    const res = await agentUpload(
      batch([['9999', '2026-10-11T09:00:00+06:00']]),
    ).expect(200);
    expect(res.body).toMatchObject({
      inserted: 0,
      unknownDeviceUsers: ['9999'],
    });
  });

  it('refuses a wrong or revoked key, and a branch of another company', async () => {
    const [, credential] = agentKey.split(' ');
    const [keyId] = credential.split('.');
    await agentUpload(
      batch([['1006', '2026-10-11T10:00:00+06:00']]),
      randomUUID(),
      `ServiceKey ${keyId}.wrong-secret`,
    ).expect(401);

    const other = (
      await co.owner
        .post('/companies', {
          legalName: `Karnaphuli Shipping ${randomUUID().slice(0, 4)}`,
        })
        .expect(201)
    ).body;
    const otherBranch = (
      await co.owner
        .post(`/companies/${other.id}/branches`, {
          code: 'CTG',
          name: 'Chattogram Port',
        })
        .expect(201)
    ).body;
    await agentUpload({
      ...batch([['1006', '2026-10-11T10:00:00+06:00']]),
      branchId: otherBranch.id,
    }).expect(403);

    const spare = (
      await co.owner
        .post('/service-keys', {
          name: 'Spare',
          permissions: ['attendance.ingest'],
          companyId: co.companyId,
        })
        .expect(201)
    ).body;
    await co.owner
      .post(`/service-keys/${spare.id}/revoke`, { reason: 'Agent PC replaced' })
      .expect(200);
    await agentUpload(
      batch([['1006', '2026-10-11T10:00:00+06:00']]),
      randomUUID(),
      spare.authorizationHeader,
    ).expect(401);
  });
});

describe('daily status rules', () => {
  it('weekend days are weekend; overtime needs approval before it is payable', async () => {
    // days are computed by punches, the daily job, or HR's recompute
    await co.hr.api
      .post('/attendance/recompute', {
        companyId: co.companyId,
        from: '2026-10-09',
        to: '2026-10-10',
      })
      .expect(201);
    expect((await day(co.rafi.employeeId, '2026-10-09')).status).toBe(
      'weekend',
    ); // Friday

    // Sunday 11 Oct: Sumaiya stayed until 20:00 -> 120 min OT (grade is OT-eligible)
    await agentUpload(batch([['1004', '2026-10-11T20:00:00+06:00']])).expect(
      200,
    );
    expect(await day(co.financeOfficer.employeeId, '2026-10-11')).toMatchObject(
      { otMinutes: 120, otApprovedMinutes: 0 },
    );

    const tooMuch = await co.financeOfficer.api.post(
      `/employees/${co.financeOfficer.employeeId}/overtime-requests`,
      { date: '2026-10-11', minutes: 500 },
    );
    expect(tooMuch.status).toBe(400);
    const ot = await co.financeOfficer.api
      .post(`/employees/${co.financeOfficer.employeeId}/overtime-requests`, {
        date: '2026-10-11',
        minutes: 90,
        reason: 'Month-end VAT return',
      })
      .expect(201);

    // Dept Head of Finance (Sujit) approves
    await co.accounts.api
      .post(`/approvals/requests/${ot.body.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await day(co.financeOfficer.employeeId, '2026-10-11')).otApprovedMinutes,
    ).toBe(90);
  });
});

describe('acceptance: moving a holiday recomputes unlocked days', () => {
  it('Durga Puja moved from Tuesday 6 Oct to Wednesday 7 Oct', async () => {
    await co.hr.api
      .post('/attendance/recompute', {
        companyId: co.companyId,
        from: '2026-10-06',
        to: '2026-10-07',
      })
      .expect(201);
    expect((await day(co.rafi.employeeId, '2026-10-07')).status).toBe('absent');

    const holiday = (
      await co.hr.api
        .post(`/holiday-calendars/${calendarId}/holidays`, {
          date: '2026-10-06',
          nameEn: 'Durga Puja (Bijoya Dashami)',
          nameBn: 'দুর্গাপূজা (বিজয়া দশমী)',
          type: 'festival',
        })
        .expect(201)
    ).body;
    expect(await day(co.rafi.employeeId, '2026-10-06')).toMatchObject({
      status: 'holiday',
      holidayName: 'Durga Puja (Bijoya Dashami)',
    });

    // moved one day after the moon sighting / government notice
    await co.hr.api
      .patch(`/holidays/${holiday.id}`, {
        date: '2026-10-07',
        version: holiday.version,
      })
      .expect(200);
    expect((await day(co.rafi.employeeId, '2026-10-06')).status).toBe('absent');
    expect((await day(co.rafi.employeeId, '2026-10-07')).status).toBe(
      'holiday',
    );
  });

  it('a locked month is not changed; the difference becomes a payroll adjustment', async () => {
    await co.hr.api
      .post('/attendance/locks', { companyId: co.companyId, period: '2026-09' })
      .expect(201);
    const before = await day(co.rafi.employeeId, '2026-09-15');
    expect(before).toMatchObject({ status: 'absent', locked: true });

    await co.hr.api
      .post(`/holiday-calendars/${calendarId}/holidays`, {
        date: '2026-09-15',
        nameEn: 'Company picnic day',
        type: 'company',
      })
      .expect(201);
    expect(await day(co.rafi.employeeId, '2026-09-15')).toMatchObject({
      status: 'absent',
      locked: true,
    });

    const adjustments = (
      await co.hr.api
        .get(`/attendance/adjustments?companyId=${co.companyId}`)
        .expect(200)
    ).body;
    const rafi = adjustments.find(
      (a: { employee_id: string; work_date: string }) =>
        a.employee_id === co.rafi.employeeId && a.work_date === '2026-09-15',
    );
    expect(rafi).toMatchObject({
      previous: { status: 'absent' },
      corrected: { status: 'holiday' },
      reason: 'holiday_changed',
    });

    const twice = await co.hr.api.post('/attendance/locks', {
      companyId: co.companyId,
      period: '2026-09',
    });
    expect(twice.body.code).toBe('ATTENDANCE_MONTH_LOCKED');
  });
});

describe('mobile and web punch', () => {
  const phone = 'install-7f3c9a21-rafi';

  it('needs location consent before the phone can be registered (WP12)', async () => {
    const res = await co.rafi.api
      .post('/me/devices', { deviceId: phone, name: 'Samsung Galaxy A15' })
      .expect(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED_LOCATION');
    const notices = (await co.rafi.api.get('/me/consents').expect(200)).body;
    const location = notices.find(
      (n: { purpose: string }) => n.purpose === 'location_attendance',
    );
    expect(location).toMatchObject({
      status: 'none',
      notice: { version: 'location-2026.1' },
    });
    expect(location.notice.bn).toContain('অবস্থান');
    const given = (
      await co.rafi.api
        .post('/me/consents', { purpose: 'location_attendance', granted: true })
        .expect(201)
    ).body;
    expect(given).toMatchObject({
      purpose: 'location_attendance',
      status: 'granted',
      givenUnder: 'location-2026.1',
    });
  });

  it('needs a phone approved by HR', async () => {
    await co.rafi.api
      .post('/me/devices', { deviceId: phone, name: 'Samsung Galaxy A15' })
      .expect(201);
    const early = await co.rafi.api.post('/me/punches/mobile', {
      deviceId: phone,
      accuracy: 20,
      latitude: GULSHAN.lat,
      longitude: GULSHAN.lng,
    });
    expect(early.body.code).toBe('ATTENDANCE_DEVICE_NOT_REGISTERED');

    const pending = (
      await co.hr.api.get('/attendance/devices?status=pending').expect(200)
    ).body;
    const mine = pending.find(
      (d: { deviceId: string }) => d.deviceId === phone,
    );
    await co.hr.api.post(`/attendance/devices/${mine.id}/approve`).expect(200);
  });

  it('only inside the office geo-fence; the server clock is the punch time', async () => {
    const away = await co.rafi.api.post('/me/punches/mobile', {
      deviceId: phone,
      accuracy: 20,
      latitude: BANANI.lat,
      longitude: BANANI.lng,
    });
    expect(away.status).toBe(403);
    expect(away.body.code).toBe('ATTENDANCE_OUTSIDE_GEOFENCE');
    expect(away.body.details).toMatchObject({
      allowedM: 170,
      branch: 'Dhaka HQ',
    });
    expect(away.body.details.distanceM).toBeGreaterThan(1000);

    const ok = await co.rafi.api
      .post('/me/punches/mobile', {
        deviceId: phone,
        accuracy: 20,
        latitude: 23.7928,
        longitude: 90.4081,
      })
      .expect(201);
    expect(new Date(ok.body.punchedAt)).toEqual(
      new Date('2026-10-12T12:00:00+06:00'),
    );
    expect(ok.body.today).toMatchObject({ status: 'missing_punch' });
  });

  it('HR or the Admin can move the geo-fence or switch it off (then phones cannot punch)', async () => {
    const branch = (await co.owner.get(`/branches/${co.branchId}`).expect(200))
      .body;
    const off = (
      await co.owner
        .patch(`/branches/${co.branchId}`, {
          geoLat: null,
          geoLng: null,
          geoRadiusM: null,
          version: branch.version,
        })
        .expect(200)
    ).body;
    expect(off.geoFence).toBeNull();
    expect(
      (
        await co.rafi.api
          .post('/me/punches/mobile', {
            deviceId: phone,
            accuracy: 20,
            latitude: GULSHAN.lat,
            longitude: GULSHAN.lng,
          })
          .expect(400)
      ).body.code,
    ).toBe('ATTENDANCE_GEOFENCE_NOT_SET');
    const on = (
      await co.owner
        .patch(`/branches/${co.branchId}`, {
          geoLat: GULSHAN.lat,
          geoLng: GULSHAN.lng,
          geoRadiusM: 150,
          version: off.version,
        })
        .expect(200)
    ).body;
    expect(on.geoFence).toMatchObject({ radiusM: 150 });
  });

  it('a phone cannot be registered by a second employee (no buddy punching)', async () => {
    await co.financeOfficer.api
      .post('/me/consents', { purpose: 'location_attendance', granted: true })
      .expect(201);
    const res = await co.financeOfficer.api.post('/me/devices', {
      deviceId: phone,
      name: 'Same phone',
    });
    expect(res.status).toBe(409);
  });

  it('withdrawing location consent stops phone punches at once (WP12)', async () => {
    await co.rafi.api
      .post('/me/consents', { purpose: 'location_attendance', granted: false })
      .expect(201);
    const res = await co.rafi.api
      .post('/me/punches/mobile', {
        deviceId: phone,
        accuracy: 20,
        latitude: 23.7928,
        longitude: 90.4081,
      })
      .expect(403);
    expect(res.body.code).toBe('CONSENT_REQUIRED_LOCATION');
    await co.rafi.api
      .post('/me/consents', { purpose: 'location_attendance', granted: true })
      .expect(201);
  });

  it('web punch only for approved remote staff', async () => {
    expect((await co.salesHead.api.post('/me/punches/web')).body.code).toBe(
      'ATTENDANCE_WEB_PUNCH_NOT_ALLOWED',
    );
    await co.hr.api
      .patch(`/employees/${co.salesHead.employeeId}/attendance-profile`, {
        webPunchAllowed: true,
      })
      .expect(200);
    await co.salesHead.api.post('/me/punches/web').expect(201);
  });

  // ------------------------------------------------ misuse safeguards (2026-10-17)
  const asTenant = <T>(work: () => Promise<T>) =>
    db.withTenant({ tenantId: co.tenant.id }, work);

  it('a weak GPS reading is refused; every refused attempt is kept although the request fails', async () => {
    const weak = await co.rafi.api
      .post('/me/punches/mobile', {
        deviceId: phone,
        accuracy: 150,
        latitude: GULSHAN.lat,
        longitude: GULSHAN.lng,
      })
      .expect(400);
    expect(weak.body).toMatchObject({
      code: 'ATTENDANCE_WEAK_GPS',
      details: { accuracyM: 150, neededM: 100 },
    });
    // the accuracy is part of the request: an app that leaves it out is refused
    await co.rafi.api
      .post('/me/punches/mobile', {
        deviceId: phone,
        latitude: GULSHAN.lat,
        longitude: GULSHAN.lng,
      })
      .expect(400);

    const attempts = await asTenant(() =>
      db.tx
        .selectFrom('punch_attempts')
        .selectAll()
        .where('employee_id', '=', co.rafi.employeeId)
        .orderBy('attempted_at')
        .execute(),
    );
    expect(attempts.map((a) => a.outcome).sort()).toEqual([
      'no_geofence',
      'outside_area',
      'unknown_device',
      'weak_gps',
    ]);
    expect(attempts.find((a) => a.outcome === 'outside_area')).toMatchObject({
      latitude: BANANI.lat,
      accuracy_m: 20,
    });
    expect(
      attempts.find((a) => a.outcome === 'outside_area')!.distance_m,
    ).toBeGreaterThan(1000);
    expect(attempts.every((a) => a.ip && a.user_agent !== undefined)).toBe(
      true,
    );
    // append-only
    await expect(
      asTenant(() =>
        db.tx
          .deleteFrom('punch_attempts')
          .where('employee_id', '=', co.rafi.employeeId)
          .execute(),
      ),
    ).rejects.toThrow();
  });

  it('an accepted phone punch keeps its accuracy, IP and browser', async () => {
    const punch = await asTenant(() =>
      db.tx
        .selectFrom('attendance_punches')
        .selectAll()
        .where('employee_id', '=', co.rafi.employeeId)
        .where('source', '=', 'mobile')
        .orderBy('received_at', 'desc')
        .executeTakeFirstOrThrow(),
    );
    expect(punch).toMatchObject({ accuracy_m: 20 });
    expect(punch.ip).toBeTruthy();
  });

  it('the punch review flags repeated coordinates, impossible travel, many refusals and one IP for several people', async () => {
    const rafiPunch = await asTenant(() =>
      db.tx
        .selectFrom('attendance_punches')
        .select('ip')
        .where('employee_id', '=', co.rafi.employeeId)
        .where('source', '=', 'mobile')
        .executeTakeFirstOrThrow(),
    );
    await asTenant(async () => {
      // the same coordinates to the last decimal on 5 and 6 October (a fake location does not move)
      for (const d of [
        '2026-10-05T09:01:00+06:00',
        '2026-10-06T08:58:00+06:00',
      ]) {
        await db.tx
          .insertInto('attendance_punches')
          .values({
            employee_id: co.rafi.employeeId,
            punched_at: new Date(d),
            source: 'mobile',
            device_ref: phone,
            latitude: 23.792512,
            longitude: 90.407834,
            distance_m: 2,
            accuracy_m: 3,
          })
          .execute();
      }
      // refused in Chattogram ten minutes before an accepted punch in Gulshan
      await db.tx
        .insertInto('punch_attempts')
        .values({
          employee_id: co.rafi.employeeId,
          attempted_at: new Date('2026-10-12T11:50:00+06:00'),
          outcome: 'outside_area',
          latitude: 22.3245,
          longitude: 91.8123,
          accuracy_m: 10,
          distance_m: 210000,
        })
        .execute();
      // Tanvir's web punch from Rafi's network a few minutes after Rafi's punch
      await db.tx
        .insertInto('attendance_punches')
        .values({
          employee_id: co.salesHead.employeeId,
          punched_at: new Date('2026-10-12T12:03:00+06:00'),
          source: 'web',
          device_ref: 'web',
          ip: rafiPunch.ip,
        })
        .execute();
    });
    await co.rafi.api
      .get(
        `/attendance/punch-review?companyId=${co.companyId}&from=2026-10-01&to=2026-10-12`,
      )
      .expect(403);
    const review = (
      await co.hr.api
        .get(
          `/attendance/punch-review?companyId=${co.companyId}&from=2026-10-01&to=2026-10-12`,
        )
        .expect(200)
    ).body;
    const rules = (rule: string) =>
      review.findings.filter((f: { rule: string }) => f.rule === rule);
    expect(rules('repeated_coordinates')[0]).toMatchObject({
      employee: { id: co.rafi.employeeId },
      detail: { days: ['2026-10-05', '2026-10-06'] },
    });
    expect(rules('impossible_travel')[0]).toMatchObject({
      employee: { id: co.rafi.employeeId },
      detail: { fromKind: 'refused', toKind: 'punch' },
    });
    expect(rules('impossible_travel')[0].detail.kmh).toBeGreaterThan(120);
    expect(rules('many_refused')[0]).toMatchObject({
      employee: { id: co.rafi.employeeId },
    });
    expect(rules('many_refused')[0].detail.total).toBeGreaterThanOrEqual(3);
    expect(
      rules('shared_ip').map(
        (f: { employee: { id: string } }) => f.employee.id,
      ),
    ).toEqual(
      expect.arrayContaining([co.rafi.employeeId, co.salesHead.employeeId]),
    );
    // the Sales head reviews his own department
    await co.salesHead.api
      .get(
        `/attendance/punch-review?companyId=${co.companyId}&from=2026-10-01&to=2026-10-12`,
      )
      .expect(200);
  });
});

describe('biometric consent (WP12)', () => {
  it('device punches of someone who withdrew consent are counted but not stored; HR sees the history', async () => {
    await co.hr.api
      .post(`/employees/${co.financeOfficer.employeeId}/consents`, {
        purpose: 'biometric_attendance',
        granted: false,
      })
      .expect(201);
    const res = await agentUpload(
      batch([
        ['1004', '2026-10-14T09:01:00+06:00'],
        ['1006', '2026-10-14T09:02:00+06:00'],
      ]),
    ).expect(200);
    expect(res.body).toMatchObject({ received: 2, inserted: 1, noConsent: 1 });

    const record = (
      await co.hr.api
        .get(`/employees/${co.financeOfficer.employeeId}/consents`)
        .expect(200)
    ).body;
    expect(
      record.current.find(
        (c: { purpose: string }) => c.purpose === 'biometric_attendance',
      ).status,
    ).toBe('withdrawn');
    const biometric = record.history.filter(
      (h: { purpose: string }) => h.purpose === 'biometric_attendance',
    );
    expect(
      biometric.map((h: { granted: boolean; method: string }) => [
        h.granted,
        h.method,
      ]),
    ).toEqual([
      [false, 'paper'],
      [true, 'paper'],
    ]);
    // the employee cannot change another person's consent, and HR's view needs attendance.manage
    await co.rafi.api
      .get(`/employees/${co.financeOfficer.employeeId}/consents`)
      .expect(403);
  });
});

describe('corrections (approval: Dept Head)', () => {
  /**
   * The monthly limit used to count with a hard-coded `${month}-31`, which Postgres
   * accepts for a 31-day month and refuses outright for the other five — so asking
   * for a correction was impossible every April, June, September, November and
   * February. The clock here is October, so the month is given explicitly.
   */
  it('works in a 30-day month: the monthly limit counts to the real last day', async () => {
    await co.hr.api
      .post('/attendance/recompute', {
        companyId: co.companyId,
        from: '2026-09-28',
        to: '2026-09-29',
      })
      .expect(201);
    const res = await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/attendance-corrections`, {
        date: '2026-09-29',
        inTime: '09:00',
        outTime: '18:00',
        reason: 'September: the device was offline all day',
      })
      .expect(201);
    expect(res.body.status).toBe('pending');
  });

  it('Rafi forgot to punch out; Tanvir approves; the day is recomputed', async () => {
    // Monday 12 Oct: only the mobile punch at 12:00
    const res = await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/attendance-corrections`, {
        date: '2026-10-12',
        inTime: '09:00',
        outTime: '18:05',
        reason: 'Forgot to punch, was at client site in Banani',
      })
      .expect(201);
    await co.salesHead.api
      .post(`/approvals/requests/${res.body.approvalRequestId}/approve`, {
        comment: 'Confirmed',
      })
      .expect(200);
    expect(await day(co.rafi.employeeId, '2026-10-12')).toMatchObject({
      status: 'present',
      workedMinutes: 545,
    });
  });

  it('respects the monthly limit and refuses future dates', async () => {
    const company = (
      await co.owner.get(`/companies/${co.companyId}`).expect(200)
    ).body;
    await co.owner
      .patch(`/companies/${co.companyId}`, {
        attendanceCorrectionLimit: 1,
        version: company.version,
      })
      .expect(200);
    const res = await co.rafi.api.post(
      `/employees/${co.rafi.employeeId}/attendance-corrections`,
      { date: '2026-10-11', inTime: '09:00', reason: 'again' },
    );
    expect(res.body.code).toBe('ATTENDANCE_CORRECTION_LIMIT');

    const future = await co.salesHead.api.post(
      `/employees/${co.salesHead.employeeId}/attendance-corrections`,
      { date: '2026-10-20', inTime: '09:00', reason: 'x' },
    );
    expect(future.body.code).toBe('ATTENDANCE_DATE_IN_FUTURE');
  });
});

describe('who sees what', () => {
  it('an employee sees only their own days', async () => {
    await co.rafi.api
      .get('/me/attendance?from=2026-10-01&to=2026-10-12')
      .expect(200);
    await co.rafi.api
      .get(
        `/employees/${co.financeOfficer.employeeId}/attendance?from=2026-10-01&to=2026-10-12`,
      )
      .expect(403);
  });

  it('the Sales head sees his team on a day, not Finance', async () => {
    const res = await co.salesHead.api
      .get('/attendance/days?date=2026-10-11')
      .expect(200);
    const names = res.body.days
      .map((d: { fullNameEn: string }) => d.fullNameEn)
      .sort();
    expect(names).toEqual(['Mahmudul Hasan Rafi', 'Tanvir Hossain']);
  });

  it('the Sales head gets the month summary, adjustments and locks of his department only', async () => {
    const summary = (
      await co.salesHead.api
        .get(`/attendance/summary?companyId=${co.companyId}&period=2026-10`)
        .expect(200)
    ).body;
    expect(
      summary.employees.map((e: { fullNameEn: string }) => e.fullNameEn).sort(),
    ).toEqual(['Mahmudul Hasan Rafi', 'Tanvir Hossain']);
    await co.salesHead.api
      .get(`/attendance/adjustments?companyId=${co.companyId}`)
      .expect(200);
    await co.salesHead.api
      .get(`/attendance/locks?companyId=${co.companyId}`)
      .expect(200);
    // not for an employee, nor for Accounts (no attendance access, spec §4)
    await co.rafi.api
      .get(`/attendance/summary?companyId=${co.companyId}&period=2026-10`)
      .expect(403);
    await co.accounts.api
      .get(`/attendance/summary?companyId=${co.companyId}&period=2026-10`)
      .expect(403);
  });

  it('HR gets the monthly summary; the late penalty is off until switched on', async () => {
    const off = (
      await co.hr.api
        .get(`/attendance/summary?companyId=${co.companyId}&period=2026-10`)
        .expect(200)
    ).body;
    const rafiOff = off.employees.find(
      (e: { employeeId: string }) => e.employeeId === co.rafi.employeeId,
    );
    expect(off.latePenalty.enabled).toBe(false);
    expect(rafiOff).toMatchObject({ late: 1, latePenaltyDays: 0 });

    const company = (
      await co.owner.get(`/companies/${co.companyId}`).expect(200)
    ).body;
    await co.owner
      .patch(`/companies/${co.companyId}`, {
        latePenaltyEnabled: true,
        latePenaltyEvery: 1,
        version: company.version,
      })
      .expect(200);
    const on = (
      await co.hr.api
        .get(`/attendance/summary?companyId=${co.companyId}&period=2026-10`)
        .expect(200)
    ).body;
    expect(
      on.employees.find(
        (e: { employeeId: string }) => e.employeeId === co.rafi.employeeId,
      ).latePenaltyDays,
    ).toBe(1);
  });
});

describe('approval SLA now skips holidays too (WP2 + WP4)', () => {
  it('a request on Monday 12:00 with a holiday on Tuesday is reminded Wednesday 12:00', async () => {
    await co.hr.api
      .post(`/holiday-calendars/${calendarId}/holidays`, {
        date: '2026-10-13',
        nameEn: 'Test holiday',
        type: 'company',
      })
      .expect(201);
    const res = await co.financeOfficer.api
      .post(
        `/employees/${co.financeOfficer.employeeId}/attendance-corrections`,
        {
          date: '2026-10-08',
          inTime: '09:00',
          outTime: '18:00',
          reason: 'Device was offline',
        },
      )
      .expect(201);
    const detail = (
      await co.md.api
        .get(`/approvals/requests/${res.body.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(new Date(detail.approvers[0].reminderAt)).toEqual(
      new Date('2026-10-14T12:00:00+06:00'),
    );
  });
});

describe('the phone register, the day list and the month as a file (ADR 0034)', () => {
  /** supertest parses a CSV body as JSON unless told otherwise. */
  async function downloadFile(url: string) {
    return co.hr.api
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
  }

  it('an approved phone can be listed and stopped, so a leaver cannot keep punching', async () => {
    const active = (
      await co.hr.api.get('/attendance/devices?status=active').expect(200)
    ).body;
    const rafiPhone = active.find(
      (d: { employeeId: string }) => d.employeeId === co.rafi.employeeId,
    );
    expect(rafiPhone).toMatchObject({
      status: 'active',
      name: 'Samsung Galaxy A15',
    });
    expect(rafiPhone.approvedAt).toBeTruthy();

    await co.hr.api
      .post(`/attendance/devices/${rafiPhone.id}/revoke`, {
        reason: 'Last working day',
      })
      .expect(200);
    const revoked = (
      await co.hr.api.get('/attendance/devices?status=revoked').expect(200)
    ).body;
    expect(revoked.map((d: { id: string }) => d.id)).toContain(rafiPhone.id);
    expect(
      (
        await co.hr.api.get('/attendance/devices?status=active').expect(200)
      ).body.map((d: { id: string }) => d.id),
    ).not.toContain(rafiPhone.id);

    const punch = await co.rafi.api.post('/me/punches/mobile', {
      deviceId: 'install-7f3c9a21-rafi',
      accuracy: 20,
      latitude: GULSHAN.lat,
      longitude: GULSHAN.lng,
    });
    expect(punch.body.code).toBe('ATTENDANCE_DEVICE_NOT_REGISTERED');
  });

  it('the day list carries the employee id, so the screen can open the person to fix the day', async () => {
    const res = await co.hr.api
      .get(`/attendance/days?companyId=${co.companyId}&date=2026-10-12`)
      .expect(200);
    expect(res.body.days.length).toBeGreaterThan(0);
    expect(res.body.days[0].employeeId).toBeTruthy();
  });

  it('the month downloads as a spreadsheet, with the BOM Excel needs, and is audited', async () => {
    const res = await downloadFile(
      `/attendance/summary.csv?companyId=${co.companyId}&period=2026-10`,
    );
    const text = (res.body as Buffer).toString('utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split('\r\n')[0]).toBe(
      'employee_code,name_en,present,late,half_day,absent,on_leave,missing_punch,late_minutes,ot_minutes,ot_approved_minutes,late_penalty_days',
    );
    expect(text).toContain('Mahmudul Hasan Rafi');

    const entry = await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'attendance.exported')
        .orderBy('seq', 'desc')
        .executeTakeFirst(),
    );
    expect(entry?.after).toMatchObject({ period: '2026-10' });

    // a Dept Head exports his own department only; Accounts has no attendance access at all
    const head = await co.salesHead.api
      .get(`/attendance/summary.csv?companyId=${co.companyId}&period=2026-10`)
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((head.body as Buffer).toString('utf8')).not.toContain('Finance');
    await co.accounts.api
      .get(`/attendance/summary.csv?companyId=${co.companyId}&period=2026-10`)
      .expect(403);
  });
});
