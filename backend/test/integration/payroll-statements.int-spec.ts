/**
 * Payroll audit fixes (2026-10-21) through the API (Meghna Foods test company):
 * an employee asks for their own salary advance, Accounts lists advances to pay
 * out, the PF ledger per member with the company match, the annual salary tax
 * certificate (JSON and PDF, own and staff), and salary tax challans.
 *
 * September 2026: Rafi 30,000 (BASIC 18,000) and Anwar (MD) 150,000; PF 5% + 5%
 * of BASIC. Anwar earned 300,000 at his previous employer earlier in 2026-27,
 * with 12,000 tax withheld there.
 */
import type { INestApplication } from '@nestjs/common';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-02T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let runId: string;

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;

  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.2',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  await co.hr.api
    .put(`${c}/payroll-settings`, {
      pfEmployeePercent: '5',
      pfEmployerPercent: '5',
    })
    .expect(200);
  const structureId = (
    await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201)
  ).body.structureId;
  for (const [person, gross] of [
    [co.md, '150000'],
    [co.hr, '80000'],
    [co.accounts, '90000'],
    [co.financeOfficer, '40000'],
    [co.salesHead, '100000'],
    [co.rafi, '30000'],
  ] as const) {
    await co.hr.api
      .post(`/employees/${person.employeeId}/salaries`, {
        effectiveFrom: '2025-01-01',
        gross,
        structureId,
        reason: 'Joining salary',
      })
      .expect(201);
  }
  await co.hr.api
    .put(`/employees/${co.md.employeeId}/ytd-openings`, {
      fiscalYear: '2026-27',
      kind: 'prior_employer',
      taxableIncome: '300000',
      taxWithheld: '12000',
      note: 'Form from Pran-RFL',
    })
    .expect(200);
  await co.hr.api
    .put(`/employees/${co.rafi.employeeId}/pf-opening`, {
      asOf: '2026-06-30',
      employeePart: '4500',
      employerPart: '4500',
      note: 'From the old payroll',
    })
    .expect(200);

  await co.hr.api
    .post('/attendance/locks', { companyId: co.companyId, period: '2026-09' })
    .expect(201);
  await db.withTenant({ tenantId: co.tenant.id }, () =>
    db.tx
      .updateTable('attendance_days')
      .set({ status: 'present', worked_minutes: 540 })
      .where('company_id', '=', co.companyId)
      .where('status', '=', 'absent')
      .execute(),
  );
  runId = (
    await co.hr.api
      .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
      .expect(201)
  ).body.id;
  const calc = await co.hr.api.post(`/payroll-runs/${runId}/calculate`);
  expect(calc.status, JSON.stringify(calc.body)).toBe(200);
  const run = (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body;
  for (const f of run.flags)
    await co.hr.api
      .post(`/payroll-flags/${f.id}/clear`, { reason: `Checked: ${f.code}` })
      .expect(200);
  const submitted = (
    await co.hr.api.post(`/payroll-runs/${runId}/submit`).expect(200)
  ).body;
  await co.accounts.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
  await co.md.api
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('salary advances asked for by the employee', () => {
  it('Rafi asks for his own advance; not for someone else', async () => {
    const loan = (
      await co.rafi.api
        .post(`/employees/${co.rafi.employeeId}/loans`, {
          principal: '12000',
          installment: '3000',
          firstPeriod: '2026-11',
          reason: 'Admission fee for my daughter at Ideal School',
        })
        .expect(201)
    ).body;
    expect(loan).toMatchObject({
      state: 'pending',
      principal: '12000.00',
      approvalRequestId: expect.any(String),
    });
    await co.rafi.api
      .post(`/employees/${co.salesHead.employeeId}/loans`, {
        principal: '5000',
        installment: '1000',
        firstPeriod: '2026-11',
        reason: 'x',
      })
      .expect(403);
    const mine = (
      await co.rafi.api
        .get(`/employees/${co.rafi.employeeId}/loans`)
        .expect(200)
    ).body;
    expect(mine.map((l: { id: string }) => l.id)).toContain(loan.id);
    await co.rafi.api.get(`/employees/${co.md.employeeId}/loans`).expect(403);

    // department head, then Accounts
    await co.salesHead.api
      .post(`/approvals/requests/${loan.approvalRequestId}/approve`, {})
      .expect(200);
    await co.accounts.api
      .post(`/approvals/requests/${loan.approvalRequestId}/approve`, {})
      .expect(200);

    // Accounts sees it waiting for the payout; a department head cannot list
    const toPay = (
      await co.accounts.api
        .get(`${c}/loans?state=approved&unpaid=true`)
        .expect(200)
    ).body;
    expect(toPay).toEqual([
      expect.objectContaining({
        id: loan.id,
        employeeCode: expect.stringMatching(/^MFL-/),
        paidAt: null,
      }),
    ]);
    await co.salesHead.api.get(`${c}/loans`).expect(403);
  });
});

describe('PF ledger', () => {
  it('opening balance, then the employee part and the company match of each approved run', async () => {
    const ledger = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/pf-ledger`)
        .expect(200)
    ).body;
    expect(ledger).toMatchObject({
      member: true,
      opening: {
        asOf: '2026-06-30',
        employeePart: '4500.00',
        employerPart: '4500.00',
      },
      entries: [
        {
          runId,
          period: '2026-09',
          employeePart: '900.00',
          employerPart: '900.00',
          balance: '10800.00',
        },
      ],
      totals: {
        employeePart: '5400.00',
        employerPart: '5400.00',
        balance: '10800.00',
      },
    });
  });

  it('the employee reads their own; the approving Admin reads anyone’s; a department head cannot', async () => {
    expect(
      (await co.rafi.api.get('/me/pf-ledger').expect(200)).body.totals.balance,
    ).toBe('10800.00');
    await co.md.api
      .get(`/employees/${co.rafi.employeeId}/pf-ledger`)
      .expect(200);
    await co.salesHead.api
      .get(`/employees/${co.rafi.employeeId}/pf-ledger`)
      .expect(403);
    await co.rafi.api
      .get(`/employees/${co.md.employeeId}/pf-ledger`)
      .expect(403);
    await co.accounts.api
      .put(`/employees/${co.rafi.employeeId}/pf-opening`, {
        asOf: '2026-06-30',
        employeePart: '1',
        employerPart: '1',
      })
      .expect(403);
  });
});

describe('salary tax challans and the tax certificate', () => {
  let mdTax: string;

  it('Accounts records the challan for the month; tax withheld vs deposited', async () => {
    const before = (
      await co.accounts.api
        .get(`${c}/salary-tax-challans?fiscalYear=2026-27`)
        .expect(200)
    ).body;
    const september = before.months.find(
      (m: { period: string }) => m.period === '2026-09',
    );
    mdTax = (
      await co.hr.api
        .get(`/payroll-runs/${runId}/employees/${co.md.employeeId}`)
        .expect(200)
    ).body.tax.thisMonth;
    expect(Number(september.withheld)).toBeGreaterThan(0);
    expect(september.due).toBe(september.withheld);

    await co.hr.api
      .post(`${c}/salary-tax-challans`, {
        period: '2026-09',
        challanNo: 'tr-0912',
        challanDate: '2026-10-12',
        amount: september.withheld,
      })
      .expect(403);
    const challan = (
      await co.accounts.api
        .post(`${c}/salary-tax-challans`, {
          period: '2026-09',
          challanNo: 'tr-0912',
          challanDate: '2026-10-12',
          amount: september.withheld,
        })
        .expect(201)
    ).body;
    expect(challan.challanNo).toBe('TR-0912');
    const dup = await co.accounts.api
      .post(`${c}/salary-tax-challans`, {
        period: '2026-09',
        challanNo: 'TR-0912',
        challanDate: '2026-10-12',
        amount: '1',
      })
      .expect(409);
    expect(dup.body.code).toBe('SALARY_TAX_CHALLAN_DUPLICATE');

    const after = (
      await co.hr.api
        .get(`${c}/salary-tax-challans?fiscalYear=2026-27`)
        .expect(200)
    ).body;
    expect(
      after.months.find((m: { period: string }) => m.period === '2026-09'),
    ).toMatchObject({ deposited: september.withheld, due: '0.00' });

    // a wrong one is cancelled, not deleted
    const wrong = (
      await co.accounts.api
        .post(`${c}/salary-tax-challans`, {
          period: '2026-09',
          challanNo: 'TR-0999',
          challanDate: '2026-10-12',
          amount: '100',
        })
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/salary-tax-challans/${wrong.id}/cancel`, {
        reason: 'Typed the wrong month',
      })
      .expect(200);
    await co.accounts.api
      .post(`/salary-tax-challans/${wrong.id}/cancel`, { reason: 'again' })
      .expect(404);
  });

  it('the certificate shows salary by head, tax per month with its challan, and the previous employer', async () => {
    const cert = (
      await co.hr.api
        .get(
          `/employees/${co.md.employeeId}/tax-certificate?fiscalYear=2026-27`,
        )
        .expect(200)
    ).body;
    expect(cert).toMatchObject({
      fiscalYear: '2026-27',
      from: '2026-07-01',
      to: '2027-06-30',
      final: false,
      months: [
        {
          period: '2026-09',
          gross: '150000.00',
          tax: mdTax,
          challans: [{ challanNo: 'TR-0912', challanDate: '2026-10-12' }],
        },
      ],
      earlier: [
        {
          kind: 'prior_employer',
          taxableIncome: '300000.00',
          taxWithheld: '12000.00',
        },
      ],
    });
    expect(
      cert.income.find((l: { head: string }) => l.head === 'BASIC'),
    ).toMatchObject({ amount: '90000.00', taxable: true });
    expect(cert.totals.taxIncludingEarlier).toBe(
      (Number(mdTax) + 12000).toFixed(2),
    );
  });

  it('the employee gets their own certificate, in Bangla as PDF; others are refused', async () => {
    expect(
      (await co.rafi.api.get('/me/tax-certificates').expect(200)).body,
    ).toEqual([{ fiscalYear: '2026-27', final: false }]);
    const own = (
      await co.rafi.api
        .get('/me/tax-certificate?fiscalYear=2026-27')
        .expect(200)
    ).body;
    expect(own.employee.id).toBe(co.rafi.employeeId);
    const pdf = await co.rafi.api
      .get('/me/tax-certificate/pdf?fiscalYear=2026-27&lang=bn')
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (b: Buffer) => chunks.push(b));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    await co.rafi.api
      .get(`/employees/${co.md.employeeId}/tax-certificate?fiscalYear=2026-27`)
      .expect(403);
    await co.salesHead.api
      .get(
        `/employees/${co.rafi.employeeId}/tax-certificate?fiscalYear=2026-27`,
      )
      .expect(403);
    await co.md.api
      .get(
        `/employees/${co.rafi.employeeId}/tax-certificate?fiscalYear=2026-27`,
      )
      .expect(200);
  });

  it('refuses a year that is not two years in a row, and a year without salary', async () => {
    await co.rafi.api.get('/me/tax-certificate?fiscalYear=2026-28').expect(400);
    expect(
      (
        await co.rafi.api
          .get('/me/tax-certificate?fiscalYear=2025-26')
          .expect(404)
      ).body.code,
    ).toBe('TAX_CERTIFICATE_EMPTY');
  });
});
