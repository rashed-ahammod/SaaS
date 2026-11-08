/**
 * WP8 data migration through the API (Meghna Foods test company, cut-over 1 October 2026).
 * Acceptance criterion (guide §24): pilot data imported and reconciliation signed.
 *
 * Meghna Foods already has 6 people in the system (fixture). Three more staff
 * of the Chattogram sales team come from the old payroll register, with their
 * salaries, earned-leave balances, July-September tax figures, one advance and
 * salary accounts.
 */
import ExcelJS from 'exceljs';
import type { INestApplication } from '@nestjs/common';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-01T10:00:00+06:00'));
const CUT_OVER = '2026-10-01';
let app: INestApplication;
let co: BdCompany;
let tanvirCode: string;
let rafiCode: string;
const batches: Record<string, string> = {};

const csv = (lines: string[]) => ({
  content: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'),
  name: 'data.csv',
});

async function upload(
  entity: string,
  file: { content: Buffer; name: string },
  status = 201,
) {
  return co.hr.api
    .upload(
      `/companies/${co.companyId}/imports`,
      { entity, cutOverDate: CUT_OVER },
      file,
    )
    .expect(status);
}

async function commitClean(entity: string, lines: string[]) {
  const batch = (await upload(entity, csv(lines))).body;
  expect(batch.counts.errors).toBe(0);
  await co.hr.api.post(`/imports/${batch.id}/commit`).expect(200);
  batches[entity] = batch.id;
  return batch.id as string;
}

/** The employees file as a real Excel workbook (the template's column names in row 1). */
async function employeesXlsx(): Promise<{ content: Buffer; name: string }> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('employees');
  ws.addRow([
    'employee_code',
    'full_name_en',
    'full_name_bn',
    'gender',
    'date_of_birth',
    'nid',
    'tin',
    'phone',
    'join_date',
    'branch_code',
    'department_code',
    'designation_code',
    'grade_code',
    'line_manager_code',
    'festival_group',
    'status',
    'probation_end_date',
  ]);
  ws.addRow([
    'CTG-101',
    'Shahidul Islam',
    'শহিদুল ইসলাম',
    'male',
    new Date(Date.UTC(1988, 2, 12)),
    '1988123456791',
    '123456789012',
    '01811223344',
    new Date(Date.UTC(2021, 5, 1)),
    'DHK',
    'SALES',
    'EXE',
    'G3',
    tanvirCode,
    'eid',
    'active',
    '',
  ]);
  ws.addRow([
    'CTG-102',
    'Nasrin Akter',
    'নাসরিন আক্তার',
    'female',
    '1995-07-21',
    '1995123456792',
    '',
    '01911223344',
    '2024-02-01',
    'DHK',
    'SALES',
    'EXE',
    'G3',
    'CTG-101',
    'eid',
    'active',
    '',
  ]);
  ws.addRow([
    'CTG-103',
    'Pradip Barua',
    'প্রদীপ বড়ুয়া',
    'male',
    '1999-11-02',
    '1999123456793',
    '',
    '01711223344',
    '2026-06-01',
    'DHK',
    'SALES',
    'EXE',
    'G3',
    'CTG-101',
    'puja',
    'probation',
    '2026-11-30',
  ]);
  ws.addRow([
    'CTG-104',
    'Bad Row',
    '',
    '',
    '',
    '12345',
    '',
    '',
    '2026-11-01',
    'DHK',
    'NOPE',
    'EXE',
    'G3',
    '',
    '',
    '',
    '',
  ]);
  return {
    content: Buffer.from(await wb.xlsx.writeBuffer()),
    name: 'employees.xlsx',
  };
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  const c = `/companies/${co.companyId}`;
  tanvirCode = (
    await co.hr.api.get(`/employees/${co.salesHead.employeeId}`).expect(200)
  ).body.employeeCode;
  rafiCode = (
    await co.hr.api.get(`/employees/${co.rafi.employeeId}`).expect(200)
  ).body.employeeCode;

  // the system is set up before migration: rule pack, leave types, salary heads and structure
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.2',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  await co.hr.api.post(`${c}/leave-types/defaults`).expect(201);
  await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201);
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('templates', () => {
  it('seven templates in load order (customers last), downloadable as Excel or CSV', async () => {
    const list = (await co.hr.api.get('/imports/templates').expect(200)).body;
    expect(list.map((t: { entity: string }) => t.entity)).toEqual([
      'employees',
      'salaries',
      'leave_balances',
      'ytd_openings',
      'loans',
      'bank_accounts',
      'customers',
    ]);
    const xlsx = await co.hr.api
      .get('/imports/templates/employees')
      .expect(200);
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const text = (
      await co.hr.api.get('/imports/templates/loans?format=csv').expect(200)
    ).text;
    expect(text.split('\r\n')[0]).toBe(
      'employee_code,outstanding,installment,next_period,reason',
    );
  });

  it('a file with wrong columns is refused as a whole', async () => {
    const res = await upload(
      'loans',
      csv(['employee_code,amount', 'X,1']),
      400,
    );
    expect(res.body.details.problems).toContain('Missing column "outstanding"');
  });
});

describe('employees: validate, skip, dry run, commit', () => {
  let batchId: string;

  it('upload validates every row and shows the errors by column', async () => {
    const batch = (await upload('employees', await employeesXlsx())).body;
    batchId = batch.id;
    expect(batch.counts).toEqual({ total: 4, valid: 3, errors: 1, skipped: 0 });
    const detail = (await co.hr.api.get(`/imports/${batchId}`).expect(200))
      .body;
    expect(detail.rows[0]).toMatchObject({ rowNo: 5, status: 'error' });
    expect(
      detail.rows[0].errors.map((e: { column: string }) => e.column).sort(),
    ).toEqual(['department_code', 'join_date', 'nid']);
    // nothing is created yet
    await co.hr.api.post(`/imports/${batchId}/commit`).expect(400);
  });

  it('staged NID and TIN are encrypted at rest and masked on screen (guide §20)', async () => {
    const stored = await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .selectFrom('import_rows')
        .select('data')
        .where('batch_id', '=', batchId)
        .execute(),
    );
    const raw = JSON.stringify(stored);
    expect(raw).not.toContain('1988123456791');
    expect(raw).not.toContain('123456789012');
    expect(raw).toContain('"nid":"enc:v1:');
    const shown = (
      await co.hr.api.get(`/imports/${batchId}`).expect(200)
    ).body.rows.find((r: { rowNo: number }) => r.rowNo === 2);
    expect(shown.data).toMatchObject({
      nid: '**** **** 791',
      tin: '**** **** 012',
      phone: '01811223344',
    });
  });

  it('the bad row is skipped with a reason; dry run shows headcount per department', async () => {
    await co.hr.api
      .post(`/imports/${batchId}/rows/5/skip`, {
        reason: 'Joins in November, will be added in the system',
      })
      .expect(200);
    const dry = (await co.hr.api.get(`/imports/${batchId}/dry-run`).expect(200))
      .body;
    expect(dry).toMatchObject({
      willCreate: 3,
      skipped: 1,
      canCommit: true,
      totals: {
        headcountByDepartment: { SALES: 3 },
        byStatus: { active: 2, probation: 1 },
      },
    });
  });

  it('commit creates active employees with their old codes and line managers', async () => {
    await co.hr.api.post(`/imports/${batchId}/commit`).expect(200);
    batches.employees = batchId;
    const list = (
      await co.hr.api
        .get(`/employees?companyId=${co.companyId}&q=CTG-10`)
        .expect(200)
    ).body.items;
    expect(
      list
        .map(
          (e: { employeeCode: string; status: string }) =>
            `${e.employeeCode}:${e.status}`,
        )
        .sort(),
    ).toEqual(['CTG-101:active', 'CTG-102:active', 'CTG-103:probation']);
    // Nasrin reports to Shahidul (created first, though he is the row above her)
    const id = (code: string) =>
      list.find((e: { employeeCode: string }) => e.employeeCode === code).id;
    const nasrin = (
      await co.hr.api.get(`/employees/${id('CTG-102')}`).expect(200)
    ).body;
    expect(JSON.stringify(nasrin.currentAssignment)).toContain(id('CTG-101'));
    // committing again is impossible
    await co.hr.api.post(`/imports/${batchId}/commit`).expect(409);
  });
});

describe('balances and history', () => {
  it('salaries, leave balances, YTD tax and PF, advances and salary accounts', async () => {
    await commitClean('salaries', [
      'employee_code,effective_from,gross,structure_code,reason',
      'CTG-101,2026-07-01,"55,000",STD,Annual increment 2026',
      'CTG-102,2024-02-01,32000,,',
      'CTG-103,2026-06-01,22000,STD,Joining salary',
      `${rafiCode},2025-01-01,30000,STD,Joining salary`,
    ]);
    await commitClean('leave_balances', [
      'employee_code,leave_type_code,days',
      'CTG-101,EL,24.5',
      'CTG-102,EL,11',
      'CTG-102,CL,3',
    ]);
    await commitClean('ytd_openings', [
      'employee_code,fiscal_year,taxable_income,tax_withheld,pf_employee,pf_employer',
      'CTG-101,2026-27,165000,1250,9900,9900',
      'CTG-102,2026-27,96000,0,0,0',
      'CTG-103,2026-27,66000,0,0,0',
    ]);
    await commitClean('loans', [
      'employee_code,outstanding,installment,next_period,reason',
      'CTG-102,9000,3000,2026-10,Medical advance (old register no. 45)',
    ]);
    await commitClean('bank_accounts', [
      'employee_code,kind,account_name,bank_name,branch_name,routing_number,account_number,wallet_provider,wallet_number',
      'CTG-101,bank,Shahidul Islam,Islami Bank Bangladesh PLC,Agrabad,125150201,20501234567,,',
      'CTG-102,wallet,Nasrin Akter,,,,,bkash,01911223344',
    ]);

    // they are ordinary records now
    const shahidul = (
      await co.hr.api
        .get(`/employees?companyId=${co.companyId}&q=CTG-101`)
        .expect(200)
    ).body.items[0];
    const balances = (
      await co.hr.api
        .get(`/employees/${shahidul.id}/leave-balances?asOf=2026-09-30`)
        .expect(200)
    ).body.balances;
    expect(
      balances.find((b: { code: string }) => b.code === 'EL').balance,
    ).toBe(24.5);
    expect(
      (await co.hr.api.get(`/employees/${shahidul.id}/salaries`).expect(200))
        .body.current.gross,
    ).toBe('55000.00');
    const nasrin = (
      await co.hr.api
        .get(`/employees?companyId=${co.companyId}&q=CTG-102`)
        .expect(200)
    ).body.items[0];
    expect(
      (await co.hr.api.get(`/employees/${nasrin.id}/loans`).expect(200))
        .body[0],
    ).toMatchObject({
      state: 'approved',
      outstanding: '9000.00',
      firstPeriod: '2026-10',
    });
  });

  it('the same data cannot be imported twice', async () => {
    const res = (
      await upload(
        'ytd_openings',
        csv([
          'employee_code,fiscal_year,taxable_income,tax_withheld',
          'CTG-101,2026-27,1,0',
        ]),
      )
    ).body;
    expect(res.counts.errors).toBe(1);
  });
});

describe('rollback until sign-off', () => {
  it('employees cannot be rolled back while later batches use them', async () => {
    const res = await co.hr.api
      .post(`/imports/${batches.employees}/rollback`, { reason: 'Test' })
      .expect(409);
    expect(res.body.code).toBe('IMPORT_ROLLBACK_BLOCKED');
  });

  it('a wrong leave file is rolled back and loaded again', async () => {
    await co.hr.api
      .post(`/imports/${batches.leave_balances}/rollback`, {
        reason: 'CL balances were from the wrong year',
      })
      .expect(200);
    const nasrin = (
      await co.hr.api
        .get(`/employees?companyId=${co.companyId}&q=CTG-102`)
        .expect(200)
    ).body.items[0];
    let balances = (
      await co.hr.api
        .get(`/employees/${nasrin.id}/leave-balances?asOf=2026-09-30`)
        .expect(200)
    ).body.balances;
    expect(
      balances.find((b: { code: string }) => b.code === 'EL').balance,
    ).toBe(0);

    await commitClean('leave_balances', [
      'employee_code,leave_type_code,days',
      'CTG-101,EL,24.5',
      'CTG-102,EL,11',
      'CTG-102,CL,1.5',
    ]);
    balances = (
      await co.hr.api
        .get(`/employees/${nasrin.id}/leave-balances?asOf=2026-09-30`)
        .expect(200)
    ).body.balances;
    expect(
      balances.find((b: { code: string }) => b.code === 'CL').balance,
    ).toBe(1.5);
  });
});

describe('acceptance: reconciliation signed', () => {
  it('the report adds up what is in the system on 30 September', async () => {
    const report = (
      await co.md.api
        .get(
          `/companies/${co.companyId}/migration/reconciliation?cutOverDate=${CUT_OVER}`,
        )
        .expect(200)
    ).body;
    expect(report).toMatchObject({
      asOf: '2026-09-30',
      fiscalYear: '2026-27',
      headcount: 9,
      totalGross: '139000.00',
    });
    expect(
      report.departments.find((d: { department: string }) =>
        d.department.startsWith('SALES '),
      ),
    ).toMatchObject({ headcount: 4, withSalary: 3, gross: '109000.00' });
    expect(report.leaveBalances).toEqual([
      { code: 'CL', employees: 1, days: '1.50' },
      { code: 'EL', employees: 2, days: '35.50' },
    ]);
    expect(report.yearToDate).toEqual({
      employees: 3,
      taxableIncome: '327000.00',
      taxWithheld: '1250.00',
      pfEmployee: '9900.00',
      pfEmployer: '9900.00',
    });
    expect(report.advances).toEqual({ loans: 1, outstanding: '9000.00' });
    expect(report.salaryAccounts).toEqual({ bank: 1, bkash: 1, cash: 7 });
  });

  it('HR cannot sign; the customer (Admin) signs and the batches are locked', async () => {
    await co.hr.api
      .post(`/companies/${co.companyId}/migration/sign-off`, {
        cutOverDate: CUT_OVER,
        note: 'x',
      })
      .expect(403);
    const signed = (
      await co.md.api
        .post(`/companies/${co.companyId}/migration/sign-off`, {
          cutOverDate: CUT_OVER,
          note: 'Checked against the September 2026 register and the bank list',
        })
        .expect(201)
    ).body;
    expect(signed).toMatchObject({
      batches: 6,
      reportSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    const list = (
      await co.hr.api.get(`/companies/${co.companyId}/imports`).expect(200)
    ).body;
    expect(
      list.filter((b: { state: string }) => b.state === 'signed_off'),
    ).toHaveLength(6);
    await co.hr.api
      .post(`/imports/${batches.loans}/rollback`, { reason: 'Too late' })
      .expect(409);
    expect(
      (
        await co.md.api
          .get(`/companies/${co.companyId}/migration/sign-offs`)
          .expect(200)
      ).body[0].note,
    ).toMatch(/September 2026 register/);
  });
});
