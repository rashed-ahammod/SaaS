/**
 * WP20 bank reconciliation through the API (Meghna Foods test company, its Dutch-Bangla
 * current account on ledger account 1130).
 * Acceptance (docs/phase-2-plan.md): "Reconciled balance equals the ledger; no line
 * matched twice".
 *
 * Reconciliation starts on 1 October 2026; the bank's balance on 30 September was
 * Tk 5,00,000. The books also had cheque 4521873 (Partex, Tk 73,400, 28 September) not
 * yet presented. October: an NPSB receipt, two dealer receipts banked as one deposit,
 * two Tk 5,000 receipts on one day (only one of them is in the bank by month end), a
 * cheque and a receipt at month end that the bank does not have yet, the bank's SMS
 * charge (recorded from the statement) and its interest (not yet in the books).
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import { loadCases, runCases } from '../../src/modules/ai/eval/evaluation.js';
import { BankAiService } from '../../src/modules/bank/bank-ai.service.js';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { AccessService } from '../../src/modules/identity/access/access.service.js';
import { requestContext } from '../../src/platform/tenancy/request-context.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-11-02T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api;
let bankId: string;
const acct: Record<string, string> = {};
const ledgerLine: Record<string, string> = {};
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
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
/** Maker creates and submits, checker approves: the voucher is posted. Returns the id of its bank line. */
async function post(key: string, body: ReturnType<typeof voucher>) {
  const draft = (await co.accounts.api.post(`${c}/vouchers`, body).expect(201))
    .body;
  const submitted = (
    await co.accounts.api.post(`/vouchers/${draft.id}/submit`).expect(200)
  ).body;
  await checker
    .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
    .expect(200);
  const posted = (
    await co.accounts.api.get(`/vouchers/${draft.id}`).expect(200)
  ).body;
  ledgerLine[key] = posted.lines.find(
    (l: { accountId: string }) => l.accountId === acct['1130'],
  ).id;
}

const HEADER =
  'Dutch-Bangla Bank PLC,Tejgaon Branch\nStatement of account,Meghna Foods Ltd,1101100012345\n\nTxn Date,Value Date,Particulars,Cheque No,Debit,Credit,Balance\n';
const OCTOBER =
  HEADER +
  [
    '02/10/2026,02/10/2026,NPSB CREDIT MEGHNA DEALERS CTG,,,"1,50,000.00","6,50,000.00"',
    '03/10/2026,03/10/2026,CHQ PAID PARTEX FURNITURE,4521873,"73,400.00",,"5,76,600.00"',
    '06/10/2026,06/10/2026,CASH DEPOSIT GULSHAN BR,,,"50,000.00","6,26,600.00"',
    '15/10/2026,15/10/2026,SMS ALERT CHARGE Q3,,115.00,,"6,26,485.00"',
    '20/10/2026,20/10/2026,NPSB CREDIT KARIM STORES,,,"5,000.00","6,31,485.00"',
    '31/10/2026,31/10/2026,INTEREST CREDIT OCT-26,,,842.50,"6,32,327.50"',
  ].join('\n') +
  '\n';

const lines = async (state: string) =>
  (
    await co.accounts.api
      .get(`/bank-accounts/${bankId}/statement-lines?state=${state}`)
      .expect(200)
  ).body as Array<{ id: string; description: string; matchId: string | null }>;
const lineOf = async (text: string) =>
  (await lines('all')).find((l) => l.description.includes(text))!;

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
    .post(`${c}/ledger/setup`, { asOf: '2026-07-01' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;

  // September, before reconciliation starts
  await post(
    'capital',
    voucher('receipt', '2026-09-10', 'Share capital paid in by the directors', [
      ['1130', '500000'],
      ['3100', null, '500000'],
    ]),
  );
  await post(
    'partex',
    voucher(
      'payment',
      '2026-09-28',
      'Partex Furniture, office chairs, cheque 4521873',
      [
        ['5270', '73400'],
        ['1130', null, '73400'],
      ],
    ),
  );
  // October
  await post(
    'npsb',
    voucher(
      'receipt',
      '2026-10-02',
      'Meghna Dealers Chattogram, September invoices',
      [
        ['1130', '150000'],
        ['4100', null, '150000'],
      ],
    ),
  );
  await post(
    'dealerA',
    voucher('receipt', '2026-10-05', 'Sylhet Agro dealer, cash sale', [
      ['1130', '30000'],
      ['4100', null, '30000'],
    ]),
  );
  await post(
    'dealerB',
    voucher('receipt', '2026-10-05', 'Bogura Traders dealer, cash sale', [
      ['1130', '20000'],
      ['4100', null, '20000'],
    ]),
  );
  await post(
    'rahim',
    voucher('receipt', '2026-10-20', 'Rahim Traders, Mirpur', [
      ['1130', '5000'],
      ['4100', null, '5000'],
    ]),
  );
  await post(
    'karim',
    voucher('receipt', '2026-10-20', 'Karim Stores, Uttara', [
      ['1130', '5000'],
      ['4100', null, '5000'],
    ]),
  );
  await post(
    'rent',
    voucher('payment', '2026-10-29', 'November office rent, cheque 4522001', [
      ['5210', '45000'],
      ['1130', null, '45000'],
    ]),
  );
  await post(
    'late',
    voucher(
      'receipt',
      '2026-10-30',
      'Comilla dealer, cash deposited 31 October evening',
      [
        ['1130', '12000'],
        ['4100', null, '12000'],
      ],
    ),
  );
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('the bank account', () => {
  it('Accounts sets it up on a bank ledger account; others only look', async () => {
    const body = {
      accountId: acct['1130'],
      bankName: 'Dutch-Bangla Bank PLC',
      branch: 'Tejgaon',
      accountName: 'Meghna Foods Ltd',
      accountNo: '1101100012345',
      statementFormat: 'dbbl',
      reconcileFrom: '2026-10-01',
      openingBankBalance: '500000',
    };
    await co.md.api.post(`${c}/bank-accounts`, body).expect(403);
    expect(
      (
        await co.accounts.api
          .post(`${c}/bank-accounts`, { ...body, accountId: acct['5210'] })
          .expect(400)
      ).body.code,
    ).toBe('BANK_LEDGER_ACCOUNT_INVALID');
    const b = (
      await co.accounts.api.post(`${c}/bank-accounts`, body).expect(201)
    ).body;
    bankId = b.id;
    expect(b).toMatchObject({
      accountCode: '1130',
      ledgerBalance: '603600.00',
      openingBankBalance: '500000.00',
      statements: 0,
    });
    expect(
      (await co.md.api.get(`${c}/bank-accounts`).expect(200)).body,
    ).toHaveLength(1);
    await co.hr.api.get(`${c}/bank-accounts`).expect(403);
  });
});

describe('statement import', () => {
  it('a Dutch-Bangla file: read below the account details; the rules match what is certain', async () => {
    const r = (
      await co.accounts.api
        .upload(
          `/bank-accounts/${bankId}/statements`,
          {},
          { content: Buffer.from(OCTOBER), name: 'DBBL-oct-2026.csv' },
        )
        .expect(201)
    ).body;
    expect(r).toMatchObject({
      imported: 6,
      skipped: 0,
      autoMatched: 2,
      statement: {
        periodFrom: '2026-10-02',
        periodTo: '2026-10-31',
        openingBalance: '500000.00',
        closingBalance: '632327.50',
      },
    });
    // the cheque by its number (a line from before the start), the NPSB credit as the only Tk 1,50,000
    expect((await lineOf('PARTEX')).matchId).not.toBeNull();
    expect((await lineOf('MEGHNA DEALERS')).matchId).not.toBeNull();
    // the two Tk 5,000 receipts on one day: no guessing
    expect((await lineOf('KARIM STORES')).matchId).toBeNull();
  });

  it('the same file twice is refused; an overlapping file adds only the new lines', async () => {
    expect(
      (
        await co.accounts.api
          .upload(
            `/bank-accounts/${bankId}/statements`,
            {},
            { content: Buffer.from(OCTOBER), name: 'again.csv' },
          )
          .expect(409)
      ).body.code,
    ).toBe('BANK_STATEMENT_DUPLICATE');
    const november =
      HEADER +
      [
        '31/10/2026,31/10/2026,INTEREST CREDIT OCT-26,,,842.50,"6,32,327.50"',
        '02/11/2026,02/11/2026,CHQ PAID NOVEMBER RENT,4522001,"45,000.00",,"5,87,327.50"',
      ].join('\n');
    const r = (
      await co.accounts.api
        .upload(
          `/bank-accounts/${bankId}/statements`,
          {},
          { content: Buffer.from(november), name: 'DBBL-1-2-nov.csv' },
        )
        .expect(201)
    ).body;
    expect(r).toMatchObject({ imported: 1, skipped: 1, autoMatched: 1 }); // the rent cheque, by its number
  });

  it('a file whose balances do not add up is refused as a whole', async () => {
    const bad =
      HEADER +
      '03/11/2026,03/11/2026,CASH DEPOSIT,,,"1,000.00","5,88,327.50"\n04/11/2026,04/11/2026,ATM WITHDRAWAL,,500.00,,"5,88,000.00"\n';
    const r = (
      await co.accounts.api
        .upload(
          `/bank-accounts/${bankId}/statements`,
          {},
          { content: Buffer.from(bad), name: 'bad.csv' },
        )
        .expect(400)
    ).body;
    expect(r.code).toBe('BANK_STATEMENT_INVALID');
    expect(r.details.problems).toEqual([
      'Row 6: balance 588000.00 does not follow from 588327.50 and -500.00',
    ]);
  });
});

describe('matching by hand', () => {
  it('one deposit for two dealer receipts: offered as a pair, matched only when it balances', async () => {
    const deposit = await lineOf('CASH DEPOSIT GULSHAN');
    const o = (
      await co.accounts.api
        .get(`/bank-statement-lines/${deposit.id}/options`)
        .expect(200)
    ).body;
    expect(o.options[0].ledgerLineIds.sort()).toEqual(
      [ledgerLine.dealerA, ledgerLine.dealerB].sort(),
    );

    const one = {
      statementLineIds: [deposit.id],
      ledgerLineIds: [ledgerLine.dealerA],
    };
    expect(
      (
        await co.accounts.api
          .post(`/bank-accounts/${bankId}/matches`, one)
          .expect(400)
      ).body.code,
    ).toBe('BANK_MATCH_UNBALANCED');
    await co.md.api.post(`/bank-accounts/${bankId}/matches`, one).expect(403);
    const m = (
      await co.accounts.api
        .post(`/bank-accounts/${bankId}/matches`, {
          ...one,
          ledgerLineIds: [ledgerLine.dealerA, ledgerLine.dealerB],
          note: 'Two dealers banked together',
        })
        .expect(201)
    ).body;
    expect(m).toMatchObject({ kind: 'manual', total: '50000.00' });
  });

  it('no line matched twice: refused by the API, and by the database', async () => {
    const deposit = await lineOf('CASH DEPOSIT GULSHAN');
    const charge = await lineOf('SMS ALERT');
    expect(
      (
        await co.accounts.api
          .post(`/bank-accounts/${bankId}/matches`, {
            statementLineIds: [deposit.id],
            ledgerLineIds: [ledgerLine.rahim, ledgerLine.karim],
          })
          .expect(409)
      ).body.code,
    ).toBe('BANK_LINE_ALREADY_MATCHED');

    // straight into the database: a second active match of the deposit
    const twice = asTenant(async () => {
      const m = await db.tx
        .insertInto('bank_matches')
        .values({ bank_account_id: bankId, kind: 'manual' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.tx
        .insertInto('bank_match_items')
        .values([
          {
            match_id: m.id,
            bank_account_id: bankId,
            statement_line_id: deposit.id,
            amount: '50000.00',
          },
          {
            match_id: m.id,
            bank_account_id: bankId,
            voucher_line_id: ledgerLine.late,
            amount: '12000.00',
          },
        ])
        .execute();
    });
    await expect(twice).rejects.toThrow(/statement_line_matched_once/);
    // a match that does not balance fails at commit
    const unbalanced = asTenant(async () => {
      const m = await db.tx
        .insertInto('bank_matches')
        .values({ bank_account_id: bankId, kind: 'manual' })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.tx
        .insertInto('bank_match_items')
        .values([
          {
            match_id: m.id,
            bank_account_id: bankId,
            statement_line_id: charge.id,
            amount: '-115.00',
          },
          {
            match_id: m.id,
            bank_account_id: bankId,
            voucher_line_id: ledgerLine.late,
            amount: '-115.00',
          },
        ])
        .execute();
    });
    await expect(unbalanced).rejects.toThrow(/wrong amounts|does not balance/);
    // items cannot be switched off directly; only by undoing the match
    await expect(
      asTenant(() =>
        db.tx
          .updateTable('bank_match_items')
          .set({ active: false })
          .where('bank_account_id', '=', bankId)
          .execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('undo with a reason; the rules match it again', async () => {
    const npsb = await lineOf('MEGHNA DEALERS');
    await co.accounts.api
      .post(`/bank-matches/${npsb.matchId}/undo`, {})
      .expect(400);
    const undone = (
      await co.accounts.api
        .post(`/bank-matches/${npsb.matchId}/undo`, {
          reason: 'Checking the dealer invoice numbers',
        })
        .expect(200)
    ).body;
    expect(undone.undoReason).toBe('Checking the dealer invoice numbers');
    expect(
      (
        await co.accounts.api
          .post(`/bank-matches/${npsb.matchId}/undo`, { reason: 'again' })
          .expect(409)
      ).body.code,
    ).toBe('BANK_MATCH_UNDONE');
    expect((await lineOf('MEGHNA DEALERS')).matchId).toBeNull();
    expect(
      (
        await co.accounts.api
          .post(`/bank-accounts/${bankId}/auto-match`)
          .expect(200)
      ).body,
    ).toEqual({ matched: 1 });
  });
});

describe('AI suggestion', () => {
  it('chooses Karim Stores among two Tk 5,000 receipts; the accountant accepts it', async () => {
    const karim = await lineOf('KARIM STORES');
    expect(
      (
        await co.accounts.api
          .post(`/bank-statement-lines/${karim.id}/ai-suggestion`)
          .expect(403)
      ).body.code,
    ).toBe('AI_NOT_IN_PLAN');
    await asTenant(() =>
      db.tx.updateTable('tenants').set({ plan_tier: 'intelligent' }).execute(),
    );
    await co.md.api.put('/ai/settings', { enabled: true }).expect(200);

    const s = (
      await co.accounts.api
        .post(`/bank-statement-lines/${karim.id}/ai-suggestion`)
        .expect(200)
    ).body;
    expect(s.suggestion.ledgerLineIds).toEqual([ledgerLine.karim]);
    expect(s.reason).toContain('KARIM');
    const m = (
      await co.accounts.api
        .post(`/bank-accounts/${bankId}/matches`, {
          statementLineIds: [karim.id],
          ledgerLineIds: s.suggestion.ledgerLineIds,
          fromSuggestion: true,
        })
        .expect(201)
    ).body;
    expect(m.kind).toBe('suggestion');

    // the release-gate test set (npm run ai:eval) passes
    const access = await db.withTenant({ tenantId: co.tenant.id }, () =>
      app.get(AccessService, { strict: false }).load(co.accounts.userId),
    );
    const ai = app.get(BankAiService, { strict: false });
    const report = await runCases(
      loadCases('test/ai-eval/bank-match.yaml'),
      0.9,
      async (k) => {
        const r = await requestContext.run(
          {
            tenantId: co.tenant.id,
            userId: co.accounts.userId,
            access,
            language: k.language,
          },
          () => ai.chooseFrom(k.bankFacts!, `eval:${k.id}`, true),
        );
        return {
          answer: `choice: ${r.choice ?? 'none'} ${r.reason}`,
          toolsUsed: [],
        };
      },
      () => 'n/a',
    );
    expect(report.cases).toBeGreaterThanOrEqual(10);
    expect(report.outcomes.filter((o) => !o.passed)).toEqual([]);

    // switched off for bank matching only
    await co.md.api
      .put('/ai/settings', { bankMatchSuggestionsEnabled: false })
      .expect(200);
    await co.accounts.api
      .post(
        `/bank-statement-lines/${(await lineOf('SMS ALERT')).id}/ai-suggestion`,
      )
      .expect(403);
  });
});

describe('a bank charge the books do not have', () => {
  it('a draft voucher from the statement line; once posted, the rules match it', async () => {
    const charge = await lineOf('SMS ALERT');
    const v = (
      await co.accounts.api
        .post(`/bank-statement-lines/${charge.id}/voucher`, {
          accountId: acct['5290'],
          narration: 'DBBL SMS alert charge',
        })
        .expect(201)
    ).body;
    expect(v).toMatchObject({
      voucherType: 'payment',
      voucherDate: '2026-10-15',
      state: 'draft',
      total: '115.00',
    });
    const submitted = (
      await co.accounts.api.post(`/vouchers/${v.id}/submit`).expect(200)
    ).body;
    await checker
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (
        await co.accounts.api
          .post(`/bank-accounts/${bankId}/auto-match`)
          .expect(200)
      ).body,
    ).toEqual({ matched: 1 });
    expect(
      (
        await co.accounts.api
          .post(`/bank-statement-lines/${charge.id}/voucher`, {
            accountId: acct['5290'],
            narration: 'again',
          })
          .expect(409)
      ).body.code,
    ).toBe('BANK_LINE_NOT_UNRECORDED');
  });
});

describe('the reconciliation', () => {
  it('31 October: the adjusted bank balance equals the ledger', async () => {
    const r = (
      await co.md.api
        .get(`/bank-accounts/${bankId}/reconciliation?asOf=2026-10-31`)
        .expect(200)
    ).body;
    expect(r).toMatchObject({
      ledgerBalance: '603485.00',
      bankBalance: '632327.50',
      statementShowsBalance: '632327.50',
      statementAgrees: true,
      depositsInTransit: { total: '17000.00' }, // Rahim Traders, the Comilla dealer
      unpresentedPayments: { total: '-45000.00' }, // the rent cheque, presented 2 November
      bankCreditsNotInBooks: { total: '842.50' }, // October interest
      bankDebitsNotInBooks: { total: '0.00' },
      adjustedBankBalance: '603485.00',
      difference: '0.00',
      reconciled: true,
    });
    expect(
      r.unpresentedPayments.lines.map(
        (l: { narration: string }) => l.narration,
      ),
    ).toEqual(['November office rent, cheque 4522001']);
  });

  it('30 September: the Partex cheque was still out', async () => {
    const r = (
      await co.accounts.api
        .get(`/bank-accounts/${bankId}/reconciliation?asOf=2026-09-30`)
        .expect(200)
    ).body;
    expect(r).toMatchObject({
      ledgerBalance: '426600.00',
      bankBalance: '500000.00',
      unpresentedPayments: { total: '-73400.00' },
      adjustedBankBalance: '426600.00',
      reconciled: true,
    });
  });

  it('2 November: the rent cheque is presented; only the interest and the deposits remain', async () => {
    const r = (
      await co.accounts.api
        .get(`/bank-accounts/${bankId}/reconciliation?asOf=2026-11-02`)
        .expect(200)
    ).body;
    expect(r).toMatchObject({
      bankBalance: '587327.50',
      unpresentedPayments: { total: '0.00' },
      difference: '0.00',
    });
  });
});

describe('n8n statement import', () => {
  it('with a service key that carries bank.import, and nothing else', async () => {
    const key = (
      await co.owner
        .post('/service-keys', {
          name: 'n8n bank statements',
          permissions: ['bank.import'],
          companyId: co.companyId,
        })
        .expect(201)
    ).body.authorizationHeader;
    const other = (
      await co.owner
        .post('/service-keys', {
          name: 'Biometric agent',
          permissions: ['attendance.ingest'],
          companyId: co.companyId,
        })
        .expect(201)
    ).body.authorizationHeader;
    const body = {
      fileName: 'DBBL-1101100012345-2026-11-05.csv',
      content:
        HEADER +
        '05/11/2026,05/11/2026,BEFTN CREDIT RAHIM TRADERS,,,"5,000.00","5,92,327.50"\n',
    };
    const send = (auth: string) =>
      request(app.getHttpServer())
        .post(`/bank-accounts/${bankId}/statements/n8n`)
        .set('Authorization', auth)
        .set('Idempotency-Key', crypto.randomUUID())
        .send(body);
    await send(other).expect(403);
    await send('Bearer not-a-service-key').expect(401);
    const r = (await send(key).expect(201)).body;
    expect(r).toMatchObject({ imported: 1, statement: { source: 'n8n' } });
    // the key reads nothing else
    await request(app.getHttpServer())
      .get(`/bank-accounts/${bankId}/reconciliation`)
      .set('Authorization', key)
      .expect(401);
  });
});

describe('on its own', () => {
  it('statement lines stay as imported (append-only)', async () => {
    await expect(
      asTenant(() =>
        sql`UPDATE bank_statement_lines SET amount = 1 WHERE bank_account_id = ${bankId}`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asTenant(() =>
        sql`DELETE FROM bank_statement_lines WHERE bank_account_id = ${bankId}`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
