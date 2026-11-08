/**
 * WP22 finance close and Gate 2 through the API (Meghna Foods test company): a rehearsal of
 * the pilot's Gate 2, "a pilot closes one month fully in the system, and the trial balance
 * reconciles with its old system".
 *
 * The old system (Tally) gives its trial balance at 30 September 2026; it becomes the
 * opening voucher on 1 October with the unpaid bills and invoices behind it. October:
 * office rent, a cash sale, Bogura Traders pays its invoice. The month is closed through
 * the checklist; the old system's trial balance at 31 October is compared with ours: first
 * with an old account not yet mapped and a rent booked differently, then agreed.
 * Also: cash flow, department cost, aged receivables, and the AI bill and receipt reader.
 */
import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { DocumentReaderService } from '../../src/modules/ai/documents/document-reader.service.js';
import { loadCases, runCases } from '../../src/modules/ai/eval/evaluation.js';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { AccessService } from '../../src/modules/identity/access/access.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { detectFileType } from '../../src/platform/storage/file-storage.js';
import { requestContext } from '../../src/platform/tenancy/request-context.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-11-05T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api;
let karim: { id: string; code: string };
const acct: Record<string, string> = {};
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const approve = (requestId: string) =>
  checker.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);
/** The checker, then the Admin (above the voucher limit, e.g. the opening balances). */
const approveAll = async (requestId: string) => {
  await approve(requestId);
  const r = (
    await co.md.api.get(`/approvals/requests/${requestId}`).expect(200)
  ).body;
  if (r.state === 'in_approval')
    await co.md.api
      .post(`/approvals/requests/${requestId}/approve`, {})
      .expect(200);
};
async function postVoucher(
  type: string,
  date: string,
  narration: string,
  lines: Array<[string, string | null, string?, string?]>,
) {
  const draft = (
    await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: type,
        voucherDate: date,
        narration,
        lines: lines.map(([code, debit, credit, departmentId]) => ({
          accountId: acct[code],
          ...(debit ? { debit } : {}),
          ...(credit ? { credit } : {}),
          ...(departmentId ? { departmentId } : {}),
        })),
      })
      .expect(201)
  ).body;
  const submitted = (
    await co.accounts.api.post(`/vouchers/${draft.id}/submit`).expect(200)
  ).body;
  await approve(submitted.approvalRequestId);
}
const file = (text: string, name: string) => ({
  content: Buffer.from(text),
  name,
});

const OPENING = () =>
  [
    'Tally ERP: Meghna Foods Ltd, trial balance as at 30-09-2026',
    '',
    'account_code,old_code,old_name,debit,credit,party,reference,date,due_date,department_code',
    '1130,BNK-DBBL,Dutch-Bangla Bank A/C 1101100012345,"8,50,000.00",,,,,,',
    '1110,CASH-HO,Cash in hand (head office),"25,000.00",,,,,,',
    '1150,SDR-001,Sundry debtors,"1,20,000.00",,Sylhet Agro Ltd,SA-0912,12/09/2026,12/10/2026,',
    '1150,SDR-001,Sundry debtors,"45,000.00",,Bogura Traders,BT-0920,20/09/2026,20/11/2026,',
    '1210,FA-FURN,Furniture and fixtures,"3,00,000.00",,,,,,',
    '1290,ACC-DEP,Accumulated depreciation,,"60,000.00",,,,,',
    `2110,SCR-001,Sundry creditors,,"85,000.00",${karim.code},KT-5498,20/09/2026,20/10/2026,`,
    '3100,CAP,Share capital,,"10,00,000.00",,,,,',
    '3200,PL-BF,Profit and loss brought forward,,"1,95,000.00",,,,,',
  ].join('\n');

const OLD_OCTOBER = (rent: string, bank: string) =>
  [
    'old_code,old_name,debit,credit',
    `BNK-DBBL,Dutch-Bangla Bank,${bank},`,
    'CASH-HO,Cash in hand,25000,',
    'SDR-001,Sundry debtors,120000,',
    'FA-FURN,Furniture,300000,',
    'ACC-DEP,Accumulated depreciation,,60000',
    'SCR-001,Sundry creditors,,85000',
    'CAP,Share capital,,1000000',
    'PL-BF,Profit and loss b/f,,195000',
    `EXP-RENT,Office rent,${rent},`,
    'INC-SALES,Sales - local,,200000',
  ].join('\n');

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
  const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
  const pack = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.3',
  );
  await co.owner
    .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
    .expect(201);
  await co.accounts.api
    .post(`${c}/ledger/setup`, { asOf: '2026-10-01' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
  karim = (
    await co.accounts.api
      .post(`${c}/vendors`, {
        name: 'Karim Traders, Nawabpur Road',
        tin: '345678901234',
        bin: '000345678-0103',
        withholdingCategory: 'SUPPLY',
      })
      .expect(201)
  ).body;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('opening balances from the old system', () => {
  it('a file that cannot be used is refused with every problem listed', async () => {
    const bad = OPENING()
      .replace('1210,FA-FURN', '1999,FA-FURN')
      .replace(karim.code, 'V-9999');
    await co.hr.api
      .upload(
        `${c}/opening-balances`,
        { cutOverDate: '2026-10-01' },
        file(OPENING(), 'tb.csv'),
      )
      .expect(403);
    const r = (
      await co.accounts.api
        .upload(
          `${c}/opening-balances`,
          { cutOverDate: '2026-10-01' },
          file(bad, 'tb.csv'),
        )
        .expect(400)
    ).body;
    expect(r.code).toBe('OPENING_FILE_INVALID');
    expect(r.details.problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('account 1999 is not in the chart'),
        expect.stringContaining('"V-9999" not found'),
      ]),
    );
  });

  it('the opening voucher goes to the checker; once posted the open items stand behind the control accounts', async () => {
    const imp = (
      await co.accounts.api
        .upload(
          `${c}/opening-balances`,
          { cutOverDate: '2026-10-01' },
          file(OPENING(), 'tally-tb-2026-09-30.csv'),
        )
        .expect(201)
    ).body;
    expect(imp).toMatchObject({
      state: 'in_approval',
      totalDebit: '1340000.00',
      rows: 9,
    });
    expect(
      (
        await co.accounts.api
          .upload(
            `${c}/opening-balances`,
            { cutOverDate: '2026-10-01' },
            file(OPENING(), 'again.csv'),
          )
          .expect(409)
      ).body.code,
    ).toBe('OPENING_BALANCES_EXIST');
    await approveAll(imp.approvalRequestId);

    const status = (
      await co.accounts.api.get(`${c}/opening-balances`).expect(200)
    ).body;
    expect(status).toMatchObject({
      imports: [{ state: 'posted' }],
      mappedOldAccounts: 8,
    });
    // the vendor's unpaid bill and the customers' invoices
    const aging = (
      await co.accounts.api
        .get(`${c}/payables/aging?asOf=2026-10-01`)
        .expect(200)
    ).body;
    expect(JSON.stringify(aging)).toContain('85000.00');
    const items = (
      await co.accounts.api.get(`${c}/receivables?open=true`).expect(200)
    ).body;
    expect(
      items.map(
        (i: { customerName: string; outstanding: string }) =>
          `${i.customerName} ${i.outstanding}`,
      ),
    ).toEqual(['Bogura Traders 45000.00', 'Sylhet Agro Ltd 120000.00']);
    // control accounts equal their sub-ledgers; the opening is final
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body.ok,
    ).toBe(true);
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${imp.voucherId}/reverse`, { reason: 'x' })
          .expect(409)
      ).body.code,
    ).toBe('OPENING_IMPORT_FINAL');
    // receivables take no manual voucher
    const manual = await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: 'journal',
        voucherDate: '2026-10-02',
        narration: 'x',
        lines: [
          { accountId: acct['1150'], debit: '1' },
          { accountId: acct['4100'], credit: '1' },
        ],
      })
      .expect(400);
    expect(manual.body.code).toBe('CONTROL_ACCOUNT_MANUAL');
  });
});

describe('October in the books', () => {
  it('rent, a cash sale, and Bogura Traders pays its invoice', async () => {
    await postVoucher(
      'payment',
      '2026-10-05',
      'Office rent, October 2026, Gulshan-2',
      [
        ['5210', '85000', undefined, co.departments.ho],
        ['1130', null, '85000'],
      ],
    );
    await postVoucher('receipt', '2026-10-15', 'Cash sale, rice bran oil', [
      ['1130', '200000'],
      ['4100', null, '200000'],
    ]);
    const bogura = (
      await co.accounts.api.get(`${c}/receivables?open=true`).expect(200)
    ).body.find(
      (i: { customerName: string }) => i.customerName === 'Bogura Traders',
    );
    expect(
      (
        await co.accounts.api
          .post(`/receivable-items/${bogura.id}/receipts`, {
            receiptDate: '2026-10-20',
            amount: '50000',
            receivedIntoAccountId: acct['1130'],
          })
          .expect(400)
      ).body.code,
    ).toBe('RECEIPT_TOO_MUCH');
    const receipt = (
      await co.accounts.api
        .post(`/receivable-items/${bogura.id}/receipts`, {
          receiptDate: '2026-10-20',
          amount: '45000',
          receivedIntoAccountId: acct['1130'],
          reference: 'NPSB 1020-88412',
        })
        .expect(201)
    ).body;
    await approve(receipt.approvalRequestId);
    const aging = (
      await co.accounts.api
        .get(`${c}/receivables/aging?asOf=2026-10-31`)
        .expect(200)
    ).body;
    expect(aging.customers).toEqual([
      expect.objectContaining({
        customer: 'Sylhet Agro Ltd',
        d1_30: '120000.00',
        total: '120000.00',
      }),
    ]);
  });

  it('cash flow: the opening is opening cash; the month explains the change exactly', async () => {
    const cf = (
      await co.accounts.api
        .get(`${c}/reports/cash-flow?from=2026-10-01&to=2026-10-31`)
        .expect(200)
    ).body;
    expect(cf).toMatchObject({
      openingCash: '875000.00',
      netChange: '160000.00',
      closingCash: '1035000.00',
      difference: '0.00',
    });
    const operating = cf.sections.find(
      (s: { activity: string }) => s.activity === 'operating',
    );
    expect(
      operating.rows.map(
        (r: { code: string; net: string }) => `${r.code} ${r.net}`,
      ),
    ).toEqual(['1150 45000.00', '4100 200000.00', '5210 -85000.00']);
  });

  it('department cost: the rent sits with the head office', async () => {
    const d = (
      await co.md.api
        .get(`${c}/reports/department-cost?from=2026-10-01&to=2026-10-31`)
        .expect(200)
    ).body;
    const ho = d.rows.find(
      (r: { departmentId: string }) => r.departmentId === co.departments.ho,
    );
    expect(ho.total).toBe('85000.00');
    expect(d.total).toBe('85000.00');
  });
});

describe('closing October', () => {
  it('the checklist holds the close until a person has done their part', async () => {
    const list = (
      await co.accounts.api.get(`${c}/month-close/2026-10`).expect(200)
    ).body;
    const item = (key: string) =>
      list.items.find((i: { key: string }) => i.key === key);
    expect(item('vouchers_finished').ok).toBe(true);
    expect(item('books_checks').ok).toBe(true);
    expect(item('vat_ready').ok).toBe(true);
    expect(item('bank_reconciled')).toMatchObject({
      ok: true,
      notApplicable: true,
    });
    expect(item('stock_count')).toMatchObject({
      ok: true,
      notApplicable: true,
    });
    expect(item('accruals').ok).toBe(false);
    const refused = (
      await co.accounts.api.post(`${c}/month-close/2026-10/close`).expect(409)
    ).body;
    expect(refused.code).toBe('MONTH_CLOSE_NOT_READY');
    expect(refused.details.problems).toEqual([
      'accruals',
      'prepayments',
      'petty_cash',
      'asset_additions',
    ]);

    await co.hr.api
      .post(`${c}/month-close/2026-10/items/accruals`, { note: 'x' })
      .expect(403);
    expect(
      (
        await co.accounts.api
          .post(`${c}/month-close/2026-10/items/coffee`, { note: 'x' })
          .expect(400)
      ).body.code,
    ).toBe('MONTH_CLOSE_ITEM_UNKNOWN');
    const notes: Record<string, string> = {
      accruals: 'No accruals: DESCO and audit fee billed in October',
      prepayments: 'None this month',
      petty_cash: 'Counted Tk 25,000 on 31 Oct with Farzana; agrees',
      asset_additions: 'No asset bought in October',
    };
    for (const [key, note] of Object.entries(notes))
      await co.accounts.api
        .post(`${c}/month-close/2026-10/items/${key}`, { note })
        .expect(200);
    const closed = (
      await co.accounts.api.post(`${c}/month-close/2026-10/close`).expect(200)
    ).body;
    expect(closed).toMatchObject({ state: 'closed', ready: true });
    // a closed month takes no more vouchers
    await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: 'journal',
        voucherDate: '2026-10-31',
        narration: 'late',
        lines: [
          { accountId: acct['5210'], debit: '1' },
          { accountId: acct['1110'], credit: '1' },
        ],
      })
      .expect(409);
  });
});

describe('Gate 2: the old system agrees', () => {
  it('not yet: an old account without a mapping, and a rent booked differently', async () => {
    const before = (await co.accounts.api.get(`${c}/gate-2`).expect(200)).body;
    expect(
      before.criteria.find(
        (x: { key: string }) => x.key === 'old_system_matches',
      ),
    ).toMatchObject({
      ok: false,
      detail: "Compare the old system's trial balance at 2026-10-31",
    });

    const first = (
      await co.accounts.api
        .upload(
          `${c}/old-system-comparisons`,
          { asOf: '2026-10-31' },
          file(OLD_OCTOBER('85500', '1009500'), 'tally-tb-2026-10-31.csv'),
        )
        .expect(201)
    ).body;
    expect(first).toMatchObject({ matched: false, unmapped: 2 });
    expect(
      first.unmappedAccounts.map((u: { oldCode: string }) => u.oldCode).sort(),
    ).toEqual(['EXP-RENT', 'INC-SALES']);

    await co.accounts.api
      .put(`${c}/account-map`, {
        oldCode: 'EXP-RENT',
        oldName: 'Office rent',
        accountId: acct['5210'],
      })
      .expect(200);
    await co.accounts.api
      .put(`${c}/account-map`, {
        oldCode: 'INC-SALES',
        oldName: 'Sales - local',
        accountId: acct['4100'],
      })
      .expect(200);
    const second = (
      await co.accounts.api
        .upload(
          `${c}/old-system-comparisons`,
          { asOf: '2026-10-31' },
          file(OLD_OCTOBER('85500', '1009500'), 'tally-tb-2026-10-31.csv'),
        )
        .expect(201)
    ).body;
    expect(second).toMatchObject({
      matched: false,
      unmapped: 0,
      differences: 2,
    });
    expect(
      second.lines
        .filter((l: { difference: string }) => l.difference !== '0.00')
        .map(
          (l: { accountCode: string; difference: string }) =>
            `${l.accountCode} ${l.difference}`,
        ),
    ).toEqual(['1130 500.00', '5210 -500.00']);
  });

  it('the old system corrected (its rent was entered as 85,500): the trial balances agree and the gate passes', async () => {
    const third = (
      await co.accounts.api
        .upload(
          `${c}/old-system-comparisons`,
          {
            asOf: '2026-10-31',
            note: 'Tally rent voucher corrected by the old accountant',
          },
          file(OLD_OCTOBER('85000', '1010000'), 'tally-tb-2026-10-31-v2.csv'),
        )
        .expect(201)
    ).body;
    expect(third).toMatchObject({ matched: true, differences: 0, unmapped: 0 });
    const gate = (await co.md.api.get(`${c}/gate-2`).expect(200)).body;
    expect(gate).toMatchObject({
      month: '2026-10',
      cutOverDate: '2026-10-01',
      passed: true,
    });
    expect(
      gate.criteria.map(
        (x: { key: string; ok: boolean }) => `${x.key} ${x.ok}`,
      ),
    ).toEqual([
      'opening_posted true',
      'month_closed true',
      'checklist_complete true',
      'old_system_matches true',
      'books_checks true',
    ]);
  });
});

describe('AI bill and receipt reader', () => {
  const sample = (name: string) => ({
    content: readFileSync(`samples/documents/${name}`),
    name,
  });

  it('reads a bill and finds the vendor by BIN; a person checks before anything is saved', async () => {
    expect(
      (
        await co.accounts.api
          .upload(
            '/ai/document-reader',
            { kind: 'bill', companyId: co.companyId },
            sample('bill-karim-traders-kt5590.png'),
          )
          .expect(403)
      ).body.code,
    ).toBe('AI_NOT_IN_PLAN');
    await asTenant(() =>
      db.tx.updateTable('tenants').set({ plan_tier: 'intelligent' }).execute(),
    );
    await co.md.api.put('/ai/settings', { enabled: true }).expect(200);

    const r = (
      await co.accounts.api
        .upload(
          '/ai/document-reader',
          { kind: 'bill', companyId: co.companyId },
          sample('bill-karim-traders-kt5590.png'),
        )
        .expect(200)
    ).body;
    expect(r).toMatchObject({
      readable: true,
      warnings: [],
      vendor: { id: karim.id, matchedBy: 'bin' },
      fields: { documentNo: 'KT-5590', date: '2026-10-24', total: '83375.00' },
    });
    expect(r.fields.lines).toHaveLength(2);
    const bills = (await co.accounts.api.get(`${c}/vendor-bills`).expect(200))
      .body;
    expect(JSON.stringify(bills)).not.toContain('KT-5590');
  });

  it('an employee reads a receipt for a claim; figures that do not add up are flagged; a blurred photo is unreadable', async () => {
    const hotel = (
      await co.rafi.api
        .upload(
          '/ai/document-reader',
          { kind: 'receipt' },
          sample('receipt-hotel-agrabad.png'),
        )
        .expect(200)
    ).body;
    expect(hotel).toMatchObject({
      readable: true,
      vendor: null,
      warnings: ['total_does_not_add_up: 6900.00 <> 6950.00'],
    });
    expect(
      (
        await co.rafi.api
          .upload(
            '/ai/document-reader',
            { kind: 'receipt' },
            sample('blurred-photo.png'),
          )
          .expect(200)
      ).body,
    ).toMatchObject({ readable: false, fields: null });
    expect(
      (
        await co.rafi.api
          .upload(
            '/ai/document-reader',
            { kind: 'receipt' },
            { content: Buffer.from('not a photo'), name: 'x.txt' },
          )
          .expect(400)
      ).body.code,
    ).toBe('DOCUMENT_UNREADABLE');

    // switched off for documents only
    await co.md.api
      .put('/ai/settings', { documentReaderEnabled: false })
      .expect(200);
    await co.rafi.api
      .upload(
        '/ai/document-reader',
        { kind: 'receipt' },
        sample('receipt-shohag-bus-ctg.png'),
      )
      .expect(403);
    await co.md.api
      .put('/ai/settings', { documentReaderEnabled: true })
      .expect(200);
  });

  it('the release-gate test set passes', async () => {
    const access = await db.withTenant({ tenantId: co.tenant.id }, () =>
      app.get(AccessService, { strict: false }).load(co.accounts.userId),
    );
    const reader = app.get(DocumentReaderService, { strict: false });
    const report = await runCases(
      loadCases('test/ai-eval/document-reader.yaml'),
      0.9,
      async (k) => {
        const data = readFileSync(k.document!);
        const r = await requestContext.run(
          {
            tenantId: co.tenant.id,
            userId: co.accounts.userId,
            access,
            language: k.language,
          },
          () =>
            reader.readFile(
              { mediaType: detectFileType(data) ?? 'image/png', data },
              k.kind ?? 'bill',
              `eval:${k.id}`,
              true,
            ),
        );
        return {
          answer: r.fields ? JSON.stringify(r.fields) : 'unreadable',
          toolsUsed: [],
        };
      },
      () => 'n/a',
    );
    expect(report.outcomes.filter((o) => !o.passed)).toEqual([]);
  });
});
