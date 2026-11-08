/**
 * WP25-WP27 quotations, orders, invoices and collections through the API (Meghna Foods test
 * company, clock 3 November 2026). Acceptance (docs/phase-3-plan.md):
 *   WP25 "No quotation above a discount limit goes out without its approval; quotation totals
 *        and VAT reproduce from the lines"
 *   WP26 "The receivables control account equals the open invoices every night; credit limit
 *        enforced; invoice VAT ties to the VAT return"
 *   WP27 "A receipt closes exactly what it pays; reminders go once per stage; the aged
 *        receivables equal the ledger"
 *
 * Rafi (Sales Dhaka, under Tanvir) sells rice bran oil and soybean oil to Khatunganj Traders
 * (a Chattogram dealer, credit Tk 5 lakh, 30 days) and Agrabad Super Shop (retail, Tk 1 lakh,
 * 15 days). Accounts invoices and records receipts; Sumaiya (Finance) is the checker.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ReceiptsService } from '../../src/modules/sales/receipts.service.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const NOV_3 = new Date('2026-11-03T10:00:00+06:00');
const clock = new ManualClock(NOV_3);
let app: INestApplication;
let co: BdCompany;
let c: string;
let rafi: Api;
let checker: Api;
const acct: Record<string, string> = {};
const product: Record<string, string> = {};
const customer: Record<string, string> = {};
const quote: Record<string, string> = {};
const order: Record<string, string> = {};
const invoice: Record<string, { id: string; itemId: string; lineId: string }> =
  {};
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const balance = async (code: string) => {
  const rows = await asTenant(() =>
    sql<{ b: string }>`
    SELECT coalesce(sum(l.debit - l.credit), 0)::numeric(16,2)::text AS b FROM voucher_lines l JOIN vouchers v ON v.id = l.voucher_id
     WHERE l.account_id = ${acct[code]} AND v.state = 'posted'`.execute(db.tx),
  );
  return rows.rows[0].b;
};
const step = async (
  path: string,
  id: string,
  body: object = {},
  api = rafi,
) => {
  const q = (await api.get(`/quotations/${id}`).expect(200)).body;
  return (
    await api
      .post(`/quotations/${id}/${path}`, { version: q.version, ...body })
      .expect(200)
  ).body;
};
const receipt = async (body: object) => {
  const r = (
    await co.accounts.api.post(`${c}/customer-receipts`, body).expect(201)
  ).body;
  await checker
    .post(`/approvals/requests/${r.voucher.approvalRequestId}/approve`, {})
    .expect(200);
  return (await co.accounts.api.get(`/customer-receipts/${r.id}`).expect(200))
    .body;
};

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);
  c = `/companies/${co.companyId}`;
  await co.owner
    .post(`/users/${co.rafi.userId}/roles`, { role: 'sales', scopeType: 'own' })
    .expect(201);
  await co.owner
    .post(`/users/${co.financeOfficer.userId}/roles`, {
      role: 'accounts',
      scopeType: 'company',
      scopeId: co.companyId,
    })
    .expect(201);
  rafi = await apiFor(app, {
    slug: co.tenant.slug,
    email: co.rafi.email,
    password: PASSWORD,
  });
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
  const items = (
    await co.accounts.api
      .post(`${c}/vat-items/defaults`, { fiscalYear: '2026-27' })
      .expect(201)
  ).body as Array<{ id: string; code: string }>;
  acct.GOODS_STD = items.find((i) => i.code === 'GOODS-STD')!.id;
  const add = async (api: Api, key: string, body: object, credit: object) => {
    const x = (await api.post(`${c}/customers`, body).expect(201)).body;
    customer[key] = x.id;
    await co.accounts.api
      .put(`/customers/${x.id}/credit`, { version: x.version, ...credit })
      .expect(200);
  };
  await add(
    rafi,
    'khatunganj',
    {
      kind: 'company',
      name: 'Khatunganj Traders',
      customerType: 'dealer',
      bin: '000345678-0201',
      phone: '031-2856677',
      address: 'Khatunganj, Chattogram',
      district: 'Chattogram',
    },
    { creditLimit: '500000', paymentTermsDays: 30 },
  );
  await add(
    rafi,
    'agrabad',
    {
      kind: 'company',
      name: 'Agrabad Super Shop',
      customerType: 'retail',
      phone: '01819-112233',
      district: 'Chattogram',
    },
    { creditLimit: '100000', paymentTermsDays: 15 },
  );
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('WP25 products, prices and limits', () => {
  it('Accounts sets up products, price lists and discount limits; a salesperson only reads them', async () => {
    await rafi
      .post(`${c}/products`, {
        code: 'X',
        name: 'X',
        unit: 'pcs',
        vatItemId: acct.GOODS_STD,
      })
      .expect(403);
    for (const [code, name, unit] of [
      ['RBO-5L', 'Rice bran oil 5 L can', 'can'],
      ['SOY-1L', 'Soybean oil 1 L bottle', 'bottle'],
    ]) {
      product[code] = (
        await co.accounts.api
          .post(`${c}/products`, {
            code,
            name,
            unit,
            vatItemId: acct.GOODS_STD,
          })
          .expect(201)
      ).body.id;
    }
    expect(
      (
        await co.accounts.api
          .post(`${c}/products`, {
            code: 'RBO-5L',
            name: 'again',
            unit: 'can',
            vatItemId: acct.GOODS_STD,
          })
          .expect(409)
      ).body.code,
    ).toBe('PRODUCT_CODE_TAKEN');
    await co.accounts.api
      .post(`${c}/price-lists`, {
        name: 'Prices 2026-27',
        fiscalYear: '2026-27',
        prices: [
          { productId: product['RBO-5L'], unitPrice: '1850' },
          { productId: product['SOY-1L'], unitPrice: '185' },
        ],
      })
      .expect(201);
    await co.accounts.api
      .post(`${c}/price-lists`, {
        name: 'Dealer prices 2026-27',
        fiscalYear: '2026-27',
        customerType: 'dealer',
        prices: [{ productId: product['RBO-5L'], unitPrice: '1780' }],
      })
      .expect(201);
    await co.accounts.api
      .put(`${c}/discount-limits`, {
        limits: [
          { maxPercent: '3' },
          { userId: co.rafi.userId, maxPercent: '5' },
        ],
      })
      .expect(200);
    expect((await rafi.get(`${c}/price-lists`).expect(200)).body).toHaveLength(
      2,
    );
  });
});

describe('WP25 quotations', () => {
  it('within the limit: priced from the dealer list, totals from the lines, approved at once; sending moves the opportunity', async () => {
    const opp = (
      await rafi
        .post(`${c}/opportunities`, {
          customerId: customer.khatunganj,
          title: 'Rice bran oil for Khatunganj, November',
          value: '350000',
          expectedCloseOn: '2026-11-20',
        })
        .expect(201)
    ).body;
    quote.oil = opp.id;
    const q = (
      await rafi
        .post(`${c}/quotations`, {
          customerId: customer.khatunganj,
          opportunityId: opp.id,
          validUntil: '2026-11-30',
          language: 'bn',
          lines: [
            {
              productId: product['RBO-5L'],
              quantity: '200',
              discountPercent: '4',
            },
          ],
        })
        .expect(201)
    ).body;
    expect(q).toMatchObject({
      number: 'QT/2026-27/00001',
      revision: 1,
      state: 'draft',
      needsApproval: false,
      subtotal: '356000.00',
      discountTotal: '14240.00',
      value: '341760.00',
      vatTotal: '51264.00',
      total: '393024.00',
    });
    expect(q.lines[0]).toMatchObject({
      listPrice: '1780.00',
      unitPrice: '1780.00',
      discountLimit: '5.00',
      vatPercent: '15.00',
    });
    // the totals reproduce from the lines
    const lines = await asTenant(() =>
      db.tx
        .selectFrom('sales_quotation_lines')
        .selectAll()
        .where('quotation_id', '=', q.id)
        .execute(),
    );
    const sum = (k: 'value' | 'vat_amount') =>
      lines.reduce((a, l) => a + Number(l[k]), 0).toFixed(2);
    expect([sum('value'), sum('vat_amount')]).toEqual([q.value, q.vatTotal]);
    quote.q1 = q.id;
    expect((await step('submit', q.id)).state).toBe('approved');
    expect((await step('send', q.id)).state).toBe('sent');
    expect(
      (await rafi.get(`/opportunities/${opp.id}`).expect(200)).body,
    ).toMatchObject({ stageName: 'Quotation sent', probability: 50 });
    const pdf = await rafi.get(`/quotations/${q.id}/pdf?lang=bn`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('above the limit (a lower typed price counts as discount): it cannot go out until the Sales head and the Admin approve', async () => {
    const q = (
      await rafi
        .post(`${c}/quotations`, {
          customerId: customer.khatunganj,
          validUntil: '2026-11-30',
          lines: [
            {
              productId: product['SOY-1L'],
              quantity: '1000',
              unitPrice: '170',
            },
          ],
        })
        .expect(201)
    ).body;
    expect(q).toMatchObject({
      needsApproval: true,
      value: '170000.00',
      vatTotal: '25500.00',
      total: '195500.00',
    });
    expect(q.lines[0]).toMatchObject({
      listPrice: '185.00',
      discountPercent: '0.00',
      overLimit: true,
    });
    quote.q2 = q.id;
    const submitted = await step('submit', q.id);
    expect(submitted.state).toBe('in_approval');
    expect(
      (
        await rafi
          .post(`/quotations/${q.id}/send`, { version: submitted.version })
          .expect(409)
      ).body.code,
    ).toBe('QUOTATION_WRONG_STATE');
    const request = (
      await rafi
        .get(`/approvals/requests/${submitted.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(request.requestType).toBe('quotation_discount');
    await co.salesHead.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {
        comment: 'Eid volume',
      })
      .expect(200);
    expect((await rafi.get(`/quotations/${q.id}`).expect(200)).body.state).toBe(
      'in_approval',
    ); // the Admin still to approve
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    expect((await rafi.get(`/quotations/${q.id}`).expect(200)).body.state).toBe(
      'approved',
    );
    expect((await step('send', q.id)).state).toBe('sent');
  });

  it('a revision keeps the number; the old one is superseded', async () => {
    const q = (
      await rafi
        .post(`${c}/quotations`, {
          customerId: customer.khatunganj,
          validUntil: '2026-11-15',
          lines: [{ productId: product['RBO-5L'], quantity: '50' }],
        })
        .expect(201)
    ).body;
    const r2 = (
      await rafi
        .post(`/quotations/${q.id}/revise`, {
          version: q.version,
          validUntil: '2026-11-20',
          lines: [
            {
              productId: product['RBO-5L'],
              quantity: '60',
              discountPercent: '2',
            },
          ],
        })
        .expect(201)
    ).body;
    expect(r2).toMatchObject({ number: q.number, revision: 2, state: 'draft' });
    expect(
      r2.revisions.map(
        (r: { revision: number; state: string }) => `${r.revision} ${r.state}`,
      ),
    ).toEqual(['1 superseded', '2 draft']);
    await step('cancel', r2.id, { reason: 'Customer bought locally' });
  });

  it("scope: the Sales head sees Rafi's quotations; Accounts reads them; HR does not", async () => {
    expect(
      (await co.salesHead.api.get(`${c}/quotations`).expect(200)).body.map(
        (q: { id: string }) => q.id,
      ),
    ).toEqual(expect.arrayContaining([quote.q1, quote.q2]));
    await co.accounts.api.get(`${c}/quotations`).expect(200);
    await co.hr.api.get(`${c}/quotations`).expect(403);
    await co.accounts.api
      .post(`/quotations/${quote.q1}/accept`, { version: 1 })
      .expect(403);
  });
});

describe('WP26 orders, invoices, credit notes', () => {
  it('within the credit limit the order is confirmed; over it, Accounts must approve', async () => {
    const q1 = await step('accept', quote.q1, {
      customerRef: 'KT/PO/2026/311',
    });
    expect(q1).toMatchObject({
      state: 'accepted',
      order: { state: 'confirmed' },
    });
    order.o1 = q1.order.id;
    // the opportunity is won at the order's value
    expect(
      (await rafi.get(`/opportunities/${quote.oil}`).expect(200)).body,
    ).toMatchObject({ state: 'won', value: '341760.00' });

    const q2 = await step('accept', quote.q2);
    order.o2 = q2.order.id;
    const o2 = (await rafi.get(`/sales-orders/${order.o2}`).expect(200)).body;
    // 393,024 already on order + 195,500 against a Tk 5 lakh limit
    expect(o2).toMatchObject({
      state: 'in_approval',
      creditCheck: {
        creditLimit: '500000.00',
        openOrders: '393024.00',
        order: '195500.00',
        exposure: '588524.00',
        over: true,
        overBy: '88524.00',
      },
    });
    expect(
      (
        await co.accounts.api
          .post(`/sales-orders/${order.o2}/invoice`, {})
          .expect(409)
      ).body.code,
    ).toBe('ORDER_WRONG_STATE');
    const request = (
      await co.accounts.api
        .get(`/approvals/requests/${o2.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(request.requestType).toBe('sales_order_credit');
    await co.accounts.api
      .post(`/approvals/requests/${o2.approvalRequestId}/approve`, {
        comment: 'Pays on time; cheque promised',
      })
      .expect(200);
    expect(
      (await rafi.get(`/sales-orders/${order.o2}`).expect(200)).body.state,
    ).toBe('confirmed');
  });

  it('delivered orders are invoiced by Accounts: Mushak 6.3 numbered, posted Dr receivables / Cr sales / Cr output VAT', async () => {
    await co.accounts.api
      .post(`/sales-orders/${order.o1}/invoice`, {})
      .expect(409); // not delivered yet
    for (const [o, challan] of [
      [order.o1, 'DC-1101'],
      [order.o2, 'DC-1102'],
    ]) {
      const x = (await rafi.get(`/sales-orders/${o}`).expect(200)).body;
      await rafi
        .post(`/sales-orders/${o}/deliver`, {
          version: x.version,
          challanNo: challan,
        })
        .expect(200);
    }
    await rafi.post(`/sales-orders/${order.o1}/invoice`, {}).expect(403);
    for (const [key, o] of [
      ['i1', order.o1],
      ['i2', order.o2],
    ]) {
      const i = (
        await co.accounts.api.post(`/sales-orders/${o}/invoice`, {}).expect(201)
      ).body;
      invoice[key] = { id: i.id, itemId: i.itemId, lineId: i.lines[0].id };
    }
    const i1 = (
      await co.accounts.api.get(`/sales-invoices/${invoice.i1.id}`).expect(200)
    ).body;
    expect(i1).toMatchObject({
      invoiceNo: 'VI/2026-27/00001',
      invoiceDate: '2026-11-03',
      dueDate: '2026-12-03',
      customerBin: '000345678-0201',
      total: '393024.00',
      outstanding: '393024.00',
    });
    expect(
      (await rafi.get(`/sales-orders/${order.o1}`).expect(200)).body.state,
    ).toBe('invoiced');
    expect(await balance('1150')).toBe('588524.00');
    expect(await balance('4100')).toBe('-511760.00');
    expect(await balance('2160')).toBe('-76764.00');
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true });
    const pdf = await co.accounts.api
      .get(`/sales-invoices/${invoice.i1.id}/pdf`)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('a credit note (Mushak 6.7) for returned cans: its share of the line, never more than invoiced', async () => {
    expect(
      (
        await co.accounts.api
          .post(`/sales-invoices/${invoice.i1.id}/credit-notes`, {
            reason: 'x',
            lines: [{ invoiceLineId: invoice.i1.lineId, quantity: '300' }],
          })
          .expect(400)
      ).body.code,
    ).toBe('CREDIT_TOO_MUCH');
    const i1 = (
      await co.accounts.api
        .post(`/sales-invoices/${invoice.i1.id}/credit-notes`, {
          reason: '10 cans dented in transit',
          lines: [{ invoiceLineId: invoice.i1.lineId, quantity: '10' }],
        })
        .expect(201)
    ).body;
    expect(i1.creditNotes).toMatchObject([
      { number: 'CN/2026-27/00001', total: '19651.20' },
    ]);
    expect(i1).toMatchObject({
      credited: '19651.20',
      outstanding: '373372.80',
    });
    expect(i1.lines[0].creditedQuantity).toBe('10.000');
    expect(await balance('1150')).toBe('568872.80');
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true });
  });
});

describe('WP27 collections', () => {
  it('a receipt closes exactly what it pays: a cheque with VAT deducted at source, a transfer across two invoices, money on account', async () => {
    const r1 = await receipt({
      customerId: customer.khatunganj,
      receiptDate: '2026-11-03',
      method: 'cheque',
      chequeNo: 'CA-4471209',
      chequeBank: 'Islami Bank, Khatunganj',
      receivedIntoAccountId: acct['1130'],
      amount: '300000',
      vdsAmount: '10000',
      vdsCertificateNo: 'M66/2026/118',
      allocations: [{ itemId: invoice.i1.itemId, amount: '310000' }],
    });
    expect(r1).toMatchObject({
      number: 'CR/2026-27/00001',
      state: 'posted',
      allocated: '310000.00',
      onAccount: '0.00',
    });
    // more than is open on an invoice, or someone else's invoice: refused
    const other = {
      customerId: customer.agrabad,
      receiptDate: '2026-11-03',
      method: 'cash',
      receivedIntoAccountId: acct['1110'],
      amount: '1000',
      allocations: [{ itemId: invoice.i1.itemId, amount: '1000' }],
    };
    expect(
      (await co.accounts.api.post(`${c}/customer-receipts`, other).expect(400))
        .body.code,
    ).toBe('RECEIPT_ALLOCATION_INVALID');
    const tooMuch = {
      customerId: customer.khatunganj,
      receiptDate: '2026-11-03',
      method: 'bank_transfer',
      receivedIntoAccountId: acct['1130'],
      amount: '70000',
      allocations: [{ itemId: invoice.i1.itemId, amount: '70000' }],
    };
    expect(
      (
        await co.accounts.api
          .post(`${c}/customer-receipts`, tooMuch)
          .expect(400)
      ).body.code,
    ).toBe('RECEIPT_ALLOCATION_INVALID');

    await receipt({
      customerId: customer.khatunganj,
      receiptDate: '2026-11-03',
      method: 'bank_transfer',
      reference: 'NPSB 8812034',
      receivedIntoAccountId: acct['1130'],
      amount: '250000',
      allocations: [
        { itemId: invoice.i1.itemId, amount: '63372.80' },
        { itemId: invoice.i2.itemId, amount: '186627.20' },
      ],
    });
    const r3 = await receipt({
      customerId: customer.khatunganj,
      receiptDate: '2026-11-03',
      method: 'bkash',
      reference: 'bKash TrxID 9KD71XQ2',
      receivedIntoAccountId: acct['1140'],
      amount: '20000',
      allocations: [],
    });
    expect(r3).toMatchObject({ onAccount: '20000.00', allocated: '0.00' });
    let account = (
      await co.accounts.api
        .get(`/customers/${customer.khatunganj}/account`)
        .expect(200)
    ).body;
    expect(account).toMatchObject({ owed: '8872.80', onAccount: '20000.00' });
    account = (
      await co.accounts.api
        .post(`/customers/${customer.khatunganj}/apply-advance`, {
          itemId: invoice.i2.itemId,
          amount: '8872.80',
        })
        .expect(200)
    ).body;
    expect(account).toMatchObject({
      owed: '0.00',
      onAccount: '11127.20',
      openInvoices: [],
    });
    expect(
      (
        await co.accounts.api
          .post(`/customers/${customer.khatunganj}/apply-advance`, {
            itemId: invoice.i2.itemId,
            amount: '1',
          })
          .expect(400)
      ).body.code,
    ).toBe('ADVANCE_TOO_MUCH');

    // each invoice is paid to the paisa, no more
    for (const i of [invoice.i1, invoice.i2])
      expect(
        (await co.accounts.api.get(`/sales-invoices/${i.id}`).expect(200)).body
          .outstanding,
      ).toBe('0.00');
    expect(await balance('1150')).toBe('0.00');
    expect(await balance('2105')).toBe('-11127.20');
    expect(
      (await co.accounts.api.get(`${c}/ledger/checks`).expect(200)).body,
    ).toMatchObject({ ok: true });
    // the bKash money was partly applied: its receipt can no longer be reversed
    const v = (
      await co.accounts.api.get(`/customer-receipts/${r3.id}`).expect(200)
    ).body.voucher;
    expect(
      (
        await co.accounts.api
          .post(`/vouchers/${v.id}/reverse`, { reason: 'test' })
          .expect(409)
      ).body.code,
    ).toBe('RECEIPT_ADVANCE_USED');
  });

  it('the statement runs to what is on account', async () => {
    const s = (
      await rafi
        .get(
          `/customers/${customer.khatunganj}/statement?from=2026-11-01&to=2026-11-30`,
        )
        .expect(200)
    ).body;
    expect(s).toMatchObject({ opening: '0.00', closing: '-11127.20' });
    expect(s.lines.map((l: { kind: string }) => l.kind).sort()).toEqual([
      'credit_note',
      'invoice',
      'invoice',
      'receipt',
      'receipt',
      'receipt',
    ]);
  });

  it('invoice VAT ties to the VAT return: invoices, the credit note and VAT deducted by the customer', async () => {
    const p = (
      await co.accounts.api
        .get(`${c}/vat-returns/preview?period=2026-11`)
        .expect(200)
    ).body;
    const out = p.ties.find((t: { key: string }) => t.key === 'output_vat');
    // 51,264 + 25,500 - 2,563.20 output VAT, less the Tk 10,000 the customer deducted
    expect(out).toMatchObject({
      fromDocuments: '64200.80',
      inLedger: '64200.80',
      difference: '0.00',
      unexplained: [],
    });
    expect(p.tied).toBe(true);
  });

  it('reminders go once per stage; from 15 days late the account manager gets a task; the aged receivables equal the ledger', async () => {
    const remind = () =>
      asTenant(() => app.get(ReceiptsService, { strict: false }).remind());
    const q = (
      await rafi
        .post(`${c}/quotations`, {
          customerId: customer.agrabad,
          validUntil: '2026-11-10',
          lines: [{ productId: product['RBO-5L'], quantity: '20' }],
        })
        .expect(201)
    ).body;
    await step('submit', q.id);
    await step('send', q.id);
    const accepted = await step('accept', q.id);
    const o = (await rafi.get(`/sales-orders/${accepted.order.id}`).expect(200))
      .body;
    await rafi
      .post(`/sales-orders/${o.id}/deliver`, {
        version: o.version,
        challanNo: 'DC-1103',
      })
      .expect(200);
    const i = (
      await co.accounts.api
        .post(`/sales-orders/${o.id}/invoice`, {})
        .expect(201)
    ).body;
    expect(i).toMatchObject({ dueDate: '2026-11-18', total: '42550.00' });

    try {
      expect(await remind()).toBe(0); // not due yet
      clock.set(new Date('2026-11-19T10:00:00+06:00'));
      expect(await remind()).toBe(1);
      expect(await remind()).toBe(0);
      clock.set(new Date('2026-12-04T10:00:00+06:00')); // 16 days late: stages 7 and 15 at once, one reminder
      expect(await remind()).toBe(1);
      expect(await remind()).toBe(0);
      const sent = await asTenant(() =>
        db.tx
          .selectFrom('collection_reminders')
          .select(['stage', 'escalated'])
          .where('item_id', '=', i.itemId)
          .orderBy('stage')
          .execute(),
      );
      expect(sent).toEqual([
        { stage: 1, escalated: false },
        { stage: 7, escalated: false },
        { stage: 15, escalated: true },
      ]);
      const events = await asTenant(() =>
        db.tx
          .selectFrom('outbox_events')
          .select('payload')
          .where('type', '=', 'invoice.overdue')
          .execute(),
      );
      expect(
        events.map((e) => e.payload as { stage: number; escalate: boolean }),
      ).toMatchObject([
        { stage: 1, escalate: false },
        { stage: 15, escalate: true },
      ]);
      const tasks = (await rafi.get(`${c}/crm/my-tasks`).expect(200))
        .body as Array<{ subject: string }>;
      expect(tasks.map((t) => t.subject)).toContain(
        `Collect ${i.invoiceNo}: Tk 42550.00, 16 days late`,
      );

      const aging = (
        await co.accounts.api
          .get(`${c}/receivables/aging?asOf=2026-12-04`)
          .expect(200)
      ).body;
      expect(aging.totals.total).toBe(await balance('1150'));
      expect(aging.customers).toEqual([
        expect.objectContaining({
          customer: expect.stringContaining('Agrabad Super Shop'),
          d1_30: '42550.00',
        }),
      ]);
      const byManager = (
        await co.accounts.api
          .get(`${c}/receivables/aging?asOf=2026-12-04&by=manager`)
          .expect(200)
      ).body;
      expect(byManager.customers).toEqual([
        expect.objectContaining({
          customer: 'Mahmudul Hasan Rafi',
          total: '42550.00',
        }),
      ]);
      // before the first invoice, nothing was owed
      const nov2 = (
        await co.accounts.api
          .get(`${c}/receivables/aging?asOf=2026-11-02`)
          .expect(200)
      ).body;
      expect(nov2.totals.total).toBe('0.00');
    } finally {
      clock.set(NOV_3);
    }
  });
});
