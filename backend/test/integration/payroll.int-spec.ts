/**
 * WP6 payroll through the API (Meghna Foods test company).
 * Acceptance criteria (guide §24):
 *   - all payroll acceptance cases pass        (src/payroll-engine/acceptance.spec.ts)
 *   - re-calculation of a past run reproduces identical lines   (below)
 * Plus: maker-checker (HR prepares, Accounts verifies, Admin approves; one person
 * never approves two steps), flags cleared with a reason, results frozen after
 * submission, arrears from a back-dated increment, attendance adjustment of a
 * locked day, salary advance recovery, festival bonus, final settlement.
 *
 * Salaries (gross, from 1 Jan 2025): Anwar (MD) 150,000 · Farzana (HR) 80,000 ·
 * Sujit (Accounts) 90,000 · Sumaiya 40,000 · Tanvir (Sales head) 100,000 · Rafi 30,000.
 * Structure: Basic 60%, house rent 50% of basic, medical 10% of basic, rest other.
 * Tax values are the ILLUSTRATIVE placeholders of rule pack 2026.2.
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
let c: string; // /companies/:id
let structureId: string;
let septemberRun: string;

const GROSS: Array<[keyof BdCompany, string]> = [
  ['md', '150000'],
  ['hr', '80000'],
  ['accounts', '90000'],
  ['financeOfficer', '40000'],
  ['salesHead', '100000'],
  ['rafi', '30000'],
];
const person = (key: keyof BdCompany) => co[key] as BdCompany['rafi'];

/** Lines of one employee in a run, as { HEAD: amount } (salary access needed: HR). */
async function linesOf(
  runId: string,
  employeeId: string,
): Promise<Record<string, string>> {
  const slip = (
    await co.hr.api
      .get(`/payroll-runs/${runId}/employees/${employeeId}`)
      .expect(200)
  ).body;
  const all = [
    ...slip.earnings,
    ...slip.deductions,
    ...slip.employerContributions,
  ] as Array<{ head: string; amount: string }>;
  return Object.fromEntries(all.map((l) => [l.head, l.amount]));
}

/** Lock a month, then mark every working day "present" except the given absences (stands in for device punches). */
async function lockMonthAllPresent(
  period: string,
  absences: Array<[string, string]> = [],
) {
  await co.hr.api
    .post('/attendance/locks', { companyId: co.companyId, period })
    .expect(201);
  await db.withTenant({ tenantId: co.tenant.id }, async () => {
    await db.tx
      .updateTable('attendance_days')
      .set({ status: 'present', worked_minutes: 540 })
      .where('company_id', '=', co.companyId)
      .where('work_date', '>=', `${period}-01`)
      .where('work_date', '<', nextMonth(period))
      .where('status', '=', 'absent')
      .execute();
    for (const [employeeId, date] of absences) {
      await db.tx
        .updateTable('attendance_days')
        .set({ status: 'absent', worked_minutes: 0 })
        .where('employee_id', '=', employeeId)
        .where('work_date', '=', date)
        .execute();
    }
  });
}

async function clearAllFlags(runId: string) {
  const run = (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body;
  for (const f of run.flags.filter((x: { cleared: boolean }) => !x.cleared)) {
    await co.hr.api
      .post(`/payroll-flags/${f.id}/clear`, { reason: `Checked: ${f.code}` })
      .expect(200);
  }
  return run.flags as Array<{ code: string; employeeId: string }>;
}

/** Submit, Accounts verifies, Admin approves. */
async function approveRun(runId: string) {
  const submitted = (
    await co.hr.api.post(`/payroll-runs/${runId}/submit`).expect(200)
  ).body;
  await co.accounts.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
  await co.md.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
  return (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body;
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;

  // rule pack 2026.2 (salary tax values), Bangladesh heads and the standard structure
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.2',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  structureId = (await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201))
    .body.structureId;

  for (const [key, gross] of GROSS) {
    await co.hr.api
      .post(`/employees/${person(key).employeeId}/salaries`, {
        effectiveFrom: '2025-01-01',
        gross,
        structureId,
        reason: 'Joining salary',
      })
      .expect(201);
  }

  // September: Rafi absent on Tuesday 15 September, everyone else present every working day
  await lockMonthAllPresent('2026-09', [[co.rafi.employeeId, '2026-09-15']]);
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('setup', () => {
  it('salary breakdown follows the structure; the approving Admin reads it, a department head cannot', async () => {
    const res = await co.hr.api
      .get(`/employees/${co.rafi.employeeId}/salaries`)
      .expect(200);
    expect(res.body.current).toMatchObject({
      gross: '30000.00',
      breakdown: {
        BASIC: '18000.00',
        HOUSE_RENT: '9000.00',
        MEDICAL: '1800.00',
        OTHER_ALLOWANCE: '1200.00',
      },
    });
    await co.md.api
      .get(`/employees/${co.rafi.employeeId}/salaries`)
      .expect(200);
    await co.salesHead.api
      .get(`/employees/${co.rafi.employeeId}/salaries`)
      .expect(403);
  });

  it('refuses a structure whose heads exceed gross or skip BASIC', async () => {
    await co.hr.api
      .post(`${c}/salary-structures`, {
        code: 'BAD',
        name: 'Bad',
        rules: [{ head: 'HOUSE_RENT', of: 'GROSS', percent: '50' }],
      })
      .expect(400);
    const over = await co.hr.api.post(`${c}/salary-structures`, {
      code: 'OVER',
      name: 'Over',
      rules: [
        { head: 'BASIC', of: 'GROSS', percent: '80' },
        { head: 'HOUSE_RENT', of: 'BASIC', percent: '50' },
        { head: 'OTHER_ALLOWANCE', remainder: true },
      ],
    });
    expect(over.status).toBe(400);
    expect(over.body.details.problem).toMatch(/more than the gross/);
  });

  it('a run needs a locked month', async () => {
    const run = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-08' })
        .expect(201)
    ).body;
    const res = await co.hr.api
      .post(`/payroll-runs/${run.id}/calculate`)
      .expect(400);
    expect(res.body.code).toBe('PAYROLL_ATTENDANCE_NOT_LOCKED');
    await co.hr.api
      .post(`/payroll-runs/${run.id}/cancel`, {
        reason: 'August was paid in the old system',
      })
      .expect(200);
  });
});

describe('September regular run', () => {
  it('calculates every employee with explained lines and income tax', async () => {
    septemberRun = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
        .expect(201)
    ).body.id;
    const run = (
      await co.hr.api
        .post(`/payroll-runs/${septemberRun}/calculate`)
        .expect(200)
    ).body;
    expect(run).toMatchObject({
      state: 'calculated',
      headcount: 6,
      engineVersion: 'payroll-engine/1.0.0',
    });

    // Rafi: one absent day = 30,000 / 30
    expect(await linesOf(septemberRun, co.rafi.employeeId)).toEqual({
      BASIC: '18000.00',
      HOUSE_RENT: '9000.00',
      MEDICAL: '1800.00',
      OTHER_ALLOWANCE: '1200.00',
      UNPAID_DAYS: '-1000.00',
    });
    // Anwar: 150,000 x 10 months = 1,500,000; exemption capped 450,000; tax 86,250 / 10 months
    const md = await linesOf(septemberRun, co.md.employeeId);
    expect(md.TAX).toBe('8625.00');
    const slip = (
      await co.hr.api
        .get(`/payroll-runs/${septemberRun}/employees/${co.md.employeeId}`)
        .expect(200)
    ).body;
    expect(slip.net).toBe('141375.00');
    expect(slip.deductions[0].explanation).toMatchObject({
      annualTax: '86250',
      monthsLeftIncludingThis: 10,
    });
  });

  it('the approving Admin sees totals and every employee (decision 2026-10-21); a department head sees nothing', async () => {
    const run = (
      await co.md.api.get(`/payroll-runs/${septemberRun}`).expect(200)
    ).body;
    expect(run.totals.net).toBeDefined();
    expect(Array.isArray(run.employees)).toBe(true);
    await co.md.api
      .get(`/payroll-runs/${septemberRun}/employees/${co.rafi.employeeId}`)
      .expect(200);
    await co.salesHead.api.get(`/payroll-runs/${septemberRun}`).expect(403);
  });

  it('cannot be submitted until every flag is cleared with a reason', async () => {
    const res = await co.hr.api
      .post(`/payroll-runs/${septemberRun}/submit`)
      .expect(400);
    expect(res.body.code).toBe('PAYROLL_FLAGS_OPEN');
    const flags = await clearAllFlags(septemberRun);
    expect(flags.filter((f) => f.code === 'MISSING_BANK_ACCOUNT')).toHaveLength(
      6,
    ); // nobody has a salary account yet
  });

  it('maker-checker: HR prepares, Accounts verifies, Admin approves; nobody approves two steps', async () => {
    // Sujit (Accounts) is also made an Admin: he still may approve only one step
    await co.owner
      .post(`/users/${co.accounts.userId}/roles`, {
        role: 'admin',
        scopeType: 'company',
        scopeId: co.companyId,
      })
      .expect(201);

    const submitted = (
      await co.hr.api.post(`/payroll-runs/${septemberRun}/submit`).expect(200)
    ).body;
    expect(submitted.state).toBe('in_approval');
    const requestId = submitted.approvalRequestId;

    // the preparer can never approve
    await co.hr.api
      .post(`/approvals/requests/${requestId}/approve`, {})
      .expect(403);

    // step 1: Accounts verifies
    await co.accounts.api
      .post(`/approvals/requests/${requestId}/approve`, {})
      .expect(200);
    expect(
      (await co.hr.api.get(`/payroll-runs/${septemberRun}`).expect(200)).body
        .state,
    ).toBe('verified');

    // step 2 goes to the Admins (Anwar, the workspace owner) except Sujit
    const request = (
      await co.md.api.get(`/approvals/requests/${requestId}`).expect(200)
    ).body;
    const step2 = request.approvers
      .filter((a: { step: number }) => a.step === 2)
      .map((a: { userId: string }) => a.userId);
    expect(step2).toContain(co.md.userId);
    expect(step2).not.toContain(co.accounts.userId);
    await co.accounts.api
      .post(`/approvals/requests/${requestId}/approve`, {})
      .expect(403);

    // Admin approves
    await co.md.api
      .post(`/approvals/requests/${requestId}/approve`, {})
      .expect(200);
    const run = (
      await co.hr.api.get(`/payroll-runs/${septemberRun}`).expect(200)
    ).body;
    expect(run.state).toBe('approved');
  });

  it('acceptance: re-calculation of the approved run reproduces identical lines', async () => {
    const res = (
      await co.accounts.api
        .get(`/payroll-runs/${septemberRun}/reproduce`)
        .expect(200)
    ).body;
    expect(res).toMatchObject({
      employees: 6,
      identical: true,
      differences: [],
    });
  });

  it('an approved run is frozen, also in the database', async () => {
    await co.hr.api.post(`/payroll-runs/${septemberRun}/calculate`).expect(409);
    await expect(
      db.withTenant({ tenantId: co.tenant.id }, () =>
        db.tx
          .deleteFrom('payroll_lines')
          .where('run_id', '=', septemberRun)
          .execute(),
      ),
    ).rejects.toThrow(/can no longer change/);
  });

  it('the employee sees the payslip', async () => {
    const list = (await co.rafi.api.get('/me/payslips').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        runId: septemberRun,
        period: '2026-09',
        net: '29000.00',
      }),
    ]);
    const slip = (
      await co.rafi.api.get(`/me/payslips/${septemberRun}`).expect(200)
    ).body;
    expect(slip.deductions).toEqual([]);
    expect(
      slip.earnings.find((l: { head: string }) => l.head === 'UNPAID_DAYS'),
    ).toMatchObject({ amount: '-1000.00' });
    expect(slip.earnings[0].explanation).toBeUndefined(); // the trace is for payroll staff
  });
});

describe('October: arrears, attendance adjustment, commission, salary advance, notice', () => {
  let octoberRun: string;

  beforeAll(async () => {
    // a back-dated increment for Rafi: 33,000 from 1 September (September was paid at 30,000)
    await co.hr.api
      .post(`/employees/${co.rafi.employeeId}/salaries`, {
        effectiveFrom: '2026-09-01',
        gross: '33000',
        structureId,
        reason: 'Increment (board decision 2026-10-14)',
      })
      .expect(201);

    // his 15 September absence was corrected after the lock (adjustment for the next payroll)
    await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .insertInto('attendance_adjustments')
        .values({
          employee_id: co.rafi.employeeId,
          work_date: '2026-09-15',
          reason: 'correction_approved',
          previous: JSON.stringify({ status: 'absent' }),
          corrected: JSON.stringify({ status: 'present' }),
        })
        .execute(),
    );

    // sales commission for October
    await co.hr.api
      .post(`${c}/payroll-variables`, {
        employeeId: co.rafi.employeeId,
        period: '2026-10',
        headCode: 'COMMISSION',
        amount: '5000',
        note: 'Q3 sales target met',
      })
      .expect(201);

    // salary advance 10,000, 2,500 a month from October: Dept Head, then Accounts
    const loan = (
      await co.hr.api
        .post(`/employees/${co.rafi.employeeId}/loans`, {
          principal: '10000',
          installment: '2500',
          firstPeriod: '2026-10',
          reason: 'Family medical emergency',
        })
        .expect(201)
    ).body;
    await co.salesHead.api
      .post(`/approvals/requests/${loan.approvalRequestId}/approve`, {})
      .expect(200);
    await co.accounts.api
      .post(`/approvals/requests/${loan.approvalRequestId}/approve`, {})
      .expect(200);

    // Sumaiya resigned; her last working day is 10 November
    await co.hr.api
      .post(`/employees/${co.financeOfficer.employeeId}/notice`, {
        lastWorkingDay: '2026-11-10',
        reason: 'Resigned (letter dated 2026-10-11)',
      })
      .expect(200);

    // October ends; attendance is locked
    clock.set(new Date('2026-11-02T10:00:00+06:00'));
    await lockMonthAllPresent('2026-10');
  });

  it('pays the arrear for September, the refund of the corrected day, commission and the first installment', async () => {
    octoberRun = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-10' })
        .expect(201)
    ).body.id;
    await co.hr.api.post(`/payroll-runs/${octoberRun}/calculate`).expect(200);
    expect(await linesOf(octoberRun, co.rafi.employeeId)).toEqual({
      BASIC: '19800.00',
      HOUSE_RENT: '9900.00',
      MEDICAL: '1980.00',
      OTHER_ALLOWANCE: '1320.00',
      ATTENDANCE_ADJUSTMENT: '1100.00', // 15 Sep refunded at the new rate 33,000 / 30
      ARREAR: '2900.00', // September now due 31,900 (33,000 less one day), paid 29,000
      COMMISSION: '5000.00',
      LOAN_RECOVERY: '2500.00',
    });
    const slip = (
      await co.hr.api
        .get(`/payroll-runs/${octoberRun}/employees/${co.rafi.employeeId}`)
        .expect(200)
    ).body;
    expect(
      slip.earnings.find((l: { head: string }) => l.head === 'ARREAR'),
    ).toMatchObject({ forPeriod: '2026-09' });
    expect(slip.net).toBe('39500.00');
  });

  it('flags the net change and the employee serving notice', async () => {
    const run = (await co.hr.api.get(`/payroll-runs/${octoberRun}`).expect(200))
      .body;
    const codes = (id: string) =>
      run.flags
        .filter((f: { employeeId: string }) => f.employeeId === id)
        .map((f: { code: string }) => f.code);
    expect(codes(co.rafi.employeeId)).toContain('NET_CHANGE'); // 29,000 -> 39,500
    expect(codes(co.financeOfficer.employeeId)).toContain('NOTICE_PERIOD');
  });

  it('a returned run goes back to HR, is recalculated and approved', async () => {
    await clearAllFlags(octoberRun);
    const submitted = (
      await co.hr.api.post(`/payroll-runs/${octoberRun}/submit`).expect(200)
    ).body;
    await co.accounts.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/return`, {
        comment: 'Please attach the increment letter',
      })
      .expect(200);
    expect(
      (await co.hr.api.get(`/payroll-runs/${octoberRun}`).expect(200)).body
        .state,
    ).toBe('calculated');

    await co.hr.api.post(`/payroll-runs/${octoberRun}/calculate`).expect(200);
    await clearAllFlags(octoberRun);
    expect((await approveRun(octoberRun)).state).toBe('approved');
  });

  it('after approval: the installment is recorded, the adjustment and the commission are paid', async () => {
    const loans = (
      await co.hr.api.get(`/employees/${co.rafi.employeeId}/loans`).expect(200)
    ).body;
    expect(loans[0]).toMatchObject({
      state: 'approved',
      recovered: '2500.00',
      outstanding: '7500.00',
    });
    const variables = (
      await co.hr.api.get(`${c}/payroll-variables?period=2026-10`).expect(200)
    ).body;
    expect(variables[0]).toMatchObject({ status: 'paid', runId: octoberRun });
    const { rows } = await db.withTenant({ tenantId: co.tenant.id }, () =>
      sql<{
        payroll_period: string;
      }>`SELECT payroll_period FROM attendance_adjustments WHERE employee_id = ${co.rafi.employeeId}`.execute(
        db.tx,
      ),
    );
    expect(rows[0].payroll_period).toBe('2026-10');
  });

  it('acceptance: October (with arrears and adjustments) also reproduces identically', async () => {
    const res = (
      await co.hr.api.get(`/payroll-runs/${octoberRun}/reproduce`).expect(200)
    ).body;
    expect(res).toMatchObject({ identical: true, differences: [] });
  });
});

describe('festival bonus (Durga Puja, 20 October 2026)', () => {
  it('pays one basic to everyone with a year of service; tax is the extra tax the bonus causes', async () => {
    const run = (
      await co.hr.api
        .post(`${c}/payroll-runs`, {
          runType: 'bonus',
          period: '2026-10',
          bonusName: 'Durga Puja 2026',
          bonusDate: '2026-10-20',
        })
        .expect(201)
    ).body;
    const calculated = (
      await co.hr.api.post(`/payroll-runs/${run.id}/calculate`).expect(200)
    ).body;
    expect(calculated).toMatchObject({ headcount: 6, notEligible: [] });

    expect(await linesOf(run.id, co.rafi.employeeId)).toEqual({
      FESTIVAL_BONUS: '19800.00',
    }); // basic of 33,000
    // Anwar: annual tax 86,250 without the bonus, 103,000 with it
    expect(await linesOf(run.id, co.md.employeeId)).toEqual({
      FESTIVAL_BONUS: '90000.00',
      TAX: '16750.00',
    });
    expect((await approveRun(run.id)).state).toBe('approved');
  });
});

describe('final settlement', () => {
  it('pays the last days and gratuity, then separates the employee', async () => {
    clock.set(new Date('2026-11-12T10:00:00+06:00'));
    const sumaiya = co.financeOfficer.employeeId;
    const settle = {
      runType: 'final_settlement',
      period: '2026-11',
      employeeId: sumaiya,
      noticeShortfallDays: 0,
    };

    // not before every department has cleared her
    const early = await co.hr.api.post(`${c}/payroll-runs`, settle).expect(400);
    expect(early.body).toMatchObject({
      code: 'SEPARATION_NOT_CLEARED',
      details: {
        open: ['it', 'admin_assets', 'accounts_advances', 'dept_handover'],
      },
    });
    const separation = (
      await co.hr.api.get(`/employees/${sumaiya}/separation`).expect(200)
    ).body;
    await co.md.api
      .post(`/separations/${separation.id}/clearances/admin_assets`, {
        note: 'Laptop and SIM returned',
      })
      .expect(200);
    await co.md.api
      .post(`/separations/${separation.id}/clearances/it`, {
        note: 'E-mail and ERP login closed',
      })
      .expect(200);
    await co.accounts.api
      .post(`/separations/${separation.id}/clearances/accounts_advances`, {
        note: 'Nothing owed',
      })
      .expect(200);
    await co.hr.api
      .post(`/separations/${separation.id}/clearances/dept_handover`, {
        note: 'Handover to Sujit, checked by HR',
      })
      .expect(200);

    const run = (await co.hr.api.post(`${c}/payroll-runs`, settle).expect(201))
      .body;
    await co.hr.api.post(`/payroll-runs/${run.id}/calculate`).expect(200);

    // 10 of 30 days of 40,000; gratuity: 1 completed year x 30 days of basic 24,000
    expect(await linesOf(run.id, sumaiya)).toEqual({
      BASIC: '8000.00',
      HOUSE_RENT: '4000.00',
      MEDICAL: '800.00',
      OTHER_ALLOWANCE: '533.33',
      GRATUITY: '24000.00',
    });
    const flags = await clearAllFlags(run.id);
    expect(flags.map((f) => f.code).sort()).toEqual([
      'MISSING_BANK_ACCOUNT',
      'NOTICE_PERIOD',
    ]);
    expect((await approveRun(run.id)).state).toBe('approved');
    expect(
      (await co.hr.api.get(`/employees/${sumaiya}`).expect(200)).body.status,
    ).toBe('separated');

    // a second settlement for the same employee is refused
    await co.hr.api
      .post(`${c}/payroll-runs`, {
        runType: 'final_settlement',
        period: '2026-11',
        employeeId: sumaiya,
      })
      .expect(409);
  });
});

function nextMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
