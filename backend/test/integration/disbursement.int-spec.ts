/**
 * WP7 disbursement and payslips through the API (Meghna Foods test company).
 * Acceptance criterion (guide §24): a duplicate payment is impossible.
 * Plus: bank / wallet / cash files with checksum, regenerate only after a cancel
 * with a second approval, return-file import, re-issue, run "disbursed",
 * payslip PDFs (Bangla / English, password), salary journal balances.
 *
 * September 2026, salaries: Anwar 150,000 · Farzana 80,000 · Sujit 90,000 ·
 * Sumaiya 40,000 · Tanvir 100,000 · Rafi 30,000. Rafi is paid to Dutch-Bangla
 * Bank, Tanvir to bKash, everyone else in cash.
 */
import { createHash } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import type { Response } from 'supertest';
import { ManualClock } from '../../src/platform/clock.js';
import { startApp, type Api } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-02T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let runId: string;

type Payment = {
  id: string;
  employeeId: string;
  channel: string;
  status: string;
  reference: string;
  amount: string;
};

/** GET a file as raw bytes. */
async function download(
  api: Api,
  url: string,
  status = 200,
): Promise<Response> {
  return api
    .get(url)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .expect(status);
}

async function payments(): Promise<Payment[]> {
  return (
    await co.accounts.api.get(`/payroll-runs/${runId}/payments`).expect(200)
  ).body.payments;
}
const paymentOf = async (employeeId: string, status?: string) =>
  (await payments()).find(
    (p) => p.employeeId === employeeId && (!status || p.status === status),
  )!;

async function tenantSql<T>(query: ReturnType<typeof sql<T>>) {
  return db.withTenant({ tenantId: co.tenant.id }, () => query.execute(db.tx));
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  const c = `/companies/${co.companyId}`;

  // rule pack, heads, salaries
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

  // salary accounts (each requested by the employee, approved by HR)
  const account = async (person: BdCompany['rafi'], body: object) => {
    const r = (
      await person.api
        .post(`/employees/${person.employeeId}/bank-accounts`, body)
        .expect(201)
    ).body;
    await co.hr.api
      .post(`/approvals/requests/${r.approvalRequestId}/approve`, {})
      .expect(200);
  };
  await account(co.rafi, {
    kind: 'bank',
    bankName: 'Dutch-Bangla Bank PLC',
    branchName: 'Gulshan, Dhaka',
    routingNumber: '090261725',
    accountName: 'Mahmudul Hasan Rafi',
    accountNumber: '1051100012345',
  });
  await account(co.salesHead, {
    kind: 'wallet',
    walletProvider: 'bkash',
    walletNumber: '01719876543',
    accountName: 'Tanvir Hossain',
  });

  // September locked, everyone present
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

  // the September run: calculated, flags cleared, Accounts verifies, Admin approves
  runId = (
    await co.hr.api
      .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
      .expect(201)
  ).body.id;
  await co.hr.api.post(`/payroll-runs/${runId}/calculate`).expect(200);
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

describe('payments', () => {
  it('approval creates one payment per employee, to the account approved at that moment', async () => {
    const list = (
      await co.accounts.api.get(`/payroll-runs/${runId}/payments`).expect(200)
    ).body;
    expect(list.payments).toHaveLength(6);
    const channel = (id: string) =>
      list.payments.find((p: Payment) => p.employeeId === id).channel;
    expect(channel(co.rafi.employeeId)).toBe('bank');
    expect(channel(co.salesHead.employeeId)).toBe('bkash');
    expect(channel(co.md.employeeId)).toBe('cash');
    expect(
      list.payments.find((p: Payment) => p.employeeId === co.rafi.employeeId),
    ).toMatchObject({
      amount: '30000.00',
      status: 'approved',
      reference: expect.stringMatching(/^PAY-2026-09-[0-9A-F]{8}$/),
    });
  });

  it('acceptance: a duplicate payment is impossible', async () => {
    // a second payment for the same employee, month and pay type is refused by the database
    await expect(
      tenantSql(sql`INSERT INTO payments (company_id, run_id, employee_id, period, pay_type, amount, channel, reference)
                    VALUES (${co.companyId}, ${runId}, ${co.md.employeeId}, '2026-09', 'salary', 150000, 'cash', 'PAY-DUPLICATE')`),
    ).rejects.toThrow(/one_payment_per_period/);
    // the amount or destination of a payment can never be edited
    await expect(
      tenantSql(sql`UPDATE payments SET amount = 1 WHERE run_id = ${runId}`),
    ).rejects.toThrow(/cannot change/);
    // the run cannot be approved or recalculated again
    await co.hr.api.post(`/payroll-runs/${runId}/calculate`).expect(409);
  });

  it('payments (bank details) stay hidden from Admin', async () => {
    await co.md.api.get(`/payroll-runs/${runId}/payments`).expect(403);
  });
});

describe('bank file', () => {
  let fileId: string;

  it('is generated per channel with a checksum; the same click twice gives the same file', async () => {
    const key = 'f7a6a2d4-3c1e-4a8b-9b51-0d6a3f2b9e10';
    const first = await co.accounts.api
      .post(
        `/payroll-runs/${runId}/disbursement-files`,
        { channel: 'bank' },
        { 'Idempotency-Key': key },
      )
      .expect(201);
    const again = await co.accounts.api
      .post(
        `/payroll-runs/${runId}/disbursement-files`,
        { channel: 'bank' },
        { 'Idempotency-Key': key },
      )
      .expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(first.body).toMatchObject({
      channel: 'bank',
      adapter: 'beftn-csv',
      payments: 1,
      total: '30000.00',
      state: 'active',
    });
    fileId = first.body.id;

    // a new request (new key) for the same channel is refused while the file is active
    const second = await co.accounts.api
      .post(`/payroll-runs/${runId}/disbursement-files`, { channel: 'bank' })
      .expect(409);
    expect(second.body.code).toBe('DISBURSEMENT_FILE_ACTIVE');
    expect((await paymentOf(co.rafi.employeeId)).status).toBe('in_file');
  });

  it('downloads exactly what was generated (BEFTN CSV)', async () => {
    const res = await download(
      co.accounts.api,
      `/disbursement-files/${fileId}/download`,
    );
    const text = (res.body as Buffer).toString('utf8');
    const rafi = await paymentOf(co.rafi.employeeId);
    expect(text.split('\r\n')[1]).toBe(
      `1,Mahmudul Hasan Rafi,1051100012345,090261725,Dutch-Bangla Bank PLC,"Gulshan, Dhaka",30000.00,${rafi.reference},Salary 2026-09`,
    );
    const files = (
      await co.accounts.api
        .get(`/payroll-runs/${runId}/disbursement-files`)
        .expect(200)
    ).body;
    expect(files[0].checksumSha256).toBe(
      createHash('sha256').update(text).digest('hex'),
    );
  });

  it('regenerating needs the active file cancelled with a reason and an Admin approval', async () => {
    const cancel = (
      await co.accounts.api
        .post(`/disbursement-files/${fileId}/cancel`, {
          reason: 'Wrong value date, bank asked for a new file',
        })
        .expect(200)
    ).body;
    // still active until approved
    await co.accounts.api
      .post(`/payroll-runs/${runId}/disbursement-files`, { channel: 'bank' })
      .expect(409);
    await co.md.api
      .post(`/approvals/requests/${cancel.approvalRequestId}/approve`, {})
      .expect(200);

    expect((await paymentOf(co.rafi.employeeId)).status).toBe('approved');
    const regenerated = (
      await co.accounts.api
        .post(`/payroll-runs/${runId}/disbursement-files`, { channel: 'bank' })
        .expect(201)
    ).body;
    expect(regenerated.id).not.toBe(fileId);
    fileId = regenerated.id;
  });

  it('a return file with an unknown reference changes nothing', async () => {
    const res = await co.accounts.api
      .post(`/disbursement-files/${fileId}/returns`, {
        content:
          'REFERENCE,STATUS,REASON\nPAY-2026-09-DEADBEEF,RETURNED,Account closed\n',
      })
      .expect(400);
    expect(res.body.details.problems[0]).toMatch(/not a payment of this file/);
    expect((await paymentOf(co.rafi.employeeId)).status).toBe('in_file');
  });

  it('settle, then the bank returns Rafi’s transfer; re-issue creates a new linked payment', async () => {
    await co.accounts.api
      .post(`/disbursement-files/${fileId}/settle`)
      .expect(200);
    const paid = await paymentOf(co.rafi.employeeId);
    expect(paid.status).toBe('paid');

    const content = `REFERENCE,STATUS,REASON\n${paid.reference},RETURNED,Account dormant\n`;
    const imported = (
      await co.accounts.api
        .post(`/disbursement-files/${fileId}/returns`, { content })
        .expect(200)
    ).body;
    expect(imported).toMatchObject({ returned: 1 });
    // the same return file again does nothing more
    expect(
      (
        await co.accounts.api
          .post(`/disbursement-files/${fileId}/returns`, { content })
          .expect(200)
      ).body.returned,
    ).toBe(0);

    const reissued = (
      await co.accounts.api
        .post(`/payments/${paid.id}/reissue`, {
          reason: 'Account re-activated by the bank on 5 Oct',
        })
        .expect(201)
    ).body;
    expect(reissued).toMatchObject({
      reissueOf: paid.id,
      amount: '30000.00',
      status: 'approved',
      channel: 'bank',
    });
    expect(reissued.reference).not.toBe(paid.reference);
    expect((await payments()).find((p) => p.id === paid.id)!.status).toBe(
      'reissued',
    );
    // a returned payment can be re-issued only once
    await co.accounts.api
      .post(`/payments/${paid.id}/reissue`, { reason: 'Again' })
      .expect(409);
  });

  it('when every payment is paid the run is disbursed (payroll.disbursed)', async () => {
    for (const channel of ['bank', 'bkash', 'cash']) {
      const file = (
        await co.accounts.api
          .post(`/payroll-runs/${runId}/disbursement-files`, { channel })
          .expect(201)
      ).body;
      expect(
        (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body.state,
      ).toBe('approved');
      await co.accounts.api
        .post(`/disbursement-files/${file.id}/settle`)
        .expect(200);
    }
    expect(
      (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200)).body.state,
    ).toBe('disbursed');
    const { rows } = await tenantSql(
      sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM outbox_events WHERE type = 'payroll.disbursed' AND entity_id = ${runId}`,
    );
    expect(rows[0].n).toBe(1);
    // disbursed runs still reproduce identically
    expect(
      (
        await co.accounts.api
          .get(`/payroll-runs/${runId}/reproduce`)
          .expect(200)
      ).body.identical,
    ).toBe(true);
  });
});

describe('payslip PDF and salary journal', () => {
  it('the employee downloads a Bangla payslip; a protected one needs a password', async () => {
    const bn = await download(co.rafi.api, `/me/payslips/${runId}/pdf?lang=bn`);
    expect(bn.headers['content-type']).toBe('application/pdf');
    expect((bn.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const locked = await download(
      co.rafi.api,
      `/me/payslips/${runId}/pdf?lang=en&protect=true`,
    );
    expect(locked.headers['x-payslip-password']).toBe('employee code');
    expect((locked.body as Buffer).toString('latin1')).toContain('/Encrypt');
  });

  it('HR and the approving Admin can print anyone’s payslip; a department head cannot', async () => {
    await download(
      co.hr.api,
      `/payroll-runs/${runId}/employees/${co.rafi.employeeId}/payslip.pdf?lang=bn`,
    );
    await download(
      co.md.api,
      `/payroll-runs/${runId}/employees/${co.rafi.employeeId}/payslip.pdf`,
    );
    await download(
      co.salesHead.api,
      `/payroll-runs/${runId}/employees/${co.rafi.employeeId}/payslip.pdf`,
      403,
    );
  });

  it('the salary journal balances and agrees with the payroll', async () => {
    const res = await download(
      co.accounts.api,
      `/payroll-runs/${runId}/journal.csv`,
    );
    const rows = (res.body as Buffer)
      .toString('utf8')
      .trim()
      .split('\r\n')
      .map((r) => r.split(','));
    const total = rows.at(-1)!;
    expect(total[4]).toBe('TOTAL');
    expect(total[6]).toBe(total[7]); // debit = credit
    const run = (
      await co.accounts.api.get(`/payroll-runs/${runId}`).expect(200)
    ).body;
    const payable = rows
      .filter((r) => r[5] === 'Salaries payable')
      .reduce((s, r) => s + Number(r[7]), 0);
    expect(payable.toFixed(2)).toBe(run.totals.net);
  });
});
