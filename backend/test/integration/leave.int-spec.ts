/**
 * WP5 leave through the API (Meghna Foods test company, Dhaka HQ weekend Fri+Sat).
 * Acceptance criteria (guide §24):
 *   - balances always equal the ledger sum;
 *   - cancel restores the balance.
 *
 * App clock: Thursday 15 Oct 2026, 10:00 Dhaka.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-15T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let type: Record<string, string>; // code -> id
let calendarId: string;

/** The balance the API reports for one type (all entries, i.e. including approved future leave). */
async function apiBalance(
  employeeId: string,
  code: string,
  asOf = '2099-12-31',
) {
  const res = await co.hr.api
    .get(`/employees/${employeeId}/leave-balances?asOf=${asOf}`)
    .expect(200);
  return res.body.balances.find((b: { code: string }) => b.code === code);
}

/** SUM(days) straight from the ledger table. */
async function ledgerSum(employeeId: string, code: string): Promise<number> {
  const { rows } = await db.withTenant({ tenantId: co.tenant.id }, () =>
    sql<{
      total: string;
    }>`SELECT coalesce(sum(l.days), 0) AS total FROM leave_ledger l JOIN leave_types t ON t.id = l.leave_type_id
                           WHERE l.employee_id = ${employeeId} AND t.code = ${code}`.execute(
      db.tx,
    ),
  );
  return Number(rows[0].total);
}

/** Acceptance: the API balance is exactly the ledger sum. */
async function expectBalanceIsLedgerSum(
  employeeId: string,
  code: string,
  expected: number,
) {
  expect((await apiBalance(employeeId, code)).balance).toBe(expected);
  expect(await ledgerSum(employeeId, code)).toBe(expected);
}

const apply = (
  who: BdCompany['rafi'],
  employeeId: string,
  code: string,
  fromDate: string,
  toDate: string,
  extra: object = {},
) =>
  who.api.post(`/employees/${employeeId}/leave-requests`, {
    leaveTypeId: type[code],
    fromDate,
    toDate,
    reason: 'Test',
    ...extra,
  });

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  const c = `/companies/${co.companyId}`;

  // rule pack, Bangladesh default leave types, holiday calendar with Durga Puja on Wed 21 Oct
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  await co.owner
    .post(
      `/rule-packs/${packs.find((p: { code: string }) => p.code === 'BD-LABOUR').id}/accept`,
      { effectiveFrom: '2025-01-01' },
    )
    .expect(201);
  await co.hr.api.post(`${c}/leave-types/defaults`).expect(201);
  type = Object.fromEntries(
    (await co.hr.api.get(`${c}/leave-types`).expect(200)).body.map(
      (t: { code: string; id: string }) => [t.code, t.id],
    ),
  );
  calendarId = (
    await co.hr.api
      .post(`${c}/holiday-calendars`, { name: 'Bangladesh 2026' })
      .expect(201)
  ).body.id;
  await co.hr.api
    .post(`/holiday-calendars/${calendarId}/holidays`, {
      date: '2026-10-21',
      nameEn: 'Durga Puja (Bijoya Dashami)',
      type: 'festival',
    })
    .expect(201);
  const branch = (await co.owner.get(`/branches/${co.branchId}`).expect(200))
    .body;
  await co.owner
    .patch(`/branches/${co.branchId}`, {
      holidayCalendarId: calendarId,
      version: branch.version,
    })
    .expect(200);

  // Sumaiya is female (maternity eligibility)
  const sumaiya = (
    await co.hr.api
      .get(`/employees/${co.financeOfficer.employeeId}`)
      .expect(200)
  ).body;
  await co.hr.api
    .patch(`/employees/${co.financeOfficer.employeeId}`, {
      gender: 'female',
      version: sumaiya.version,
    })
    .expect(200);

  // yearly grant for 2026
  await co.hr.api
    .post('/leave/accruals/run', {
      companyId: co.companyId,
      asOf: '2026-10-15',
    })
    .expect(201);
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('leave types and accrual', () => {
  it('Bangladesh defaults come from the rule pack', async () => {
    const types = (
      await co.hr.api.get(`/companies/${co.companyId}/leave-types`).expect(200)
    ).body;
    expect(types.map((t: { code: string }) => t.code)).toEqual([
      'CL',
      'EL',
      'LWP',
      'ML',
      'SL',
    ]);
    expect(
      types.find((t: { code: string }) => t.code === 'CL').entitlementRuleKey,
    ).toBe('leave.casual.days_per_year');
  });

  it('the yearly grant gives CL 10 and SL 14; running it again adds nothing', async () => {
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'CL', 10);
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'SL', 14);
    const again = await co.hr.api
      .post('/leave/accruals/run', {
        companyId: co.companyId,
        asOf: '2026-10-15',
      })
      .expect(201);
    expect(again.body.entries).toBe(0);
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'CL', 10);
  });
});

describe('apply and approve', () => {
  let shortLeave: string;

  it('preview: Thu 22 - Sun 25 Oct is 2 days (Fri + Sat weekend not counted)', async () => {
    const res = await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/leave-requests/preview`, {
        leaveTypeId: type.CL,
        fromDate: '2026-10-22',
        toDate: '2026-10-25',
      })
      .expect(200);
    expect(res.body).toMatchObject({ days: 2, available: 10 });
  });

  it('short leave goes to the line manager; pending days are reserved, not taken', async () => {
    const res = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-10-22',
      '2026-10-25',
    ).expect(201);
    shortLeave = res.body.id;
    expect(res.body).toMatchObject({ state: 'pending', days: 2 });
    expect(await apiBalance(co.rafi.employeeId, 'CL')).toMatchObject({
      balance: 10,
      pending: 2,
      available: 8,
    });

    const inbox = (await co.salesHead.api.get('/approvals/inbox').expect(200))
      .body;
    expect(inbox.map((i: { requestId: string }) => i.requestId)).toContain(
      res.body.approvalRequestId,
    );
  });

  it('acceptance: after approval the balance is still exactly the ledger sum', async () => {
    const r = (
      await co.rafi.api.get(`/leave/requests/${shortLeave}`).expect(200)
    ).body;
    await co.salesHead.api
      .post(`/approvals/requests/${r.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.rafi.api.get(`/leave/requests/${shortLeave}`).expect(200)).body
        .state,
    ).toBe('approved');
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'CL', 8);
  });

  it('a holiday inside the range is not counted (Durga Puja on Wed 21 Oct)', async () => {
    const res = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-10-20',
      '2026-10-21',
    ).expect(201);
    expect(res.body.days).toBe(1);
  });

  it('refuses overlap, insufficient balance and dates too far back', async () => {
    expect(
      (
        await apply(
          co.rafi,
          co.rafi.employeeId,
          'CL',
          '2026-10-24',
          '2026-10-26',
        )
      ).body.code,
    ).toBe('LEAVE_OVERLAP');

    const big = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-11-01',
      '2026-11-20',
    );
    expect(big.body).toMatchObject({
      code: 'LEAVE_INSUFFICIENT_BALANCE',
      details: { available: 7 },
    });

    expect(
      (
        await apply(
          co.rafi,
          co.rafi.employeeId,
          'CL',
          '2026-09-01',
          '2026-09-01',
        )
      ).body.code,
    ).toBe('LEAVE_TOO_FAR_BACK');
    // HR may enter older leave (e.g. reported late)
    await apply(
      co.hr,
      co.rafi.employeeId,
      'CL',
      '2026-09-01',
      '2026-09-01',
    ).expect(201);
  });

  it('half day counts 0.5', async () => {
    const res = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-10-28',
      '2026-10-28',
      { halfDay: 'first_half' },
    ).expect(201);
    expect(res.body.days).toBe(0.5);
  });
});

describe('acceptance: cancel restores the balance', () => {
  it('cancelling approved future leave writes a reversal', async () => {
    const before = await ledgerSum(co.salesHead.employeeId, 'CL');
    const res = await apply(
      co.salesHead,
      co.salesHead.employeeId,
      'CL',
      '2026-11-02',
      '2026-11-03',
    ).expect(201);
    await co.md.api
      .post(`/approvals/requests/${res.body.approvalRequestId}/approve`, {})
      .expect(200); // Tanvir's line manager
    await expectBalanceIsLedgerSum(co.salesHead.employeeId, 'CL', before - 2);

    await co.salesHead.api
      .post(`/leave/requests/${res.body.id}/cancel`, {
        reason: 'Client meeting moved',
      })
      .expect(200);
    await expectBalanceIsLedgerSum(co.salesHead.employeeId, 'CL', before);

    const statement = (
      await co.salesHead.api
        .get(
          `/employees/${co.salesHead.employeeId}/leave-ledger?leaveTypeId=${type.CL}`,
        )
        .expect(200)
    ).body;
    expect(
      statement.map(
        (e: { kind: string; days: number }) => `${e.kind}:${e.days}`,
      ),
    ).toEqual(['accrual:10', 'taken:-2', 'reversal:2']);
    expect(statement.at(-1).balanceAfter).toBe(before);
  });

  it('cancelling a pending request withdraws it from approval; nothing to reverse', async () => {
    const res = await apply(
      co.salesHead,
      co.salesHead.employeeId,
      'CL',
      '2026-11-05',
      '2026-11-05',
    ).expect(201);
    await co.salesHead.api
      .post(`/leave/requests/${res.body.id}/cancel`, { reason: 'Not needed' })
      .expect(200);
    const approval = (
      await co.md.api
        .get(`/approvals/requests/${res.body.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(approval.state).toBe('cancelled');
    expect(await apiBalance(co.salesHead.employeeId, 'CL')).toMatchObject({
      pending: 0,
    });
  });

  it('leave already started: the employee cannot cancel, HR can; attendance follows', async () => {
    const res = await apply(
      co.accounts,
      co.accounts.employeeId,
      'CL',
      '2026-10-13',
      '2026-10-14',
    ).expect(201);
    await co.md.api
      .post(`/approvals/requests/${res.body.approvalRequestId}/approve`, {})
      .expect(200);
    const attendance = async () =>
      (
        await co.hr.api
          .get(
            `/employees/${co.accounts.employeeId}/attendance?from=2026-10-13&to=2026-10-13`,
          )
          .expect(200)
      ).body.days[0];
    expect((await attendance()).status).toBe('on_leave');
    const before = await ledgerSum(co.accounts.employeeId, 'CL');

    expect(
      (
        await co.accounts.api.post(`/leave/requests/${res.body.id}/cancel`, {
          reason: 'x',
        })
      ).body.code,
    ).toBe('LEAVE_CANNOT_CANCEL');
    await co.hr.api
      .post(`/leave/requests/${res.body.id}/cancel`, {
        reason: 'Was at work, entered by mistake',
      })
      .expect(200);
    await expectBalanceIsLedgerSum(co.accounts.employeeId, 'CL', before + 2);
    expect((await attendance()).status).toBe('absent');
  });
});

describe('rules per leave type', () => {
  it('sick leave over 2 days needs a medical certificate', async () => {
    const without = await apply(
      co.rafi,
      co.rafi.employeeId,
      'SL',
      '2026-11-08',
      '2026-11-10',
    );
    expect(without.body.code).toBe('LEAVE_DOCUMENT_REQUIRED');

    const pdf = Buffer.from(
      '%PDF-1.4\n% medical certificate, Dr. Shirin Akter, Square Hospital\n%%EOF\n',
    );
    // the employee attaches it himself while applying (no general document rights needed)
    await co.rafi.api
      .upload(
        `/employees/${co.salesHead.employeeId}/leave-documents`,
        {},
        { content: pdf, name: 'medical.pdf' },
      )
      .expect(403);
    await co.rafi.api
      .upload(
        `/employees/${co.rafi.employeeId}/leave-documents`,
        {},
        { content: Buffer.from('not a pdf'), name: 'x.txt' },
      )
      .expect(400);
    const doc = await co.rafi.api
      .upload(
        `/employees/${co.rafi.employeeId}/leave-documents`,
        {},
        { content: pdf, name: 'medical.pdf' },
      )
      .expect(201);
    expect(doc.body).toMatchObject({ title: 'Leave supporting document' });
    await apply(co.rafi, co.rafi.employeeId, 'SL', '2026-11-08', '2026-11-10', {
      documentId: doc.body.id,
    }).expect(201);
  });

  it('over 3 days: Dept Head then HR', async () => {
    const res = await apply(
      co.salesHead,
      co.salesHead.employeeId,
      'CL',
      '2026-11-15',
      '2026-11-18',
    ).expect(201); // Sun-Wed, 4 days
    const detail = (
      await co.md.api
        .get(`/approvals/requests/${res.body.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(
      detail.steps.map((s: { approverRule: string }) => s.approverRule),
    ).toEqual(['dept_head', 'role:hr']);
  });

  it('maternity: 120 calendar days for an eligible woman, Dept Head then HR', async () => {
    const res = await apply(
      co.financeOfficer,
      co.financeOfficer.employeeId,
      'ML',
      '2026-12-01',
      '2027-03-30',
    ).expect(201);
    expect(res.body.days).toBe(120);
    const detail = (
      await co.md.api
        .get(`/approvals/requests/${res.body.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(detail.chainName).toBe('Maternity / unpaid leave (default)');

    const tooLong = await apply(
      co.hr,
      co.financeOfficer.employeeId,
      'ML',
      '2027-04-01',
      '2027-07-30',
    );
    expect(tooLong.body).toMatchObject({
      code: 'LEAVE_TOO_LONG',
      details: { max: 120 },
    });

    expect(
      (
        await apply(
          co.rafi,
          co.rafi.employeeId,
          'ML',
          '2026-12-01',
          '2026-12-10',
        )
      ).body.code,
    ).toBe('LEAVE_NOT_ELIGIBLE');
  });

  it('earned leave needs one year of service; leave without pay needs no balance', async () => {
    const joiner = (
      await co.hr.api
        .post('/employees', {
          companyId: co.companyId,
          fullNameEn: 'Nabila Rahman',
          fullNameBn: 'নাবিলা রহমান',
          joinDate: '2026-06-01',
          branchId: co.branchId,
          departmentId: co.departments.fin,
          designationId: (
            await co.hr.api.get(`/companies/${co.companyId}/designations`)
          ).body[0].id,
          gradeId: (await co.hr.api.get(`/companies/${co.companyId}/grades`))
            .body[0].id,
        })
        .expect(201)
    ).body;
    for (const item of (
      await co.hr.api.get(`/employees/${joiner.id}/onboarding`)
    ).body.items)
      await co.hr.api
        .post(`/employees/${joiner.id}/onboarding/${item.code}/complete`, {})
        .expect(200);
    await co.hr.api.post(`/employees/${joiner.id}/activate`).expect(200);

    const el = await apply(co.hr, joiner.id, 'EL', '2026-11-01', '2026-11-01');
    expect(el.body).toMatchObject({
      code: 'LEAVE_NOT_ELIGIBLE',
      details: { minServiceMonths: 12 },
    });
    await apply(co.hr, joiner.id, 'LWP', '2026-11-01', '2026-11-01').expect(
      201,
    );
  });
});

describe('return for correction and resubmit', () => {
  it('the approver returns it; the employee changes the dates and sends it again', async () => {
    const res = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-11-22',
      '2026-11-22',
    ).expect(201);
    await co.salesHead.api
      .post(`/approvals/requests/${res.body.approvalRequestId}/return`, {
        comment: 'Year-end sales review that day, please pick the 23rd',
      })
      .expect(200);
    // the employee sees why
    expect(
      (await co.rafi.api.get(`/leave/requests/${res.body.id}`).expect(200))
        .body,
    ).toMatchObject({
      state: 'returned',
      decisionComment: 'Year-end sales review that day, please pick the 23rd',
    });

    const again = await co.rafi.api
      .post(`/leave/requests/${res.body.id}/resubmit`, {
        leaveTypeId: type.CL,
        fromDate: '2026-11-23',
        toDate: '2026-11-23',
        reason: 'Moved',
      })
      .expect(200);
    expect(again.body).toMatchObject({ state: 'pending', from: '2026-11-23' });
    expect(again.body.approvalRequestId).not.toBe(res.body.approvalRequestId);
  });

  it('a returned request can also be withdrawn', async () => {
    const res = await apply(
      co.rafi,
      co.rafi.employeeId,
      'CL',
      '2026-11-24',
      '2026-11-24',
    ).expect(201);
    await co.salesHead.api
      .post(`/approvals/requests/${res.body.approvalRequestId}/return`, {
        comment: 'Please talk to me first',
      })
      .expect(200);
    const cancelled = (
      await co.rafi.api
        .post(`/leave/requests/${res.body.id}/cancel`, {
          reason: 'Not needed any more',
        })
        .expect(200)
    ).body;
    expect(cancelled.state).toBe('cancelled');
    const mine = (await co.rafi.api.get('/me/leave-requests').expect(200)).body;
    expect(
      mine.find((r: { id: string }) => r.id === res.body.id),
    ).toMatchObject({
      state: 'cancelled',
      decisionComment: 'Please talk to me first',
    });
  });
});

describe('team-absence warning', () => {
  it('warns when more than 30% of Finance would be away on the same day', async () => {
    await apply(
      co.accounts,
      co.accounts.employeeId,
      'CL',
      '2026-11-26',
      '2026-11-26',
    ).expect(201);
    const res = await co.financeOfficer.api
      .post(
        `/employees/${co.financeOfficer.employeeId}/leave-requests/preview`,
        { leaveTypeId: type.CL, fromDate: '2026-11-26', toDate: '2026-11-26' },
      )
      .expect(200);
    expect(res.body.teamWarnings[0]).toMatchObject({
      date: '2026-11-26',
      onLeave: 2,
    });
    expect(res.body.teamWarnings[0].percent).toBeGreaterThan(30);
  });

  it('the Dept Head sees who is off in the team calendar', async () => {
    const res = await co.salesHead.api
      .get(
        `/leave/team-calendar?departmentId=${co.departments.sales}&from=2026-10-01&to=2026-11-30`,
      )
      .expect(200);
    expect(
      res.body.leaves.map((l: { fullNameEn: string }) => l.fullNameEn),
    ).toContain('Mahmudul Hasan Rafi');
    await co.salesHead.api
      .get(
        `/leave/team-calendar?departmentId=${co.departments.fin}&from=2026-10-01&to=2026-11-30`,
      )
      .expect(403);
  });
});

describe('year end (carry, encash, lapse)', () => {
  it('earned leave above the 40-day cap is encashed; the year is closed; balances still equal the ledger', async () => {
    // opening balance from the old system (migration): 45.5 days of EL at 30 Jun 2025
    await co.hr.api
      .post(`/employees/${co.rafi.employeeId}/leave-ledger`, {
        leaveTypeId: type.EL,
        kind: 'opening',
        days: 45.5,
        entryDate: '2025-06-30',
        note: 'Opening balance from old payroll system',
      })
      .expect(201);

    const res = await co.hr.api
      .post('/leave/year-end', { companyId: co.companyId, leaveYear: '2025' })
      .expect(201);
    expect(res.body).toMatchObject({
      leaveYear: '2025',
      carried: 40,
      encashed: 5.5,
    });
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'EL', 40);

    const statement = (
      await co.hr.api
        .get(
          `/employees/${co.rafi.employeeId}/leave-ledger?leaveTypeId=${type.EL}`,
        )
        .expect(200)
    ).body;
    expect(
      statement.map(
        (e: { kind: string; days: number }) => `${e.kind}:${e.days}`,
      ),
    ).toEqual(['opening:45.5', 'encash:-5.5', 'lapse:-40', 'carry_in:40']);

    const encash = (
      await co.hr.api
        .get(`/leave/encashments?companyId=${co.companyId}`)
        .expect(200)
    ).body;
    expect(
      encash.find(
        (x: { employee_id: string }) => x.employee_id === co.rafi.employeeId,
      ),
    ).toMatchObject({
      leave_type: 'EL',
      leave_year: '2025',
      days: '5.50',
      status: 'pending_payroll',
    });

    // running it again changes nothing
    const again = await co.hr.api
      .post('/leave/year-end', { companyId: co.companyId, leaveYear: '2025' })
      .expect(201);
    expect(again.body).toMatchObject({ carried: 0, encashed: 0, lapsed: 0 });
    await expectBalanceIsLedgerSum(co.rafi.employeeId, 'EL', 40);
  });

  it('a year that has not ended cannot be closed', async () => {
    const res = await co.hr.api.post('/leave/year-end', {
      companyId: co.companyId,
      leaveYear: '2026',
    });
    expect(res.status).toBe(400);
  });
});

describe('who may do what', () => {
  it('an employee sees only their own balances and cannot run jobs', async () => {
    await co.rafi.api.get('/me/leave-balances').expect(200);
    await co.rafi.api
      .get(`/employees/${co.financeOfficer.employeeId}/leave-balances`)
      .expect(403);
    await co.rafi.api
      .post('/leave/accruals/run', { companyId: co.companyId })
      .expect(403);
    await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/leave-ledger`, {
        leaveTypeId: type.CL,
        kind: 'adjustment',
        days: 5,
        entryDate: '2026-10-15',
        note: 'free days',
      })
      .expect(403);
  });
});

describe('the calendar company-wide, and HR cancelling leave that has started (ADR 0034)', () => {
  it('HR can ask the calendar about everyone, not one department at a time', async () => {
    const all = (
      await co.hr.api
        .get(
          `/leave/team-calendar?companyId=${co.companyId}&from=2026-10-01&to=2026-11-30`,
        )
        .expect(200)
    ).body;
    expect(all.departmentId).toBeNull();
    const departments = new Set(
      all.leaves.map((l: { employeeCode: string }) => l.employeeCode),
    );
    expect(departments.size).toBeGreaterThan(1);
    expect(all.headcount).toBeGreaterThan(2);

    // the Dept Head may ask the same question and still sees only his own people
    const his = (
      await co.salesHead.api
        .get(
          `/leave/team-calendar?companyId=${co.companyId}&from=2026-10-01&to=2026-11-30`,
        )
        .expect(200)
    ).body;
    expect(
      his.leaves.map((l: { fullNameEn: string }) => l.fullNameEn),
    ).toContain('Mahmudul Hasan Rafi');
    expect(his.headcount).toBeLessThan(all.headcount);

    // an employee has no business asking
    await co.rafi.api
      .get(
        `/leave/team-calendar?companyId=${co.companyId}&from=2026-10-01&to=2026-11-30`,
      )
      .expect(403);
    // and one of the two narrowings is required
    await co.hr.api
      .get('/leave/team-calendar?from=2026-10-01&to=2026-11-30')
      .expect(400);
  });

  it('only HR may cancel leave that has already started, and the days go back', async () => {
    // Rafi takes casual leave over today (12 Oct is inside the range)
    const taken = (
      await apply(
        co.rafi,
        co.rafi.employeeId,
        'CL',
        '2026-10-12',
        '2026-10-13',
      ).expect(201)
    ).body;
    await co.salesHead.api
      .post(`/approvals/requests/${taken.approvalRequestId}/approve`, {})
      .expect(200);
    const before = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/leave-balances`)
        .expect(200)
    ).body;
    const clBefore = before.balances.find(
      (b: { code: string }) => b.code === 'CL',
    ).balance;

    // the employee cannot: it has started
    expect(
      (
        await co.rafi.api.post(`/leave/requests/${taken.id}/cancel`, {
          reason: 'Changed my mind',
        })
      ).status,
    ).toBe(403);

    await co.hr.api
      .post(`/leave/requests/${taken.id}/cancel`, {
        reason: 'Called back for the Chittagong audit',
      })
      .expect(200);
    const after = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/leave-balances`)
        .expect(200)
    ).body;
    expect(
      after.balances.find((b: { code: string }) => b.code === 'CL').balance,
    ).toBe(clBefore + 2);

    // the ledger says what happened rather than quietly forgetting it
    const ledger = (
      await co.hr.api
        .get(
          `/employees/${co.rafi.employeeId}/leave-ledger?leaveTypeId=${type.CL}`,
        )
        .expect(200)
    ).body;
    const reversal = ledger
      .filter((e: { kind: string }) => e.kind === 'reversal')
      .at(-1);
    expect(reversal.note).toContain('Called back for the Chittagong audit');
  });
});
