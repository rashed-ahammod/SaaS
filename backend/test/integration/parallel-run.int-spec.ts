/**
 * Gate 1 (spec §12, WP12): two parallel payrolls that match the pilot's current
 * payroll. Meghna Foods' old system register is compared with the ERP's August
 * and September runs; HR explains differences; Accounts accepts.
 */
import type { INestApplication } from '@nestjs/common';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-15T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
const runs: Record<string, string> = {};

const GROSS: Array<[keyof BdCompany, string]> = [
  ['md', '150000'],
  ['hr', '80000'],
  ['accounts', '90000'],
  ['financeOfficer', '40000'],
  ['salesHead', '100000'],
  ['rafi', '30000'],
];

interface RunEmployee {
  employeeCode: string;
  gross: string;
  deductions: string;
  net: string;
  tax: string;
}

const nextMonth = (period: string) => {
  const [y, m] = period.split('-').map(Number);
  return m === 12
    ? `${y + 1}-01-01`
    : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

async function lockMonthAllPresent(period: string) {
  await co.hr.api
    .post('/attendance/locks', { companyId: co.companyId, period })
    .expect(201);
  await db.withTenant({ tenantId: co.tenant.id }, () =>
    db.tx
      .updateTable('attendance_days')
      .set({ status: 'present', worked_minutes: 540 })
      .where('company_id', '=', co.companyId)
      .where('work_date', '>=', `${period}-01`)
      .where('work_date', '<', nextMonth(period))
      .where('status', '=', 'absent')
      .execute(),
  );
}

async function calculatedRun(period: string): Promise<RunEmployee[]> {
  runs[period] = (
    await co.hr.api
      .post(`${c}/payroll-runs`, { runType: 'regular', period })
      .expect(201)
  ).body.id;
  await co.hr.api.post(`/payroll-runs/${runs[period]}/calculate`).expect(200);
  return (await co.hr.api.get(`/payroll-runs/${runs[period]}`).expect(200)).body
    .employees;
}

/** The old system's register as the pilot would export it (lakh-style separators, quoted). */
function register(rows: Array<[string, string, string, string, string]>) {
  const lines = [
    'Employee Code,Gross,Total Deductions,Net,Tax',
    ...rows.map((r) => r.map((v) => `"${v}"`).join(',')),
  ];
  return {
    content: Buffer.from(lines.join('\r\n') + '\r\n'),
    name: 'old-payroll-register.csv',
  };
}
const asRow = (e: RunEmployee): [string, string, string, string, string] => [
  e.employeeCode,
  e.gross,
  e.deductions,
  e.net,
  e.tax,
];
const upload = (
  period: string,
  file: { content: Buffer; name: string },
  tolerance = '0.50',
) =>
  co.hr.api.upload(
    `/payroll-runs/${runs[period]}/parallel-comparisons`,
    { tolerance },
    file,
  );

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
  const structureId = (
    await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201)
  ).body.structureId;
  for (const [key, gross] of GROSS) {
    await co.hr.api
      .post(
        `/employees/${(co[key] as BdCompany['rafi']).employeeId}/salaries`,
        {
          effectiveFrom: '2025-01-01',
          gross,
          structureId,
          reason: 'Joining salary',
        },
      )
      .expect(201);
  }
  await lockMonthAllPresent('2026-08');
  await lockMonthAllPresent('2026-09');
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('Gate 1: parallel payroll', () => {
  let august: string;

  it('the register template', async () => {
    const res = await co.hr.api
      .get('/parallel-comparisons/template')
      .expect(200);
    expect(res.text.split('\r\n')[0]).toBe(
      'employee_code,gross,total_deductions,net,tax,pf_employee',
    );
  });

  it('August: compares every employee; whole-paisa rounding inside the tolerance is a match', async () => {
    const erp = await calculatedRun('2026-08');
    const [first, second, , ...rest] = erp;
    const rows = [
      // the old system rounds net pay: 0.40 off is within Tk 0.50
      [
        first.employeeCode,
        first.gross,
        first.deductions,
        (Number(first.net) - 0.4).toFixed(2),
        first.tax,
      ],
      // the old system withheld no tax for this person
      [
        second.employeeCode,
        second.gross,
        (Number(second.deductions) - Number(second.tax)).toFixed(2),
        (Number(second.net) + Number(second.tax)).toFixed(2),
        '0.00',
      ],
      ...rest.map(asRow),
      // left in July in the old system, still in its register
      ['MFL-OLD99', '25,000.00', '0.00', '25,000.00', '0.00'],
    ] as Array<[string, string, string, string, string]>;
    const res = (await upload('2026-08', register(rows)).expect(201)).body;
    august = res.id;
    expect(res).toMatchObject({
      period: '2026-08',
      employees: 7,
      matched: 4,
      different: 1,
      missingInErp: 1,
      missingInLegacy: 1,
      status: 'open',
      outdated: false,
    });
    expect(res.lines[0]).toMatchObject({
      employeeCode: second.employeeCode,
      outcome: 'different',
      differences: { tax: second.tax },
    });
  });

  it('a register that cannot be compared is refused as a whole', async () => {
    const res = await upload('2026-08', {
      content: Buffer.from('code,amount\r\nX,1\r\n'),
      name: 'x.csv',
    }).expect(400);
    expect(res.body.code).toBe('PARALLEL_FILE_INVALID');
    expect(res.body.details.problems).toContain(
      'Missing column "employee_code"',
    );
  });

  it('Accounts cannot accept while differences are unexplained; HR explains them', async () => {
    const refused = await co.accounts.api
      .post(`/parallel-comparisons/${august}/accept`, {})
      .expect(409);
    expect(refused.body.code).toBe('PARALLEL_UNEXPLAINED');
    expect(refused.body.details.employees).toHaveLength(3);
    for (const code of refused.body.details.employees) {
      await co.hr.api
        .post(`/parallel-comparisons/${august}/lines/${code}/explain`, {
          explanation:
            'Checked with the August bank advice: the old system missed the tax / kept a leaver',
        })
        .expect(200);
    }
  });

  it('only Accounts accepts (maker-checker); one month is not yet Gate 1', async () => {
    await co.hr.api
      .post(`/parallel-comparisons/${august}/accept`, {})
      .expect(403);
    const gate = (
      await co.accounts.api
        .post(`/parallel-comparisons/${august}/accept`, {
          note: 'Agreed with HR on 15 October',
        })
        .expect(200)
    ).body;
    expect(gate).toMatchObject({
      acceptedMonths: ['2026-08'],
      gate1Passed: false,
      requiredMonths: 2,
    });
    await co.accounts.api
      .post(`/parallel-comparisons/${august}/accept`, {})
      .expect(409);
  });

  it('September matches exactly: two months accepted = Gate 1 passed', async () => {
    const erp = await calculatedRun('2026-09');
    const res = (
      await upload('2026-09', register(erp.map(asRow)), '0').expect(201)
    ).body;
    expect(res).toMatchObject({ employees: 6, matched: 6, different: 0 });
    const gate = (
      await co.accounts.api
        .post(`/parallel-comparisons/${res.id}/accept`, {})
        .expect(200)
    ).body;
    expect(gate).toMatchObject({
      acceptedMonths: ['2026-08', '2026-09'],
      gate1Passed: true,
    });
  });

  it('recalculating a run after acceptance makes its comparison outdated (Gate 1 falls back)', async () => {
    clock.set(new Date('2026-10-16T11:00:00+06:00'));
    await co.hr.api
      .post(`/payroll-runs/${runs['2026-09']}/calculate`)
      .expect(200);
    const gate = (await co.hr.api.get(`${c}/gate-1`).expect(200)).body;
    expect(gate).toMatchObject({
      acceptedMonths: ['2026-08'],
      gate1Passed: false,
    });
    expect(
      gate.comparisons.find((x: { period: string }) => x.period === '2026-09'),
    ).toMatchObject({ status: 'accepted', outdated: true });
  });

  it('amounts are for payroll people only', async () => {
    await co.rafi.api.get(`/parallel-comparisons/${august}`).expect(403);
    await co.salesHead.api.get(`${c}/gate-1`).expect(403);
    await co.md.api.get(`/parallel-comparisons/${august}`).expect(200); // the approving Admin reads salaries (2026-10-21)
    await co.md.api.get(`${c}/gate-1`).expect(200);
  });
});
