/**
 * Employee lifecycle fixes (2026-10-21) through the API (Meghna Foods test company):
 * probation reviews (Dept Head recommends, HR decides, a reminder 15 days before),
 * notice of leaving with the company's notice period and the shortfall, the four
 * clearances, withdrawing a notice, end of probation, the experience certificate,
 * and the notice / retirement company settings.
 *
 * Everyone joined on 1 January 2025 with 6 months' probation (ended 30 June 2025);
 * today is 2 October 2026.
 */
import type { INestApplication } from '@nestjs/common';
import { ManualClock } from '../../src/platform/clock.js';
import { LifecycleService } from '../../src/modules/employees/lifecycle.service.js';
import { EmployeesService } from '../../src/modules/employees/employees.service.js';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.js';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-02T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
const asSystem = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('probation', () => {
  it('HR sees every probation that has ended; a Dept Head only his department', async () => {
    const all = (await co.hr.api.get(`${c}/probation-reviews`).expect(200))
      .body;
    expect(all.length).toBe(6);
    expect(
      all.find(
        (r: { employeeId: string }) => r.employeeId === co.rafi.employeeId,
      ),
    ).toMatchObject({ probationEndDate: '2025-06-30', review: null });
    expect(all[0].daysLeft).toBeLessThan(0);

    const sales = (
      await co.salesHead.api.get(`${c}/probation-reviews`).expect(200)
    ).body.map((r: { employeeId: string }) => r.employeeId);
    expect(sales).toContain(co.rafi.employeeId);
    expect(sales).not.toContain(co.accounts.employeeId);
    await co.rafi.api.get(`${c}/probation-reviews`).expect(403);
  });

  it('Tanvir recommends confirming Rafi; nobody recommends for themselves or outside their department', async () => {
    const review = (
      await co.salesHead.api
        .post(`/employees/${co.rafi.employeeId}/probation-recommendation`, {
          outcome: 'confirm',
          note: 'Met the dealer targets for Mirpur and Uttara',
        })
        .expect(200)
    ).body;
    expect(review).toMatchObject({
      recommendation: 'confirm',
      recommendedBy: 'Tanvir Hossain',
      decision: null,
    });
    await co.salesHead.api
      .post(`/employees/${co.salesHead.employeeId}/probation-recommendation`, {
        outcome: 'confirm',
        note: 'me',
      })
      .expect(403);
    await co.salesHead.api
      .post(`/employees/${co.accounts.employeeId}/probation-recommendation`, {
        outcome: 'confirm',
        note: 'not mine',
      })
      .expect(403);
    await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/probation-recommendation`, {
        outcome: 'confirm',
        note: 'me',
      })
      .expect(403);
    await co.salesHead.api
      .post(`/employees/${co.rafi.employeeId}/probation-recommendation`, {
        outcome: 'extend',
        note: 'no months',
      })
      .expect(400);
  });

  it('HR confirms Rafi (active), extends Sumaiya by 3 months', async () => {
    await co.salesHead.api
      .post(`/employees/${co.rafi.employeeId}/probation-decision`, {
        outcome: 'confirm',
        note: 'x',
      })
      .expect(403);
    const rafi = (
      await co.hr.api
        .post(`/employees/${co.rafi.employeeId}/probation-decision`, {
          outcome: 'confirm',
          note: 'Confirmed as recommended',
        })
        .expect(200)
    ).body;
    expect(rafi).toMatchObject({
      status: 'active',
      confirmedAt: expect.any(String),
    });
    expect(
      (
        await co.hr.api
          .post(`/employees/${co.rafi.employeeId}/probation-decision`, {
            outcome: 'confirm',
            note: 'again',
          })
          .expect(400)
      ).body.code,
    ).toBe('NOT_ON_PROBATION');

    const sumaiya = (
      await co.hr.api
        .post(`/employees/${co.financeOfficer.employeeId}/probation-decision`, {
          outcome: 'extend',
          months: 3,
          note: 'Reconciliation work still needs checking',
        })
        .expect(200)
    ).body;
    expect(sumaiya).toMatchObject({
      status: 'probation',
      probationEndDate: '2025-09-30',
    });
  });

  it('the Dept Head is reminded once, 15 days before a probation ends', async () => {
    // Sumaiya's (extended) probation now ends on 12 October 2026
    await asSystem(() =>
      db.tx
        .updateTable('employees')
        .set({ probation_end_date: '2026-10-12' })
        .where('id', '=', co.financeOfficer.employeeId)
        .execute(),
    );
    const lifecycle = app.get(LifecycleService, { strict: false });
    expect(await asSystem(() => lifecycle.remindProbationsDue())).toBe(1);
    expect(await asSystem(() => lifecycle.remindProbationsDue())).toBe(0);

    // Finance's head (Sujit) gets the message
    await asSystem(() =>
      app.get(NotificationsService, { strict: false }).planRecent(),
    );
    const messages = await asSystem(() =>
      db.tx
        .selectFrom('notifications')
        .select(['kind', 'employee_id'])
        .where('kind', '=', 'probation_review')
        .execute(),
    );
    expect(messages.map((m) => m.employee_id)).toEqual(
      expect.arrayContaining([co.accounts.employeeId]),
    );
  });

  it('HR ends a probation: a separation without notice period', async () => {
    const md = (
      await co.hr.api
        .post(`/employees/${co.financeOfficer.employeeId}/probation-decision`, {
          outcome: 'end',
          lastWorkingDay: '2026-10-15',
          note: 'Did not meet the standard after the extension',
        })
        .expect(200)
    ).body;
    expect(md).toMatchObject({
      status: 'notice',
      lastWorkingDay: '2026-10-15',
    });
    const s = (
      await co.hr.api
        .get(`/employees/${co.financeOfficer.employeeId}/separation`)
        .expect(200)
    ).body;
    expect(s).toMatchObject({
      kind: 'probation_end',
      requiredNoticeDays: 0,
      shortfallDays: 0,
      state: 'in_notice',
    });
  });
});

describe('notice of leaving and clearance', () => {
  let separationId: string;

  it('a resignation is checked against the notice period (60 days by default)', async () => {
    const res = (
      await co.hr.api
        .post(`/employees/${co.accounts.employeeId}/notice`, {
          kind: 'resignation',
          noticeDate: '2026-10-02',
          lastWorkingDay: '2026-10-31',
          reason: 'Joining BRAC Bank as finance manager',
        })
        .expect(200)
    ).body;
    expect(res).toMatchObject({
      status: 'notice',
      lastWorkingDay: '2026-10-31',
    });
    const again = await co.hr.api
      .post(`/employees/${co.accounts.employeeId}/notice`, {
        lastWorkingDay: '2026-11-30',
        reason: 'twice',
      })
      .expect(409);
    expect(again.body.code).toBe('SEPARATION_EXISTS');

    const s = (
      await co.hr.api
        .get(`/employees/${co.accounts.employeeId}/separation`)
        .expect(200)
    ).body;
    separationId = s.id;
    expect(s).toMatchObject({
      kind: 'resignation',
      requiredNoticeDays: 60,
      givenNoticeDays: 29,
      shortfallDays: 31,
      owed: { salaryAdvances: '0.00', cashAdvances: '0.00' },
    });
    expect(
      s.clearances.map(
        (x: { item: string; cleared: boolean }) => `${x.item}:${x.cleared}`,
      ),
    ).toEqual([
      'it:false',
      'admin_assets:false',
      'accounts_advances:false',
      'dept_handover:false',
    ]);
  });

  it('each department clears its own item; the leaver cannot clear themself', async () => {
    await co.accounts.api
      .post(`/separations/${separationId}/clearances/accounts_advances`, {})
      .expect(403); // Sujit is the leaver
    await co.salesHead.api
      .post(`/separations/${separationId}/clearances/dept_handover`, {})
      .expect(403); // not his department
    await co.rafi.api
      .post(`/separations/${separationId}/clearances/it`, {})
      .expect(403);
    await co.md.api
      .post(`/separations/${separationId}/clearances/it`, {
        note: 'E-mail closed',
      })
      .expect(200);
    await co.md.api
      .post(`/separations/${separationId}/clearances/bogus`, {})
      .expect(400);
    const s = (
      await co.md.api
        .post(`/separations/${separationId}/clearances/admin_assets`, {
          note: 'Laptop returned',
        })
        .expect(200)
    ).body;
    expect(
      s.clearances
        .filter((x: { cleared: boolean }) => x.cleared)
        .map((x: { clearedBy: string }) => x.clearedBy),
    ).toEqual(['Anwar Hossain', 'Anwar Hossain']);

    // lists: HR and the Admin see the leaver; an employee cannot list
    const list = (
      await co.hr.api.get(`${c}/separations?state=in_notice`).expect(200)
    ).body;
    expect(list.map((x: { employeeId: string }) => x.employeeId)).toEqual(
      expect.arrayContaining([
        co.accounts.employeeId,
        co.financeOfficer.employeeId,
      ]),
    );
    await co.rafi.api.get(`${c}/separations`).expect(403);
  });

  it('withdrawn: he stays, back to his status before the notice', async () => {
    const back = (
      await co.hr.api
        .post(`/separations/${separationId}/withdraw`, {
          reason: 'Stays after the counter-offer',
        })
        .expect(200)
    ).body;
    expect(back).toMatchObject({ status: 'probation', lastWorkingDay: null });
    await co.hr.api
      .post(`/separations/${separationId}/withdraw`, { reason: 'again' })
      .expect(409);
    expect(
      (
        await co.hr.api
          .get(`/employees/${co.accounts.employeeId}/separation`)
          .expect(200)
      ).body,
    ).toMatchObject({
      state: 'withdrawn',
      withdrawnReason: 'Stays after the counter-offer',
    });
  });

  it('the notice period is a company setting', async () => {
    const company = (await co.owner.get(c).expect(200)).body;
    expect(company).toMatchObject({
      noticeDaysResignation: 60,
      noticeDaysTermination: 120,
      retirementAge: 60,
    });
    await co.owner
      .patch(c, { noticeDaysResignation: 30, version: company.version })
      .expect(200);
    await co.hr.api
      .post(`/employees/${co.accounts.employeeId}/notice`, {
        noticeDate: '2026-10-02',
        lastWorkingDay: '2026-10-31',
        reason: 'Resigned again',
      })
      .expect(200);
    expect(
      (
        await co.hr.api
          .get(`/employees/${co.accounts.employeeId}/separation`)
          .expect(200)
      ).body,
    ).toMatchObject({ requiredNoticeDays: 30, shortfallDays: 1 });
  });
});

describe('experience certificate', () => {
  it('only after the final settlement separated the employee', async () => {
    const url = `/employees/${co.financeOfficer.employeeId}/experience-certificate.pdf?lang=bn`;
    expect((await co.hr.api.get(url).expect(400)).body.code).toBe(
      'NOT_SEPARATED',
    );
    await asSystem(() =>
      app
        .get(EmployeesService, { strict: false })
        .markSeparated(co.financeOfficer.employeeId),
    );
    expect(
      (
        await co.hr.api
          .get(`/employees/${co.financeOfficer.employeeId}/separation`)
          .expect(200)
      ).body.state,
    ).toBe('separated');

    const pdf = await co.hr.api
      .get(url)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (b: Buffer) => chunks.push(b));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    await co.md.api.get(url).expect(403);
  });
});
