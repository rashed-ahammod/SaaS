/**
 * Phase 2 WP14, general ledger (Meghna Foods, fiscal year 2026-27).
 * Acceptance: debits always equal credits (database); a closed period accepts
 * only reversals; the same source can never post twice; trial balance, P&L and
 * balance sheet agree; the payroll posting equals the approved payroll.
 *
 * Sujit is the Accounts maker; Sumaiya becomes a second Accounts user (checker).
 */
import type { INestApplication } from '@nestjs/common';
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
const acct: Record<string, string> = {}; // account code -> id
let payrollRunId: string;

const tenantSql = (q: ReturnType<typeof sql>) =>
  db.withTenant({ tenantId: co.tenant.id, access: AccessGrants.system() }, () =>
    q.execute(db.tx),
  );
const voucher = (
  type: string,
  date: string,
  narration: string,
  lines: Array<[string, string | null, string?]>,
) => ({
  voucherType: type,
  voucherDate: date,
  narration,
  lines: lines.map(([code, debit, credit]) => ({
    accountId: acct[code],
    ...(debit ? { debit } : {}),
    ...(credit ? { credit } : {}),
  })),
});
/** Maker creates and submits, checker approves: the voucher is posted. */
async function postVoucher(body: object, approvers: Api[] = [checker]) {
  const draft = (await co.accounts.api.post(`${c}/vouchers`, body).expect(201))
    .body;
  const submitted = (
    await co.accounts.api.post(`/vouchers/${draft.id}/submit`).expect(200)
  ).body;
  for (const a of approvers)
    await a
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
  return (await co.accounts.api.get(`/vouchers/${draft.id}`).expect(200)).body;
}

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;

  // a second Accounts user to check the maker's vouchers
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

  // payroll setup: rule pack, heads, salaries, September locked with everyone present
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
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('setup', () => {
  it('only Accounts sets up the books; others may not even read them', async () => {
    await co.hr.api.post(`${c}/ledger/setup`, {}).expect(403);
    await co.rafi.api.get(`${c}/ledger`).expect(403);
  });

  it('Bangladesh chart, posting accounts and the fiscal year 2026-27 with twelve open months', async () => {
    const status = (
      await co.accounts.api
        .post(`${c}/ledger/setup`, { asOf: '2026-10-15' })
        .expect(200)
    ).body;
    expect(status).toMatchObject({ setUp: true, missingPostingAccounts: [] });
    expect(status.accounts).toBeGreaterThan(50);
    expect(status.fiscalYears[0]).toMatchObject({
      code: '2026-27',
      startsOn: '2026-07-01',
      endsOn: '2027-06-30',
    });
    const periods = (await co.accounts.api.get(`${c}/periods`).expect(200))
      .body;
    expect(periods.map((p: { period: string }) => p.period)).toEqual(
      expect.arrayContaining(['2026-07', '2027-06']),
    );
    expect(periods.every((p: { state: string }) => p.state === 'open')).toBe(
      true,
    );
    // setting up again changes nothing
    expect(
      (await co.accounts.api.post(`${c}/ledger/setup`, {}).expect(200)).body
        .accounts,
    ).toBe(status.accounts);

    for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200))
      .body)
      acct[a.code] = a.id;
    // Admin and auditors read; HR does not
    await co.md.api.get(`${c}/accounts`).expect(200);
    await co.hr.api.get(`${c}/accounts`).expect(403);
  });
});

describe('vouchers: maker-checker', () => {
  let rentId: string;

  it('refuses unbalanced, one-sided-twice, group-account and cash-less payment vouchers', async () => {
    const bad = async (body: object, code: string) =>
      expect(
        (await co.accounts.api.post(`${c}/vouchers`, body).expect(400)).body
          .code,
      ).toBe(code);
    await bad(
      voucher('payment', '2026-10-05', 'Office rent', [
        ['5210', '85000'],
        ['1130', null, '80000'],
      ]),
      'VOUCHER_UNBALANCED',
    );
    await bad(
      voucher('payment', '2026-10-05', 'Office rent', [
        ['5200', '85000'],
        ['1130', null, '85000'],
      ]),
      'ACCOUNT_NOT_POSTABLE',
    );
    await bad(
      voucher('payment', '2026-10-05', 'Office rent', [
        ['5210', '85000'],
        ['2190', null, '85000'],
      ]),
      'VOUCHER_NEEDS_CASH_OR_BANK',
    );
    await bad(
      voucher('contra', '2026-10-05', 'Cash to bank', [
        ['1130', '5000'],
        ['5210', null, '5000'],
      ]),
      'VOUCHER_NEEDS_CASH_OR_BANK',
    );
    await bad(
      voucher('journal', '2027-08-01', 'Next year', [
        ['5210', '1'],
        ['2190', null, '1'],
      ]),
      'PERIOD_NOT_FOUND',
    );
  });

  it('a draft is numbered at once; the maker cannot approve it; another Accounts user posts it', async () => {
    const draft = (
      await co.accounts.api
        .post(`${c}/vouchers`, {
          ...voucher(
            'payment',
            '2026-10-05',
            'Office rent October 2026, Gulshan-2 (landlord: Rahman Properties)',
            [
              ['5210', '85000'],
              ['1130', null, '85000'],
            ],
          ),
        })
        .expect(201)
    ).body;
    rentId = draft.id;
    expect(draft).toMatchObject({
      number: 'PV/2026-27/00001',
      state: 'draft',
      total: '85000.00',
    });
    // cost centre on the expense line
    await co.accounts.api
      .patch(`/vouchers/${rentId}`, {
        version: draft.version,
        lines: [
          {
            accountId: acct['5210'],
            departmentId: co.departments.ho,
            debit: '85000',
          },
          { accountId: acct['1130'], credit: '85000' },
        ],
      })
      .expect(200);

    const submitted = (
      await co.accounts.api.post(`/vouchers/${rentId}/submit`).expect(200)
    ).body;
    expect(submitted.state).toBe('in_approval');
    // lines are frozen once submitted
    await co.accounts.api
      .patch(`/vouchers/${rentId}`, {
        version: submitted.version,
        narration: 'changed',
      })
      .expect(409);
    // maker-checker: the maker is not an approver
    await co.accounts.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(403);
    await checker
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vouchers/${rentId}`).expect(200)).body,
    ).toMatchObject({ state: 'posted', total: '85000.00' });
  });

  it('posted is permanent, also for the database itself', async () => {
    await expect(
      tenantSql(
        sql`UPDATE vouchers SET narration = 'edited' WHERE id = ${rentId}`,
      ),
    ).rejects.toThrow(/posted/);
    await expect(
      tenantSql(sql`DELETE FROM voucher_lines WHERE voucher_id = ${rentId}`),
    ).rejects.toThrow(/cannot change/);
    await expect(
      tenantSql(sql`DELETE FROM vouchers WHERE id = ${rentId}`),
    ).rejects.toThrow(/permission denied|never deleted/);
  });

  it('the database refuses to post an unbalanced voucher even when the service is bypassed', async () => {
    const draft = (
      await co.accounts.api
        .post(
          `${c}/vouchers`,
          voucher('journal', '2026-10-06', 'Accrual', [
            ['5220', '1200'],
            ['2190', null, '1200'],
          ]),
        )
        .expect(201)
    ).body;
    await tenantSql(
      sql`DELETE FROM voucher_lines WHERE voucher_id = ${draft.id} AND line_no = 2`,
    );
    await expect(
      tenantSql(
        sql`UPDATE vouchers SET state = 'posted' WHERE id = ${draft.id}`,
      ),
    ).rejects.toThrow(/does not balance/);
    await co.accounts.api
      .post(`/vouchers/${draft.id}/cancel`, { reason: 'Test' })
      .expect(200);
  });

  it('Tk 10 lakh or more also needs the Admin', async () => {
    const big = await postVoucher(
      voucher(
        'receipt',
        '2026-10-07',
        'Share capital from the directors (Meghna Holdings)',
        [
          ['1130', '5000000'],
          ['3100', null, '5000000'],
        ],
      ),
      [checker],
    );
    expect(big.state).toBe('in_approval');
    await co.md.api
      .post(`/approvals/requests/${big.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vouchers/${big.id}`).expect(200)).body.state,
    ).toBe('posted');
  });

  it('numbers are gapless per type and fiscal year; a cancelled number stays visible', async () => {
    const one = (
      await co.accounts.api
        .post(
          `${c}/vouchers`,
          voucher('journal', '2026-10-08', 'Telephone bill accrued', [
            ['5230', '3500'],
            ['2190', null, '3500'],
          ]),
        )
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/vouchers/${one.id}/cancel`, {
        reason: 'Duplicate of the bill entry',
      })
      .expect(200);
    const two = (
      await co.accounts.api
        .post(
          `${c}/vouchers`,
          voucher('journal', '2026-10-08', 'Telephone bill accrued', [
            ['5230', '3500'],
            ['2190', null, '3500'],
          ]),
        )
        .expect(201)
    ).body;
    expect(Number(two.number.slice(-5))).toBe(Number(one.number.slice(-5)) + 1);
    const cancelled = (
      await co.accounts.api.get(`${c}/vouchers?state=cancelled`).expect(200)
    ).body.map((v: { number: string }) => v.number);
    expect(cancelled).toContain(one.number);
    await co.accounts.api
      .post(`/vouchers/${two.id}/submit`)
      .expect(200)
      .then((r) =>
        checker
          .post(`/approvals/requests/${r.body.approvalRequestId}/approve`, {})
          .expect(200),
      );
  });

  it('opening balances: one journal on the first day of a month, once per company', async () => {
    const opening = (date: string, type = 'journal') => ({
      ...voucher(
        type,
        date,
        'Opening balances from the old books (Tally), 30 June 2026',
        [
          ['1110', '150000'],
          ['3200', null, '150000'],
        ],
      ),
      isOpening: true,
    });
    expect(
      (
        await co.accounts.api
          .post(`${c}/vouchers`, opening('2026-07-15'))
          .expect(400)
      ).body.code,
    ).toBe('OPENING_VOUCHER_RULES');
    expect(
      (
        await co.accounts.api
          .post(`${c}/vouchers`, opening('2026-07-01', 'receipt'))
          .expect(400)
      ).body.code,
    ).toBe('OPENING_VOUCHER_RULES');
    const posted = await postVoucher(opening('2026-07-01'));
    expect(posted).toMatchObject({ state: 'posted', isOpening: true });
    expect(
      (
        await co.accounts.api
          .post(`${c}/vouchers`, opening('2026-08-01'))
          .expect(409)
      ).body,
    ).toMatchObject({
      code: 'OPENING_BALANCES_EXIST',
      details: { number: posted.number },
    });
    await expect(
      tenantSql(sql`INSERT INTO vouchers (company_id, fiscal_year_id, voucher_type, number, voucher_date, narration, is_opening)
                    SELECT company_id, fiscal_year_id, 'journal', 'JV/DUP', '2026-08-01', 'dup', true FROM vouchers WHERE id = ${posted.id}`),
    ).rejects.toThrow(/one_opening_per_company/);
  });

  it('a posted voucher is corrected by an approved reversal, once', async () => {
    const reversal = (
      await co.accounts.api
        .post(`/vouchers/${rentId}/reverse`, {
          reason: 'Booked twice: the rent was paid by the group office',
        })
        .expect(201)
    ).body;
    expect(reversal).toMatchObject({
      state: 'in_approval',
      reversalOf: rentId,
      number: 'PV/2026-27/00002',
    });
    expect(reversal.lines[0]).toMatchObject({
      accountId: acct['5210'],
      credit: '85000.00',
      departmentId: co.departments.ho,
    });
    await co.accounts.api
      .post(`/vouchers/${rentId}/reverse`, { reason: 'again' })
      .expect(409);
    await checker
      .post(`/approvals/requests/${reversal.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vouchers/${rentId}`).expect(200)).body
        .reversedBy,
    ).toBe(reversal.id);
  });
});

describe('automatic postings from payroll', () => {
  it('approving the September payroll posts the payroll journal; it equals the run', async () => {
    payrollRunId = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
        .expect(201)
    ).body.id;
    await co.hr.api.post(`/payroll-runs/${payrollRunId}/calculate`).expect(200);
    const calculated = (
      await co.hr.api.get(`/payroll-runs/${payrollRunId}`).expect(200)
    ).body;
    for (const f of calculated.flags)
      await co.hr.api
        .post(`/payroll-flags/${f.id}/clear`, { reason: `Checked: ${f.code}` })
        .expect(200);
    const submitted = (
      await co.hr.api.post(`/payroll-runs/${payrollRunId}/submit`).expect(200)
    ).body;
    await checker
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);

    const posted = (
      await co.accounts.api
        .get(`${c}/vouchers?type=journal&state=posted`)
        .expect(200)
    ).body.find((v: { sourceId: string }) => v.sourceId === payrollRunId);
    expect(posted).toMatchObject({
      sourceType: 'payroll_run',
      voucherDate: '2026-09-30',
    });
    const detail = (
      await co.accounts.api.get(`/vouchers/${posted.id}`).expect(200)
    ).body;
    const sum = (code: string, side: 'debit' | 'credit') =>
      detail.lines
        .filter((l: { accountCode: string }) => l.accountCode === code)
        .reduce(
          (n: number, l: Record<string, string>) => n + Number(l[side]),
          0,
        );
    // salaries payable = total net; TDS payable = total tax; expense = gross
    expect(sum('2120', 'credit')).toBeCloseTo(Number(calculated.totals.net), 2);
    expect(sum('2130', 'credit')).toBeCloseTo(Number(calculated.totals.tax), 2);
    expect(sum('5110', 'debit')).toBeCloseTo(
      Number(calculated.totals.gross),
      2,
    );
    // every line carries its cost centre
    expect(
      detail.lines
        .filter((l: { accountCode: string }) => l.accountCode === '5110')
        .every((l: { departmentId: string | null }) => l.departmentId),
    ).toBe(true);
  });

  it('the same run can never post twice', async () => {
    expect(
      (
        await co.accounts.api
          .post(`/payroll-runs/${payrollRunId}/ledger-posting`)
          .expect(409)
      ).body.code,
    ).toBe('ALREADY_POSTED');
    await expect(
      tenantSql(sql`INSERT INTO vouchers (company_id, fiscal_year_id, voucher_type, number, voucher_date, narration, source_type, source_id)
                    SELECT company_id, fiscal_year_id, 'journal', 'JV/DUP', '2026-09-30', 'dup', 'payroll_run', ${payrollRunId} FROM vouchers WHERE source_id = ${payrollRunId}`),
    ).rejects.toThrow(/one_posting_per_source/);
  });

  it('settling the salary files posts the payment; salaries payable comes back to zero', async () => {
    const payments = (
      await co.accounts.api
        .get(`/payroll-runs/${payrollRunId}/payments`)
        .expect(200)
    ).body;
    for (const channel of [
      ...new Set(payments.payments.map((p: { channel: string }) => p.channel)),
    ] as string[]) {
      const file = (
        await co.accounts.api
          .post(`/payroll-runs/${payrollRunId}/disbursement-files`, { channel })
          .expect(201)
      ).body;
      await co.accounts.api
        .post(`/disbursement-files/${file.id}/settle`)
        .expect(200);
    }
    const ledger = (
      await co.accounts.api
        .get(`/accounts/${acct['2120']}/ledger?from=2026-07-01&to=2026-10-31`)
        .expect(200)
    ).body;
    expect(ledger.closing).toBe('0.00');
    expect(
      ledger.lines.some((l: { type: string }) => l.type === 'payment'),
    ).toBe(true);
  });

  it('a skipped posting (posting account missing) is listed by the checks and posted later', async () => {
    // October payroll with the salaries-payable posting account removed
    clock.set(new Date('2026-11-02T10:00:00+06:00')); // October has ended
    await co.hr.api
      .post('/attendance/locks', { companyId: co.companyId, period: '2026-10' })
      .expect(201);
    await tenantSql(
      sql`DELETE FROM posting_accounts WHERE key = 'payroll.salaries_payable' AND company_id = ${co.companyId}`,
    );
    const runId = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-10' })
        .expect(201)
    ).body.id;
    await co.hr.api.post(`/payroll-runs/${runId}/calculate`).expect(200);
    for (const f of (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200))
      .body.flags)
      await co.hr.api
        .post(`/payroll-flags/${f.id}/clear`, { reason: 'Checked' })
        .expect(200);
    const submitted = (
      await co.hr.api.post(`/payroll-runs/${runId}/submit`).expect(200)
    ).body;
    await checker
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    // payroll is not held up by the books
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);

    const checks = (await co.accounts.api.get(`${c}/ledger/checks`).expect(200))
      .body;
    expect(checks.ok).toBe(false);
    expect(checks.problems).toEqual([
      expect.objectContaining({ check: 'payroll_not_posted' }),
    ]);
    const refused = (
      await co.accounts.api
        .post(`/payroll-runs/${runId}/ledger-posting`)
        .expect(400)
    ).body;
    expect(refused).toMatchObject({
      code: 'POSTING_ACCOUNT_MISSING',
      details: { missingPostingAccounts: ['payroll.salaries_payable'] },
    });

    await co.accounts.api
      .put(`${c}/posting-accounts`, {
        key: 'payroll.salaries_payable',
        accountId: acct['2120'],
      })
      .expect(200);
    const posted = (
      await co.accounts.api
        .post(`/payroll-runs/${runId}/ledger-posting`)
        .expect(201)
    ).body;
    expect(posted).toMatchObject({
      state: 'posted',
      sourceType: 'payroll_run',
      voucherDate: '2026-10-31',
    });
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true, problems: [] });
  });
});

describe('reports', () => {
  it('trial balance balances; P&L and balance sheet agree with it', async () => {
    const tb = (
      await co.accounts.api.get(`${c}/trial-balance?to=2026-10-31`).expect(200)
    ).body;
    expect(tb.balanced).toBe(true);
    expect(tb.from).toBe('2026-07-01');
    const pl = (
      await co.accounts.api
        .get(`${c}/profit-and-loss?to=2026-10-31`)
        .expect(200)
    ).body;
    const bs = (
      await co.accounts.api
        .get(`${c}/balance-sheet?asOf=2026-10-31`)
        .expect(200)
    ).body;
    expect(bs.balanced).toBe(true);
    expect(
      bs.equity.lines.find(
        (l: { name: string }) => l.name === 'Profit for the year to date',
      ).amount,
    ).toBe(pl.netProfit);
    // rent was reversed: no rent expense; telephone accrual remains
    expect(
      pl.expenses.lines.find((l: { code: string }) => l.code === '5210'),
    ).toBeUndefined();
    expect(
      pl.expenses.lines.find((l: { code: string }) => l.code === '5230').amount,
    ).toBe('3500.00');
    // P&L of one cost centre
    const sales = (
      await co.accounts.api
        .get(
          `${c}/profit-and-loss?to=2026-10-31&departmentId=${co.departments.sales}`,
        )
        .expect(200)
    ).body;
    expect(Number(sales.expenses.total)).toBeGreaterThan(0);
    expect(Number(sales.expenses.total)).toBeLessThan(
      Number(pl.expenses.total),
    );
  });

  it('general ledger of the bank: opening, every line, running balance', async () => {
    const gl = (
      await co.accounts.api
        .get(`/accounts/${acct['1130']}/ledger?to=2026-10-31`)
        .expect(200)
    ).body;
    expect(gl.opening).toBe('0.00');
    expect(gl.lines[0]).toMatchObject({
      number: 'PV/2026-27/00001',
      credit: '85000.00',
      balance: '-85000.00',
    });
    expect(gl.lines.at(-1).balance).toBe(gl.closing);
  });
});

describe('period close', () => {
  it('months close in order; drafts and pending vouchers block a close', async () => {
    const blocked = (
      await co.accounts.api.post(`${c}/periods/2026-10/close`).expect(409)
    ).body;
    expect(blocked.details.closeFirst).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
    for (const p of ['2026-07', '2026-08', '2026-09'])
      await co.accounts.api.post(`${c}/periods/${p}/close`).expect(200);
    const draft = (
      await co.accounts.api
        .post(
          `${c}/vouchers`,
          voucher('journal', '2026-10-20', 'Electricity accrual', [
            ['5220', '9000'],
            ['2190', null, '9000'],
          ]),
        )
        .expect(201)
    ).body;
    expect(
      (await co.accounts.api.post(`${c}/periods/2026-10/close`).expect(409))
        .body.details.unfinishedVouchers,
    ).toEqual([`${draft.number} (draft)`]);
    await co.accounts.api
      .post(`/vouchers/${draft.id}/cancel`, { reason: 'Will book in November' })
      .expect(200);
    await co.accounts.api.post(`${c}/periods/2026-10/close`).expect(200);
  });

  it('a closed period accepts only reversals', async () => {
    const res = await co.accounts.api
      .post(
        `${c}/vouchers`,
        voucher('journal', '2026-09-15', 'Late entry', [
          ['5240', '500'],
          ['2190', null, '500'],
        ]),
      )
      .expect(409);
    expect(res.body.code).toBe('PERIOD_CLOSED');
    // the database agrees, and a closed period cannot be reopened
    await expect(
      tenantSql(
        sql`UPDATE accounting_periods SET state = 'open', closed_by = NULL, closed_at = NULL WHERE period = '2026-09' AND company_id = ${co.companyId}`,
      ),
    ).rejects.toThrow(/closed/);

    // a reversal may be dated inside the closed month
    const tel = (
      await co.accounts.api
        .get(`${c}/vouchers?type=journal&state=posted`)
        .expect(200)
    ).body.find(
      (v: { narration: string }) => v.narration === 'Telephone bill accrued',
    );
    const reversal = (
      await co.accounts.api
        .post(`/vouchers/${tel.id}/reverse`, {
          reason: 'Bill was for the head office of the group',
          voucherDate: '2026-10-08',
        })
        .expect(201)
    ).body;
    await checker
      .post(`/approvals/requests/${reversal.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.accounts.api.get(`/vouchers/${reversal.id}`).expect(200)).body
        .state,
    ).toBe('posted');
  });
});
