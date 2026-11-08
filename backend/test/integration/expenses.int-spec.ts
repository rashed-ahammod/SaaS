/**
 * Phase 2 WP16, expense claims and employee advances (Meghna Foods).
 * Acceptance: a claim is paid once; the advances sub-ledger equals its control account.
 *
 * Rafi (Sales Dhaka) claims; Tanvir (Sales head) approves first, Sujit (Accounts)
 * verifies and pays; Sumaiya, a second Accounts user, checks the payment vouchers.
 */
import type { INestApplication } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-15T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api; // Sumaiya, second Accounts user
const acct: Record<string, string> = {};
const cat: Record<string, string> = {};
let advanceId: string;

const tenantSql = (q: ReturnType<typeof sql>) =>
  db.withTenant({ tenantId: co.tenant.id, access: AccessGrants.system() }, () =>
    q.execute(db.tx),
  );
const approve = (requestId: string, who: Api) =>
  who.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);
/** A receipt photo (PNG header + random bytes: every call is a different file). */
const photo = () => ({
  content: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    randomBytes(64),
  ]),
  name: 'receipt.png',
});
const voucher = async (id: string) =>
  (await co.accounts.api.get(`/vouchers/${id}`).expect(200)).body;
const balanceOf = async (employeeId: string) =>
  (
    await co.accounts.api.get(`${c}/employee-advances/balances`).expect(200)
  ).body.employees.find(
    (e: { employeeId: string }) => e.employeeId === employeeId,
  );
/** Tanvir, then Sujit: the claim / advance chain below Tk 50,000. */
async function deptHeadThenAccounts(requestId: string) {
  await approve(requestId, co.salesHead.api);
  await approve(requestId, co.accounts.api);
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
  await co.owner
    .post(`/users/${co.financeOfficer.userId}/roles`, {
      role: 'accounts',
      scopeType: 'company',
      scopeId: co.companyId,
    })
    .expect(201);
  checker = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.financeOfficer.email,
    password: PASSWORD,
  });
  await co.accounts.api
    .post(`${c}/ledger/setup`, { asOf: '2026-10-15' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('categories', () => {
  it('Accounts creates the Bangladesh defaults; employees read them; HR may not change them', async () => {
    await co.hr.api.post(`${c}/expense-categories/defaults`).expect(403);
    const cats = (
      await co.accounts.api.post(`${c}/expense-categories/defaults`).expect(201)
    ).body;
    for (const x of cats) cat[x.code] = x.id;
    expect(
      cats.find((x: { code: string }) => x.code === 'TRAVEL_LOCAL'),
    ).toMatchObject({ accountCode: '5250', receiptRequiredAbove: '500.00' });
    expect(
      (await co.rafi.api.get(`${c}/expense-categories`).expect(200)).body,
    ).toHaveLength(cats.length);
  });
});

describe('cash advance and a claim against it', () => {
  it('Rafi asks for a cash advance; Tanvir, then Accounts approve; Accounts pays it out (checker)', async () => {
    const asked = (
      await co.rafi.api
        .post('/me/expense-advances', {
          purpose: 'Dealer visit, Chattogram (12-14 Oct): bus, hotel, meals',
          amount: '20000',
          neededBy: '2026-10-11',
        })
        .expect(201)
    ).body;
    expect(asked).toMatchObject({
      number: 'EA/2026-27/00001',
      state: 'in_approval',
    });
    advanceId = asked.id;
    await deptHeadThenAccounts(asked.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/expense-advances/${advanceId}`).expect(200))
        .body.state,
    ).toBe('approved');

    // bank needs Rafi's approved salary account; cash is fine
    expect(
      (
        await co.accounts.api
          .post(`/expense-advances/${advanceId}/payout`, {
            method: 'bank_transfer',
            paidFromAccountId: acct['1130'],
            paymentDate: '2026-10-11',
          })
          .expect(400)
      ).body.code,
    ).toBe('EMPLOYEE_ACCOUNT_REQUIRED');
    const out = (
      await co.accounts.api
        .post(`/expense-advances/${advanceId}/payout`, {
          method: 'cash',
          paidFromAccountId: acct['1110'],
          paymentDate: '2026-10-11',
        })
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/approvals/requests/${out.payout.approvalRequestId}/approve`, {})
      .expect(403); // maker
    await approve(out.payout.approvalRequestId, checker);
    expect(
      (await co.accounts.api.get(`/expense-advances/${advanceId}`).expect(200))
        .body,
    ).toMatchObject({ state: 'paid', open: '20000.00' });
    expect(await balanceOf(co.rafi.employeeId)).toMatchObject({
      cashAdvances: '20000.00',
      books: '20000.00',
      difference: '0.00',
    });
  });

  it('a claim needs its receipts; the same receipt cannot be claimed twice', async () => {
    const draft = (
      await co.rafi.api
        .post('/me/expense-claims', {
          title: 'Dealer visit, Chattogram (12-14 Oct)',
          advanceId,
        })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({ number: 'EC/2026-27/00001', state: 'draft' });
    const bus = photo();
    const r1 = (
      await co.rafi.api
        .upload(`/expense-claims/${draft.id}/receipts`, {}, bus)
        .expect(201)
    ).body.id;
    const r2 = (
      await co.rafi.api
        .upload(`/expense-claims/${draft.id}/receipts`, {}, photo())
        .expect(201)
    ).body.id;
    await co.rafi.api
      .upload(
        `/expense-claims/${draft.id}/receipts`,
        {},
        { content: Buffer.from('not an image'), name: 'x.txt' },
      )
      .expect(400);
    const lines = [
      {
        expenseDate: '2026-10-12',
        categoryId: cat.TRAVEL,
        description: 'Green Line bus Dhaka-Chattogram and back',
        amount: '2800',
        receiptId: r1,
      },
      {
        expenseDate: '2026-10-12',
        categoryId: cat.HOTEL,
        description: 'Hotel Agrabad, 2 nights',
        amount: '7000',
      },
      {
        expenseDate: '2026-10-13',
        categoryId: cat.TRAVEL_LOCAL,
        description: 'CNG to dealers in Halishahar and GEC',
        amount: '350',
      },
      {
        expenseDate: '2026-10-13',
        categoryId: cat.MEALS,
        description: 'Lunch with 3 dealers',
        amount: '2500',
        receiptId: r2,
      },
    ];
    let current = (
      await co.rafi.api
        .patch(`/expense-claims/${draft.id}`, { version: draft.version, lines })
        .expect(200)
    ).body;
    expect(current.total).toBe('12650.00');
    // the hotel line needs a receipt (the CNG fare under Tk 500 does not)
    expect(
      (await co.rafi.api.post(`/expense-claims/${draft.id}/submit`).expect(400))
        .body,
    ).toMatchObject({ code: 'RECEIPT_REQUIRED', details: { lines: [2] } });
    const r3 = (
      await co.rafi.api
        .upload(`/expense-claims/${draft.id}/receipts`, {}, photo())
        .expect(201)
    ).body.id;
    current = (
      await co.rafi.api
        .patch(`/expense-claims/${draft.id}`, {
          version: current.version,
          lines: lines.map((l, i) => (i === 1 ? { ...l, receiptId: r3 } : l)),
        })
        .expect(200)
    ).body;

    // another claim with the bus ticket again
    const other = (
      await co.rafi.api
        .post('/me/expense-claims', { title: 'Same ticket again' })
        .expect(201)
    ).body;
    expect(
      (
        await co.rafi.api
          .upload(`/expense-claims/${other.id}/receipts`, {}, bus)
          .expect(409)
      ).body,
    ).toMatchObject({
      code: 'RECEIPT_DUPLICATE',
      details: { claimNo: 'EC/2026-27/00001' },
    });
    await co.rafi.api.post(`/expense-claims/${other.id}/cancel`).expect(200);
    // nobody else edits or reads it
    await co.salesHead.api
      .patch(`/expense-claims/${draft.id}`, {
        version: current.version,
        title: 'x',
      })
      .expect(404);
    await co.hr.api.get(`/expense-claims/${draft.id}`).expect(403);
  });

  it('approved: booked against the advance; nothing left to pay', async () => {
    const claim = (
      await co.rafi.api.get('/me/expense-claims').expect(200)
    ).body.find((x: { number: string }) => x.number === 'EC/2026-27/00001');
    const submitted = (
      await co.rafi.api.post(`/expense-claims/${claim.id}/submit`).expect(200)
    ).body;
    await co.rafi.api
      .patch(`/expense-claims/${claim.id}`, {
        version: submitted.version,
        title: 'changed',
      })
      .expect(409);
    await deptHeadThenAccounts(submitted.approvalRequestId);

    const done = (
      await co.accounts.api.get(`/expense-claims/${claim.id}`).expect(200)
    ).body;
    expect(done).toMatchObject({
      state: 'settled',
      total: '12650.00',
      advanceApplied: '12650.00',
      payable: '0.00',
    });
    const v = await voucher(done.postingVoucherId);
    const sum = (code: string, side: 'debit' | 'credit') =>
      v.lines
        .filter((l: { accountCode: string }) => l.accountCode === code)
        .reduce(
          (n: number, l: Record<string, string>) => n + Number(l[side]),
          0,
        );
    expect(sum('5250', 'debit')).toBe(10150); // bus + hotel + CNG
    expect(sum('5260', 'debit')).toBe(2500);
    expect(
      v.lines.find((l: { accountCode: string }) => l.accountCode === '1160'),
    ).toMatchObject({
      credit: '12650.00',
      partyType: 'employee',
      partyId: co.rafi.employeeId,
    });
    expect(
      v.lines.find((l: { accountCode: string }) => l.accountCode === '5250')
        .departmentId,
    ).toBe(co.departments.salesDhaka);
    expect(
      (await co.accounts.api.get(`/expense-advances/${advanceId}`).expect(200))
        .body,
    ).toMatchObject({ state: 'paid', open: '7350.00' });
  });

  it('the rest comes back: part as a cash refund (checker), the remainder from salary', async () => {
    const over = (
      await co.accounts.api
        .post(`/expense-advances/${advanceId}/refund`, {
          amount: '8000',
          receivedIntoAccountId: acct['1110'],
          date: '2026-10-15',
        })
        .expect(400)
    ).body;
    expect(over).toMatchObject({
      code: 'ADVANCE_EXCEEDED',
      details: { available: '7350.00' },
    });
    const refund = (
      await co.accounts.api
        .post(`/expense-advances/${advanceId}/refund`, {
          amount: '5000',
          receivedIntoAccountId: acct['1110'],
          date: '2026-10-15',
          reference: 'Cash returned to Sujit',
        })
        .expect(201)
    ).body;
    await approve(
      refund.settlements.find((s: { kind: string }) => s.kind === 'refund')
        .approvalRequestId,
      checker,
    );
    expect(
      (await co.accounts.api.get(`/expense-advances/${advanceId}`).expect(200))
        .body.open,
    ).toBe('2350.00');

    const recovered = (
      await co.accounts.api
        .post(`/expense-advances/${advanceId}/recover-from-salary`, {
          installment: '1175',
          firstPeriod: '2026-11',
        })
        .expect(201)
    ).body;
    expect(recovered).toMatchObject({ state: 'settled' });
    const loans = (
      await co.hr.api.get(`/employees/${co.rafi.employeeId}/loans`).expect(200)
    ).body;
    expect(loans[0]).toMatchObject({
      origin: 'advance',
      state: 'approved',
      principal: '2350.00',
      installment: '1175.00',
    });
    // the money moved from a cash advance to a salary advance: the books still agree
    expect(await balanceOf(co.rafi.employeeId)).toMatchObject({
      cashAdvances: '0.00',
      salaryAdvances: '2350.00',
      books: '2350.00',
      difference: '0.00',
    });
  });
});

describe('a claim paid in cash', () => {
  let claimId: string;

  it('payable to the employee; bank needs the salary account; paid once', async () => {
    const draft = (
      await co.rafi.api
        .post('/me/expense-claims', {
          title: 'Mobile bill October (dealer calls)',
        })
        .expect(201)
    ).body;
    const r = (
      await co.rafi.api
        .upload(`/expense-claims/${draft.id}/receipts`, {}, photo())
        .expect(201)
    ).body.id;
    await co.rafi.api
      .patch(`/expense-claims/${draft.id}`, {
        version: draft.version,
        lines: [
          {
            expenseDate: '2026-10-10',
            categoryId: cat.MOBILE,
            description: 'Grameenphone postpaid, dealer calls',
            amount: '1200',
            receiptId: r,
          },
        ],
      })
      .expect(200);
    const submitted = (
      await co.rafi.api.post(`/expense-claims/${draft.id}/submit`).expect(200)
    ).body;
    await deptHeadThenAccounts(submitted.approvalRequestId);
    claimId = draft.id;
    const approved = (
      await co.accounts.api.get(`/expense-claims/${claimId}`).expect(200)
    ).body;
    expect(approved).toMatchObject({ state: 'approved', payable: '1200.00' });
    expect(
      (await voucher(approved.postingVoucherId)).lines.find(
        (l: { accountCode: string }) => l.accountCode === '2190',
      ),
    ).toMatchObject({ credit: '1200.00', partyType: 'employee' });

    await co.rafi.api
      .post(`/expense-claims/${claimId}/payment`, {
        method: 'cash',
        paidFromAccountId: acct['1110'],
        paymentDate: '2026-10-15',
      })
      .expect(403);
    expect(
      (
        await co.accounts.api
          .post(`/expense-claims/${claimId}/payment`, {
            method: 'mobile_wallet',
            paidFromAccountId: acct['1140'],
            paymentDate: '2026-10-15',
          })
          .expect(400)
      ).body.code,
    ).toBe('EMPLOYEE_ACCOUNT_REQUIRED');
    const paying = (
      await co.accounts.api
        .post(`/expense-claims/${claimId}/payment`, {
          method: 'cash',
          paidFromAccountId: acct['1110'],
          paymentDate: '2026-10-15',
        })
        .expect(201)
    ).body;
    // a second payment while the first waits
    await co.accounts.api
      .post(`/expense-claims/${claimId}/payment`, {
        method: 'cash',
        paidFromAccountId: acct['1110'],
        paymentDate: '2026-10-15',
      })
      .expect(409);
    await approve(paying.payment.approvalRequestId, checker);
    const paid = (
      await co.accounts.api.get(`/expense-claims/${claimId}`).expect(200)
    ).body;
    expect(paid).toMatchObject({ state: 'paid', payment: { state: 'posted' } });

    // paid once: not again, not reversed, and the database agrees
    await co.accounts.api
      .post(`/expense-claims/${claimId}/payment`, {
        method: 'cash',
        paidFromAccountId: acct['1110'],
        paymentDate: '2026-10-15',
      })
      .expect(409);
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${paid.payment.voucherId}/reverse`, {
            reason: 'test',
          })
          .expect(409)
      ).body.code,
    ).toBe('EXPENSE_CLAIM_WRONG_STATE');
    await expect(
      tenantSql(
        sql`UPDATE expense_claims SET state = 'approved', payment_voucher_id = NULL WHERE id = ${claimId}`,
      ),
    ).rejects.toThrow(/cannot change/);
    await expect(
      tenantSql(sql`INSERT INTO vouchers (company_id, fiscal_year_id, voucher_type, number, voucher_date, narration, source_type, source_id)
                    SELECT company_id, fiscal_year_id, 'payment', 'PV/DUP', '2026-10-15', 'dup', 'expense_claim_payment', ${claimId} FROM vouchers WHERE id = ${paid.payment.voucherId}`),
    ).rejects.toThrow(/one_posting_per_source/);
  });

  it('Tk 50,000 or more also needs the Admin', async () => {
    const draft = (
      await co.rafi.api
        .post('/me/expense-claims', { title: 'Dealer conference, Cox’s Bazar' })
        .expect(201)
    ).body;
    const r = (
      await co.rafi.api
        .upload(`/expense-claims/${draft.id}/receipts`, {}, photo())
        .expect(201)
    ).body.id;
    await co.rafi.api
      .patch(`/expense-claims/${draft.id}`, {
        version: draft.version,
        lines: [
          {
            expenseDate: '2026-10-14',
            categoryId: cat.HOTEL,
            description: 'Hotel Sea Crown, 12 dealers, 1 night',
            amount: '54000',
            receiptId: r,
          },
        ],
      })
      .expect(200);
    const submitted = (
      await co.rafi.api.post(`/expense-claims/${draft.id}/submit`).expect(200)
    ).body;
    await deptHeadThenAccounts(submitted.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/expense-claims/${draft.id}`).expect(200))
        .body.state,
    ).toBe('in_approval');
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/reject`, {
        comment: 'Not budgeted this quarter',
      })
      .expect(200);
    expect(
      (await co.accounts.api.get(`/expense-claims/${draft.id}`).expect(200))
        .body.state,
    ).toBe('rejected');
  });
});

describe('salary advances through the books', () => {
  it('an approved salary advance is paid out (checker) and then counts in the sub-ledger', async () => {
    const loan = (
      await co.hr.api
        .post(`/employees/${co.rafi.employeeId}/loans`, {
          principal: '10000',
          installment: '2500',
          firstPeriod: '2026-11',
          reason: "Mother's treatment at Chattogram Medical College Hospital",
        })
        .expect(201)
    ).body;
    await deptHeadThenAccounts(loan.approvalRequestId);
    // approved but not paid: not in the books yet
    expect(await balanceOf(co.rafi.employeeId)).toMatchObject({
      salaryAdvances: '2350.00',
    });

    await co.hr.api
      .post(`/loans/${loan.id}/payout`, {
        method: 'cash',
        paidFromAccountId: acct['1110'],
        paymentDate: '2026-10-15',
      })
      .expect(403);
    const out = (
      await co.accounts.api
        .post(`/loans/${loan.id}/payout`, {
          method: 'cash',
          paidFromAccountId: acct['1110'],
          paymentDate: '2026-10-15',
        })
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/loans/${loan.id}/payout`, {
        method: 'cash',
        paidFromAccountId: acct['1110'],
        paymentDate: '2026-10-15',
      })
      .expect(409);
    await approve(out.approvalRequestId, checker);
    expect(await balanceOf(co.rafi.employeeId)).toMatchObject({
      salaryAdvances: '12350.00',
      books: '12350.00',
      difference: '0.00',
    });
  });
});

describe('the sub-ledger equals the staff advances account', () => {
  it('nightly checks pass; the account takes no manual entries; a difference is reported', async () => {
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true, problems: [] });
    const manual = await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: 'payment',
        voucherDate: '2026-10-15',
        narration: 'Advance to Rafi',
        lines: [
          { accountId: acct['1160'], debit: '1000' },
          { accountId: acct['1110'], credit: '1000' },
        ],
      })
      .expect(400);
    expect(manual.body.code).toBe('CONTROL_ACCOUNT_MANUAL');

    await tenantSql(
      sql`UPDATE loans SET principal = principal + 100 WHERE origin = 'advance' AND employee_id = ${co.rafi.employeeId}`,
    );
    const checks = (await co.accounts.api.get(`${c}/ledger/checks`).expect(200))
      .body;
    expect(checks.problems.map((p: { check: string }) => p.check)).toEqual([
      'advances_control',
      'advances_employee_mismatch',
    ]);
    await tenantSql(
      sql`UPDATE loans SET principal = principal - 100 WHERE origin = 'advance' AND employee_id = ${co.rafi.employeeId}`,
    );
  });

  it('migrated advances come into the books with one opening posting', async () => {
    // an advance still open in the old system (WP8 import)
    await tenantSql(sql`INSERT INTO loans (company_id, employee_id, principal, installment, first_period, reason, state, approved_at, origin)
                        VALUES (${co.companyId}, ${co.hr.employeeId}, 6000, 1500, '2026-11', 'From the old payroll register', 'approved', now(), 'import')`);
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body.ok,
    ).toBe(false);
    const opening = (
      await co.accounts.api
        .post(`${c}/employee-advances/opening-posting`, { date: '2026-07-01' })
        .expect(201)
    ).body;
    expect(opening).toMatchObject({
      voucherType: 'journal',
      state: 'posted',
      total: '6000.00',
    });
    expect(
      (
        await co.accounts.api
          .post(`${c}/employee-advances/opening-posting`, {
            date: '2026-07-01',
          })
          .expect(409)
      ).body.code,
    ).toBe('ALREADY_POSTED');
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true, problems: [] });
  });

  it('Accounts lists claims and advances; employees only their own', async () => {
    expect(
      (
        await co.accounts.api.get(`${c}/expense-claims?state=paid`).expect(200)
      ).body.map((x: { employeeName: string }) => x.employeeName),
    ).toEqual(['Mahmudul Hasan Rafi']);
    await co.rafi.api.get(`${c}/expense-claims`).expect(403);
    expect(
      (await co.md.api.get(`${c}/expense-advances`).expect(200)).body,
    ).toHaveLength(1);
    expect(
      (await co.rafi.api.get('/me/expense-advances').expect(200)).body[0],
    ).toMatchObject({ state: 'settled' });
  });
});
