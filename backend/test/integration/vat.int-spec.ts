/**
 * WP21 VAT and compliance through the API (Meghna Foods test company, a VAT withholding
 * entity). Acceptance (docs/phase-2-plan.md): "Monthly VAT return data ties to the ledger".
 *
 * September: Rahman Properties' office rent (15 %, input VAT claimable) and a trading-stage
 * sale to Meghna Dealers (5 %): more input than output, a credit carried to October.
 * October: Clean & Care's cleaning bill naming its VAT item (10 %, not the 15 % typed), an IT
 * consultant without a BIN (VAT not claimable), a standard-rated sale to Sylhet Agro who
 * deducted VAT at source, an export (zero-rated), a sale still waiting for the checker, and
 * a stray journal to the input VAT account that must be cleared before filing.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ComplianceService } from '../../src/modules/vat/compliance.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-11-03T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api;
const acct: Record<string, string> = {};
const vendor: Record<string, string> = {};
const item: Record<string, string> = {};
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const approve = (requestId: string) =>
  checker.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);

async function approvedBill(body: object) {
  const draft = (
    await co.accounts.api.post(`${c}/vendor-bills`, body).expect(201)
  ).body;
  const submitted = (
    await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
  ).body;
  await approve(submitted.approvalRequestId);
  return (await co.accounts.api.get(`/vendor-bills/${draft.id}`).expect(200))
    .body;
}
async function postedSale(body: object) {
  const sale = (await co.accounts.api.post(`${c}/vat-sales`, body).expect(201))
    .body;
  await approve(sale.approvalRequestId);
  return (await co.accounts.api.get(`/vat-sales/${sale.id}`).expect(200)).body;
}
async function postVoucher(
  type: string,
  date: string,
  narration: string,
  lines: Array<[string, string | null, string?]>,
) {
  const draft = (
    await co.accounts.api
      .post(`${c}/vouchers`, {
        voucherType: type,
        voucherDate: date,
        narration,
        lines: lines.map(([code, debit, credit]) => ({
          accountId: acct[code],
          ...(debit ? { debit } : {}),
          ...(credit ? { credit } : {}),
        })),
      })
      .expect(201)
  ).body;
  const submitted = (
    await co.accounts.api.post(`/vouchers/${draft.id}/submit`).expect(200)
  ).body;
  await approve(submitted.approvalRequestId);
}
const balance = async (code: string) => {
  const rows = await asTenant(() =>
    sql<{ b: string }>`
    SELECT coalesce(sum(l.debit - l.credit), 0)::numeric(16,2)::text AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
     WHERE l.account_id = ${acct[code]} AND v.state = 'posted'`.execute(db.tx),
  );
  return rows.rows[0].b;
};

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
    .post(`${c}/ledger/setup`, { asOf: '2026-07-01' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
  await co.accounts.api
    .put(`${c}/payables-settings`, { vatWithholdingEntity: true })
    .expect(200);
  const add = async (key: string, body: object) =>
    (vendor[key] = (
      await co.accounts.api.post(`${c}/vendors`, body).expect(201)
    ).body.id);
  await add('rahman', {
    name: 'Rahman Properties',
    vendorType: 'individual',
    tin: '234567890123',
    bin: '000234567-0101',
    withholdingCategory: 'RENT',
    paymentTermsDays: 0,
  });
  await add('clean', {
    name: 'Clean & Care Services Ltd',
    tin: '123456789012',
    bin: '000123456-0101',
    withholdingCategory: 'SERVICE',
  });
  await add('shafiq', {
    name: 'Shafiqul Islam (IT consultant)',
    vendorType: 'individual',
    withholdingCategory: 'PROFESSIONAL',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('VAT items and rates', () => {
  it('the standard items for 2026-27; rates per fiscal year; Accounts only', async () => {
    await co.hr.api
      .post(`${c}/vat-items/defaults`, { fiscalYear: '2026-27' })
      .expect(403);
    const items = (
      await co.accounts.api
        .post(`${c}/vat-items/defaults`, { fiscalYear: '2026-27' })
        .expect(201)
    ).body;
    for (const i of items) item[i.code] = i.id;
    expect(
      items.find((i: { code: string }) => i.code === 'S-CLEAN').rates,
    ).toEqual([
      {
        fiscalYear: '2026-27',
        rateClass: 'reduced',
        vatPercent: '10.00',
        sdPercent: '0.00',
      },
    ]);
    // next year's budget: copied, then one rate changed
    expect(
      (
        await co.accounts.api
          .post(`${c}/vat-rates/copy`, { from: '2026-27', to: '2027-28' })
          .expect(201)
      ).body.copied,
    ).toBe(items.length);
    await co.accounts.api
      .put(`/vat-items/${item['S-ISP']}/rate`, {
        fiscalYear: '2027-28',
        rateClass: 'standard',
        vatPercent: '15',
      })
      .expect(200);
    expect(
      (
        await co.accounts.api
          .put(`/vat-items/${item.EXPORT}/rate`, {
            fiscalYear: '2026-27',
            rateClass: 'zero',
            vatPercent: '5',
          })
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    await co.md.api.get(`${c}/vat-items`).expect(200);
  });
});

describe('September: a credit carried forward', () => {
  it('rent bill and a trading-stage sale; the return is filed with the credit', async () => {
    const rent = await approvedBill({
      vendorId: vendor.rahman,
      billNo: 'RP-2026-09',
      billDate: '2026-09-05',
      narration: 'Office rent, September 2026',
      lines: [
        {
          accountId: acct['5210'],
          description: 'Gulshan-2 office rent',
          amount: '85000',
          vatItemId: item.S099,
        },
      ],
    });
    expect(rent).toMatchObject({
      vatAmount: '12750.00',
      inputVat: '12750.00',
      vdsAmount: '12750.00',
    });
    expect(rent.lines[0]).toMatchObject({
      vatPercent: '15.00',
      vatRateClass: 'standard',
      vatItemId: item.S099,
    });

    const sale = await postedSale({
      invoiceDate: '2026-09-20',
      customerName: 'Meghna Dealers, Chattogram',
      receivedIntoAccountId: acct['1130'],
      lines: [
        {
          itemId: item['TRADE-5'],
          description: 'Rice bran oil, 5 L (100 cans)',
          quantity: '100',
          value: '50000',
        },
      ],
    });
    expect(sale).toMatchObject({
      invoiceNo: 'VI/2026-27/00001',
      state: 'posted',
      vatAmount: '2500.00',
      receivedAmount: '52500.00',
    });

    const p = (
      await co.accounts.api
        .get(`${c}/vat-returns/preview?period=2026-09`)
        .expect(200)
    ).body;
    expect(p.tied).toBe(true);
    expect(p.figures).toMatchObject({
      outputTax: '2500.00',
      inputTax: '12750.00',
      netTax: '-10250.00',
      netPayable: '0.00',
      carryForwardOut: '10250.00',
    });
    await co.md.api.post(`${c}/vat-returns`, { period: '2026-09' }).expect(403);
    const r = (
      await co.accounts.api
        .post(`${c}/vat-returns`, {
          period: '2026-09',
          submittedOn: '2026-10-14',
          submissionRef: 'NBR-ERET-2610-00451',
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({
      period: '2026-09',
      carryForward: '10250.00',
      netPayable: '0.00',
      settlementVoucher: { number: expect.any(String) },
      challan: null,
    });
    expect(
      (
        await co.accounts.api
          .post(`/vat-returns/${r.id}/challan`, {
            challanNo: 'X',
            challanDate: '2026-10-14',
            paidFromAccountId: acct['1130'],
          })
          .expect(400)
      ).body.code,
    ).toBe('VAT_RETURN_NOTHING_TO_PAY');
  });

  it('a filed month stands: no new invoice, no second return, no reversal of its settlement', async () => {
    expect(
      (
        await co.accounts.api
          .post(`${c}/vat-sales`, {
            invoiceDate: '2026-09-28',
            customerName: 'Late',
            receivedIntoAccountId: acct['1130'],
            lines: [
              { itemId: item['GOODS-STD'], description: 'x', value: '100' },
            ],
          })
          .expect(409)
      ).body.code,
    ).toBe('VAT_PERIOD_FILED');
    expect(
      (
        await co.accounts.api
          .post(`${c}/vat-returns`, { period: '2026-09' })
          .expect(409)
      ).body.code,
    ).toBe('VAT_RETURN_FILED');
    const filed = (await co.accounts.api.get(`${c}/vat-returns`).expect(200))
      .body[0];
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${filed.settlementVoucherId}/reverse`, {
            reason: 'x',
          })
          .expect(409)
      ).body.code,
    ).toBe('VAT_PERIOD_FILED');
  });
});

describe('October: the return ties to the ledger', () => {
  it('bills, sales and the figures from the documents', async () => {
    const cleaning = await approvedBill({
      vendorId: vendor.clean,
      billNo: 'CCS/2026/1043',
      billDate: '2026-10-05',
      narration: 'Office cleaning, October 2026',
      lines: [
        {
          accountId: acct['5275'],
          description: 'Cleaning, 6 staff',
          amount: '120000',
          vatPercent: '15',
          vatItemId: item['S-CLEAN'],
        },
      ],
    });
    expect(cleaning).toMatchObject({
      vatAmount: '12000.00',
      inputVat: '12000.00',
      vdsAmount: '12000.00',
    }); // the item's 10 %, not the 15 % typed
    const consultant = await approvedBill({
      vendorId: vendor.shafiq,
      billNo: 'SI-07',
      billDate: '2026-10-10',
      narration: 'ERP data migration support',
      lines: [
        {
          accountId: acct['5295'],
          description: '10 days',
          amount: '40000',
          vatItemId: item['S-CONSULT'],
        },
      ],
    });
    expect(consultant).toMatchObject({
      vatAmount: '6000.00',
      inputVat: '0.00',
      vatInCost: '6000.00',
    }); // no BIN: not claimable

    const sylhet = await postedSale({
      invoiceDate: '2026-10-12',
      customerName: 'Sylhet Agro Ltd',
      customerBin: '000456789-0201',
      receivedIntoAccountId: acct['1130'],
      lines: [
        {
          itemId: item['GOODS-STD'],
          description: 'Mustard oil, 1 L (2,000 bottles)',
          quantity: '2000',
          value: '200000',
        },
      ],
      vdsByCustomer: '4500',
      vdsCertificateNo: 'M6.6-SA-2026-1101',
    });
    expect(sylhet).toMatchObject({
      invoiceNo: 'VI/2026-27/00002',
      vatAmount: '30000.00',
      vdsByCustomer: '4500.00',
      receivedAmount: '225500.00',
    });
    await postedSale({
      invoiceDate: '2026-10-18',
      customerName: 'Kolkata Foods Pvt Ltd (export)',
      receivedIntoAccountId: acct['1130'],
      lines: [
        {
          itemId: item.EXPORT,
          description: 'Puffed rice, 20 t',
          value: '120000',
        },
      ],
    });
    // a sale still waiting for the checker does not count
    await co.accounts.api
      .post(`${c}/vat-sales`, {
        invoiceDate: '2026-10-25',
        customerName: 'Pending Ltd',
        receivedIntoAccountId: acct['1130'],
        lines: [
          { itemId: item['GOODS-STD'], description: 'x', value: '10000' },
        ],
      })
      .expect(201);

    const p = (
      await co.accounts.api
        .get(`${c}/vat-returns/preview?period=2026-10`)
        .expect(200)
    ).body;
    expect(p.figures).toMatchObject({
      outputTax: '30000.00',
      inputTax: '12000.00',
      carryForwardIn: '10250.00',
      decreasing: { vdsByCustomers: '4500.00' },
      increasing: { vdsDeducted: '18000.00' },
      netTax: '3250.00',
      netPayable: '3250.00',
      carryForwardOut: '0.00',
    });
    expect(p.figures.sales.byClass.zero.value).toBe('120000.00');
    expect(p.figures.purchases.byClass.reduced.vat).toBe('12000.00');
    expect(p.figures.purchases.notClaimable.vat).toBe('6000.00');
    expect(
      p.ties.map(
        (t: { key: string; fromDocuments: string; inLedger: string }) => [
          t.key,
          t.fromDocuments,
          t.inLedger,
        ],
      ),
    ).toEqual([
      ['input_vat', '12000.00', '12000.00'],
      ['output_vat', '25500.00', '25500.00'], // 30,000 less what Sylhet Agro deducted
      ['vds_deducted', '18000.00', '18000.00'],
    ]);
    expect(p.tied).toBe(true);

    const register = (
      await co.accounts.api.get(`${c}/vat-sales?period=2026-10`).expect(200)
    ).body;
    expect(register.map((s: { state: string }) => s.state).sort()).toEqual([
      'in_approval',
      'posted',
      'posted',
    ]);
    expect(
      (
        await co.accounts.api
          .get(`${c}/vat-purchases?period=2026-10`)
          .expect(200)
      ).body,
    ).toHaveLength(2);
  });

  it('a stray journal to the input VAT account: not tied, not filed, until it is corrected', async () => {
    await postVoucher('journal', '2026-10-20', 'Input VAT adjustment (wrong)', [
      ['1180', '500'],
      ['5290', null, '500'],
    ]);
    const p = (
      await co.accounts.api
        .get(`${c}/vat-returns/preview?period=2026-10`)
        .expect(200)
    ).body;
    expect(p.tied).toBe(false);
    expect(p.ties[0]).toMatchObject({
      key: 'input_vat',
      difference: '500.00',
      unexplained: [
        expect.objectContaining({
          narration: 'Input VAT adjustment (wrong)',
          amount: '500.00',
        }),
      ],
    });
    const refused = (
      await co.accounts.api
        .post(`${c}/vat-returns`, { period: '2026-10' })
        .expect(409)
    ).body;
    expect(refused.code).toBe('VAT_RETURN_NOT_TIED');

    await postVoucher(
      'journal',
      '2026-10-31',
      'Correction of the input VAT adjustment',
      [
        ['5290', '500'],
        ['1180', null, '500'],
      ],
    );
    expect(
      (
        await co.accounts.api
          .get(`${c}/vat-returns/preview?period=2026-10`)
          .expect(200)
      ).body.tied,
    ).toBe(true);
  });

  it('only a month that has ended, in order', async () => {
    expect(
      (
        await co.accounts.api
          .post(`${c}/vat-returns`, { period: '2026-11' })
          .expect(400)
      ).body.code,
    ).toBe('VAT_RETURN_PERIOD_INVALID');
  });

  it('filed and paid: the output and input VAT accounts come to nothing', async () => {
    const r = (
      await co.accounts.api
        .post(`${c}/vat-returns`, {
          period: '2026-10',
          submissionRef: 'NBR-ERET-2611-00877',
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({
      outputVat: '30000.00',
      inputVat: '12000.00',
      netPayable: '3250.00',
      carryForward: '0.00',
      changedSinceFiling: false,
    });
    expect(await balance('1180')).toBe('0.00'); // September's and October's input set off
    expect(await balance('2160')).toBe('-3250.00'); // credit: what is to deposit

    const paid = (
      await co.accounts.api
        .post(`/vat-returns/${r.id}/challan`, {
          challanNo: 'A-2026-11-00871',
          challanDate: '2026-11-03',
          paidFromAccountId: acct['1130'],
        })
        .expect(201)
    ).body;
    expect(paid.challan).toMatchObject({
      amount: '3250.00',
      state: 'in_approval',
    });
    expect(
      (
        await co.accounts.api
          .post(`/vat-returns/${r.id}/challan`, {
            challanNo: 'A-2',
            challanDate: '2026-11-03',
            paidFromAccountId: acct['1130'],
          })
          .expect(409)
      ).body.code,
    ).toBe('VAT_CHALLAN_EXISTS');
    await approve(paid.challan.approvalRequestId);
    expect(
      (await co.accounts.api.get(`/vat-returns/${r.id}`).expect(200)).body
        .challan.state,
    ).toBe('deposited');
    expect(await balance('2160')).toBe('0.00');
  });
});

describe('the compliance calendar', () => {
  it('filed returns close themselves; withholdings close once deposited; the rest by a person', async () => {
    await co.hr.api.get(`${c}/compliance`).expect(403);
    const items = (
      await co.md.api
        .get(`${c}/compliance?from=2026-10-01&to=2026-11-30`)
        .expect(200)
    ).body as Array<{
      id: string;
      kind: string;
      period: string;
      state: string;
      evidence: string | null;
      dueDate: string;
    }>;
    const find = (kind: string, period: string) =>
      items.find((i) => i.kind === kind && i.period === period)!;
    expect(find('vat_return', '2026-09')).toMatchObject({
      state: 'done',
      evidence: 'auto: filed 2026-10-14, NBR-ERET-2610-00451',
      dueDate: '2026-10-15',
    });
    expect(find('vat_return', '2026-10')).toMatchObject({
      state: 'done',
      dueDate: '2026-11-15',
    });
    expect(find('vds_deposit', '2026-10')).toMatchObject({ state: 'open' });
    expect(find('salary_tax_deposit', '2026-10').state).toBe('open');

    // VDS of October deposited: the item closes
    const challan = (
      await co.accounts.api
        .post(`${c}/tax-challans`, {
          taxType: 'vds',
          period: '2026-10',
          challanNo: 'VDS-2026-10-0091',
          challanDate: '2026-11-03',
          paidFromAccountId: acct['1130'],
        })
        .expect(201)
    ).body;
    await approve(challan.approvalRequestId);
    const after = (
      await co.accounts.api.get(`${c}/compliance?state=done`).expect(200)
    ).body as typeof items;
    expect(
      after.find((i) => i.kind === 'vds_deposit' && i.period === '2026-10'),
    ).toMatchObject({ evidence: 'auto: challan VDS-2026-10-0091' });

    // the company's own item, closed by hand
    const fire = (
      await co.accounts.api
        .post(`${c}/compliance`, {
          title: 'Fire licence renewal (Fire Service and Civil Defence)',
          dueDate: '2026-12-31',
        })
        .expect(201)
    ).body;
    const done = (
      await co.md.api
        .post(`/compliance/${fire.id}/close`, {
          state: 'done',
          evidence: 'Renewed, licence FSCD/DHK/2026/4471',
        })
        .expect(200)
    ).body;
    expect(done).toMatchObject({
      state: 'done',
      evidence: 'Renewed, licence FSCD/DHK/2026/4471',
    });
  });

  it('reminders: once per item and stage, overdue first', async () => {
    const compliance = app.get(ComplianceService, { strict: false });
    const sent = await asTenant(() => compliance.remind());
    expect(sent).toBeGreaterThan(0);
    const events = await asTenant(() =>
      db.tx
        .selectFrom('outbox_events')
        .select(['type', 'payload'])
        .where('type', 'in', ['compliance.due_soon', 'compliance.overdue'])
        .execute(),
    );
    const titles = (type: string) =>
      events
        .filter((e) => e.type === type)
        .map((e) => (e.payload as { title: string }).title);
    // September's rent TDS was never deposited
    expect(titles('compliance.overdue')).toContain(
      'Deposit income tax deducted from vendor payments (TDS challan): 2026-09',
    );
    // October's VAT return is filed, so no reminder for it
    expect(
      [...titles('compliance.overdue'), ...titles('compliance.due_soon')].some(
        (t) => t.startsWith('VAT return (Mushak 9.1): 2026-10'),
      ),
    ).toBe(false);
    // the same day again: nothing new
    expect(await asTenant(() => compliance.remind())).toBe(0);
    // 13 November: one day before October's TDS deposit
    clock.set(new Date('2026-11-13T10:00:00+06:00'));
    await asTenant(() => compliance.remind());
    const soon = await asTenant(() =>
      db.tx
        .selectFrom('outbox_events')
        .select('payload')
        .where('type', '=', 'compliance.due_soon')
        .execute(),
    );
    expect(
      soon.map((e) => (e.payload as { title: string; daysLeft: number }).title),
    ).toContain(
      'Deposit income tax deducted from vendor payments (TDS challan): 2026-10',
    );
  });
});
