/**
 * WP17 procurement through the API (Meghna Foods test company).
 * Acceptance (docs/phase-2-plan.md): "Payment impossible without a matched bill;
 * quotation rule enforced".
 *
 * Rafi (Sales Dhaka) asks for 6 office chairs and 2 meeting tables for the new sales
 * officers, estimated Tk 75,000: above the quotation threshold (Tk 50,000), so 3
 * quotations and a comparative statement the Admin approves. Partex is chosen (not
 * the lowest: faster delivery), the PO is issued, the chairs arrive in two lots,
 * and the bills are three-way matched.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ManualClock } from '../../src/platform/clock.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-05T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api; // Sumaiya, second Accounts user
const acct: Record<string, string> = {};
const vendor: Record<string, string> = {};
let pr: { id: string; lines: Array<{ id: string; description: string }> };
let po: { id: string; lines: Array<{ id: string; description: string }> };
const approve = (requestId: string, who: Api) =>
  who.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);
const chairLine = () =>
  po.lines.find((l) => l.description.startsWith('Office chair'))!;
const tableLine = () =>
  po.lines.find((l) => l.description.startsWith('Meeting table'))!;

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
  const add = async (key: string, name: string, tin: string) =>
    (vendor[key] = (
      await co.accounts.api
        .post(`${c}/vendors`, {
          name,
          tin,
          bin: `000${tin.slice(0, 6)}-0101`,
          withholdingCategory: 'SUPPLY',
        })
        .expect(201)
    ).body.id);
  await add('otobi', 'Otobi Ltd', '412345678901');
  await add('hatil', 'Hatil Complex Ltd', '423456789012');
  await add('partex', 'Partex Furniture Industries Ltd', '434567890123');
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('requisition', () => {
  it('Rafi asks; his Dept Head, then Accounts approve', async () => {
    const draft = (
      await co.rafi.api
        .post(`${c}/purchase-requisitions`, {
          title: 'Furniture for the new sales officers',
          justification: 'Six sales officers join Sales Dhaka in November',
          neededBy: '2026-11-01',
          lines: [
            {
              description: 'Office chair, mesh back',
              quantity: '6',
              unit: 'pcs',
              estimatedUnitPrice: '8500',
            },
            {
              description: 'Meeting table, 6 seats',
              quantity: '2',
              unit: 'pcs',
              estimatedUnitPrice: '12000',
            },
          ],
        })
        .expect(201)
    ).body;
    expect(draft).toMatchObject({
      number: expect.stringMatching(/^PR\/2026-27\/\d{5}$/),
      estimatedTotal: '75000.00',
      state: 'draft',
      departmentId: co.departments.salesDhaka,
    });
    pr = draft;

    // nobody else's requisition, nor the company list, for an employee
    await co.rafi.api.get(`${c}/purchase-requisitions`).expect(403);
    await co.hr.api.get(`/purchase-requisitions/${pr.id}`).expect(403);

    const submitted = (
      await co.rafi.api
        .post(`/purchase-requisitions/${pr.id}/submit`)
        .expect(200)
    ).body;
    const request = (
      await co.salesHead.api
        .get(`/approvals/requests/${submitted.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(
      request.steps.length ?? request.approvers.length,
    ).toBeGreaterThanOrEqual(2);
    await approve(submitted.approvalRequestId, co.salesHead.api);
    await approve(submitted.approvalRequestId, co.accounts.api);
    expect(
      (await co.rafi.api.get(`/purchase-requisitions/${pr.id}`).expect(200))
        .body.state,
    ).toBe('approved');

    // the Dept Head sees his department's requisitions; Accounts sees all
    expect(
      (
        await co.salesHead.api.get(`${c}/purchase-requisitions`).expect(200)
      ).body.map((x: { id: string }) => x.id),
    ).toContain(pr.id);
  });

  it('from the Admin threshold (Tk 5 lakh) the Admin approves too', async () => {
    const big = (
      await co.rafi.api
        .post(`${c}/purchase-requisitions`, {
          title: 'Laptops for the sales team',
          justification: 'Old laptops are 6 years old',
          lines: [
            {
              description: 'Laptop, Core i7, 16 GB',
              quantity: '3',
              unit: 'pcs',
              estimatedUnitPrice: '180000',
            },
          ],
        })
        .expect(201)
    ).body;
    const submitted = (
      await co.rafi.api
        .post(`/purchase-requisitions/${big.id}/submit`)
        .expect(200)
    ).body;
    await approve(submitted.approvalRequestId, co.salesHead.api);
    await approve(submitted.approvalRequestId, co.accounts.api);
    expect(
      (await co.rafi.api.get(`/purchase-requisitions/${big.id}`).expect(200))
        .body.state,
    ).toBe('in_approval');
    await approve(submitted.approvalRequestId, co.md.api);
    expect(
      (await co.rafi.api.get(`/purchase-requisitions/${big.id}`).expect(200))
        .body.state,
    ).toBe('approved');
  });
});

describe('quotations and the comparative statement', () => {
  const quote = (
    vendorId: string,
    ref: string,
    chair: string,
    table: string,
    deliveryDays: number,
  ) => ({
    vendorId,
    reference: ref,
    quotationDate: '2026-10-06',
    validUntil: '2026-10-31',
    deliveryDays,
    lines: [
      { requisitionLineId: pr.lines[0].id, unitPrice: chair, vatPercent: '15' },
      { requisitionLineId: pr.lines[1].id, unitPrice: table, vatPercent: '15' },
    ],
  });

  it('Accounts records the quotations; every line needs a price', async () => {
    await co.rafi.api
      .post(
        `/purchase-requisitions/${pr.id}/quotations`,
        quote(vendor.otobi, 'OT/Q/311', '8200', '11500', 14),
      )
      .expect(403);
    const half = {
      ...quote(vendor.otobi, 'OT/Q/311', '8200', '11500', 14),
      lines: [{ requisitionLineId: pr.lines[0].id, unitPrice: '8200' }],
    };
    expect(
      (
        await co.accounts.api
          .post(`/purchase-requisitions/${pr.id}/quotations`, half)
          .expect(400)
      ).body.code,
    ).toBe('QUOTATION_INCOMPLETE');
    await co.accounts.api
      .post(
        `/purchase-requisitions/${pr.id}/quotations`,
        quote(vendor.otobi, 'OT/Q/311', '8200', '11500', 14),
      )
      .expect(201);
    await co.accounts.api
      .post(
        `/purchase-requisitions/${pr.id}/quotations`,
        quote(vendor.hatil, 'HCL-2026-0788', '8900', '12500', 10),
      )
      .expect(201);
  });

  it('the quotation rule: at least 3 above the threshold; a reason when not the lowest', async () => {
    const two = await co.accounts.api
      .post(`/purchase-requisitions/${pr.id}/comparative-statement`, {
        quotationId: (await quotations())[0].id,
      })
      .expect(400);
    expect(two.body).toMatchObject({
      code: 'QUOTATIONS_TOO_FEW',
      details: { have: 2, need: 3 },
    });

    await co.accounts.api
      .post(
        `/purchase-requisitions/${pr.id}/quotations`,
        quote(vendor.partex, 'PFIL/Q/1042', '8300', '11800', 5),
      )
      .expect(201);
    const list = await quotations();
    expect(list.find((q) => q.lowest)).toMatchObject({
      vendorId: vendor.otobi,
      total: '83030.00',
    }); // 72,200 + 15% VAT
    const partex = list.find((q) => q.vendorId === vendor.partex)!;
    expect(partex.total).toBe('84410.00'); // 73,400 + 15% VAT

    expect(
      (
        await co.accounts.api
          .post(`/purchase-requisitions/${pr.id}/comparative-statement`, {
            quotationId: partex.id,
          })
          .expect(400)
      ).body.code,
    ).toBe('SELECTION_REASON_REQUIRED');
    const cs = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/comparative-statement`, {
          quotationId: partex.id,
          reason:
            'Delivery in 5 days; Otobi needs 14, the officers join on 1 November',
        })
        .expect(200)
    ).body;
    expect(cs.comparativeStatement).toMatchObject({
      needed: true,
      state: 'in_approval',
      selectedQuotationId: partex.id,
    });

    // no order before the Admin approves the statement
    const order = {
      quotationId: partex.id,
      orderDate: '2026-10-08',
      deliveryDate: '2026-10-13',
      deliverTo: 'Dhaka HQ, Gulshan-2',
      lines: pr.lines.map((l) => ({
        requisitionLineId: l.id,
        accountId: acct['1210'],
      })),
    };
    expect(
      (
        await co.accounts.api
          .post(`/purchase-requisitions/${pr.id}/purchase-orders`, order)
          .expect(409)
      ).body.code,
    ).toBe('COMPARATIVE_STATEMENT_REQUIRED');
    await approve(cs.comparativeStatement.approvalRequestId, co.md.api);
    // only the chosen quotation may be ordered
    const otobi = list.find((q) => q.vendorId === vendor.otobi)!;
    await co.accounts.api
      .post(`/purchase-requisitions/${pr.id}/purchase-orders`, {
        ...order,
        quotationId: otobi.id,
      })
      .expect(409);
    await co.accounts.api
      .post(`/purchase-requisitions/${pr.id}/purchase-orders`, {
        ...order,
        lines: pr.lines.map((l) => ({
          requisitionLineId: l.id,
          accountId: acct['1130'],
        })),
      })
      .expect(400); // not a bank account

    const created = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/purchase-orders`, order)
        .expect(201)
    ).body;
    expect(created).toMatchObject({
      number: expect.stringMatching(/^PO\/2026-27\/\d{5}$/),
      state: 'draft',
      vendorId: vendor.partex,
      baseTotal: '73400.00',
      vatTotal: '11010.00',
    });
    po = (
      await co.accounts.api
        .post(`/purchase-orders/${created.id}/issue`)
        .expect(200)
    ).body;
    expect(po).toMatchObject({ state: 'issued' });
    expect(
      (await co.rafi.api.get(`/purchase-requisitions/${pr.id}`).expect(200))
        .body,
    ).toMatchObject({
      state: 'ordered',
      purchaseOrder: { number: created.number },
    });
  });

  async function quotations(): Promise<
    Array<{ id: string; vendorId: string; total: string; lowest: boolean }>
  > {
    return (
      await co.accounts.api.get(`/purchase-requisitions/${pr.id}`).expect(200)
    ).body.quotations;
  }
});

describe('goods received and the three-way match', () => {
  let chairsBill: string;

  it('the Dept Head records what arrived; never more than ordered', async () => {
    await co.hr.api
      .post(`/purchase-orders/${po.id}/receipts`, {
        receivedDate: '2026-10-12',
        lines: [{ poLineId: chairLine().id, quantity: '4' }],
      })
      .expect(403);
    expect(
      (
        await co.salesHead.api
          .post(`/purchase-orders/${po.id}/receipts`, {
            receivedDate: '2026-10-12',
            lines: [{ poLineId: chairLine().id, quantity: '7' }],
          })
          .expect(400)
      ).body.code,
    ).toBe('RECEIPT_EXCEEDS_ORDER');
    const order = (
      await co.salesHead.api
        .post(`/purchase-orders/${po.id}/receipts`, {
          receivedDate: '2026-10-12',
          note: '4 chairs; 2 more next week',
          lines: [{ poLineId: chairLine().id, quantity: '4' }],
        })
        .expect(201)
    ).body;
    expect(order).toMatchObject({
      state: 'partially_received',
      receipts: [
        {
          number: expect.stringMatching(/^GRN\/2026-27\/\d{5}$/),
          recordedBy: 'Tanvir Hossain',
        },
      ],
    });
    expect(
      order.lines.find((l: { id: string }) => l.id === chairLine().id),
    ).toMatchObject({ received: '4', toReceive: '2' });
  });

  it('a bill for more than was received is a mismatch: approved, but it cannot be paid', async () => {
    const bad = {
      vendorId: vendor.partex,
      billNo: 'PFIL/INV/7781',
      billDate: '2026-10-13',
      narration: 'Chairs, PO for the sales officers',
      purchaseOrderId: po.id,
      lines: [
        {
          accountId: acct['1210'],
          description: 'Office chair, mesh back',
          amount: '49800',
          vatPercent: '15',
        },
      ],
    };
    expect(
      (await co.accounts.api.post(`${c}/vendor-bills`, bad).expect(400)).body
        .code,
    ).toBe('BILL_PO_INVALID'); // no PO line / quantity
    const lines = [
      {
        accountId: acct['1210'],
        description: 'Office chair, mesh back',
        amount: '49800',
        vatPercent: '15',
        poLineId: chairLine().id,
        quantity: '6',
      },
    ];
    await co.accounts.api
      .post(`${c}/vendor-bills`, { ...bad, vendorId: vendor.otobi, lines })
      .expect(400); // another vendor's PO

    const draft = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, { ...bad, lines })
        .expect(201)
    ).body;
    chairsBill = draft.id;
    expect(draft).toMatchObject({
      purchaseOrderId: po.id,
      matchStatus: 'mismatch',
    });
    expect(draft.matchDetails.lines[0]).toMatchObject({
      receivedQty: '4',
      billQty: '6',
      problems: ['billed_more_than_received'],
    });
    const submitted = (
      await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
    ).body;
    await approve(submitted.approvalRequestId, checker);

    const pay = {
      vendorId: vendor.partex,
      paymentDate: '2026-10-14',
      method: 'cash',
      paidFromAccountId: acct['1110'],
      allocations: [{ billId: draft.id, amount: '10000' }],
    };
    expect(
      (await co.accounts.api.post(`${c}/vendor-payments`, pay).expect(409)).body
        .code,
    ).toBe('BILL_NOT_MATCHED');
  });

  it('the rest arrives: the bill matches by itself and can be paid', async () => {
    await co.accounts.api
      .post(`/purchase-orders/${po.id}/receipts`, {
        receivedDate: '2026-10-19',
        lines: [
          { poLineId: chairLine().id, quantity: '2' },
          { poLineId: tableLine().id, quantity: '2' },
        ],
      })
      .expect(201);
    const bill = (
      await co.accounts.api.get(`/vendor-bills/${chairsBill}`).expect(200)
    ).body;
    expect(bill.matchStatus).toBe('matched');
    expect(
      (await co.accounts.api.get(`/purchase-orders/${po.id}`).expect(200)).body
        .state,
    ).toBe('received');
    await co.accounts.api
      .post(`${c}/vendor-payments`, {
        vendorId: vendor.partex,
        paymentDate: '2026-10-20',
        method: 'cash',
        paidFromAccountId: acct['1110'],
        allocations: [{ billId: chairsBill, amount: '10000' }],
      })
      .expect(201);
  });

  it('a price above the order (beyond 2%) is a mismatch; the Admin may accept it with a reason', async () => {
    const draft = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.partex,
          billNo: 'PFIL/INV/7802',
          billDate: '2026-10-20',
          narration: 'Meeting tables',
          purchaseOrderId: po.id,
          lines: [
            {
              accountId: acct['1210'],
              description: 'Meeting table, 6 seats',
              amount: '24800',
              vatPercent: '15',
              poLineId: tableLine().id,
              quantity: '2',
            },
          ],
        })
        .expect(201)
    ).body;
    expect(draft.matchDetails.lines[0]).toMatchObject({
      poUnitPrice: '11800.00',
      billUnitPrice: '12400.00',
      maxUnitPrice: '12036.00',
      problems: ['price_above_order'],
    });
    const submitted = (
      await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
    ).body;
    await approve(submitted.approvalRequestId, checker);

    await co.accounts.api
      .post(`/vendor-bills/${draft.id}/match-override`, { reason: 'x' })
      .expect(403);
    const accepted = (
      await co.md.api
        .post(`/vendor-bills/${draft.id}/match-override`, {
          reason: 'Price rise for the new laminate agreed by phone on 15 Oct',
        })
        .expect(200)
    ).body;
    expect(accepted).toMatchObject({
      matchStatus: 'overridden',
      matchOverrideReason: expect.stringContaining('laminate'),
    });
    await co.accounts.api
      .post(`${c}/vendor-payments`, {
        vendorId: vendor.partex,
        paymentDate: '2026-10-21',
        method: 'cash',
        paidFromAccountId: acct['1110'],
        allocations: [{ billId: draft.id, amount: '5000' }],
      })
      .expect(201);
  });

  it('the database refuses a payment line for a mismatched bill, whatever the caller', async () => {
    // mark the paid chairs bill a mismatch, then try to add to an existing payment directly
    const asTenant = <T>(work: () => Promise<T>) =>
      db.withTenant(
        { tenantId: co.tenant.id, access: AccessGrants.system() },
        work,
      );
    await asTenant(() =>
      db.tx
        .updateTable('vendor_bills')
        .set({ match_status: 'mismatch' })
        .where('id', '=', chairsBill)
        .execute(),
    );
    const payment = await asTenant(() =>
      db.tx
        .selectFrom('vendor_payments')
        .select('id')
        .where('vendor_id', '=', vendor.partex)
        .executeTakeFirstOrThrow(),
    );
    await expect(
      asTenant(() =>
        sql`INSERT INTO vendor_payment_allocations (payment_id, bill_id, amount) VALUES (${payment.id}, ${chairsBill}, 1)`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow(/not matched/);
    await asTenant(() =>
      db.tx
        .updateTable('vendor_bills')
        .set({ match_status: 'matched' })
        .where('id', '=', chairsBill)
        .execute(),
    );
  });

  it('what is received and billed cannot be taken back; the order cannot be cancelled', async () => {
    const order = (
      await co.accounts.api.get(`/purchase-orders/${po.id}`).expect(200)
    ).body;
    expect(
      (
        await co.accounts.api
          .post(`/goods-receipts/${order.receipts[0].id}/cancel`, {
            reason: 'typo',
          })
          .expect(409)
      ).body.code,
    ).toBe('RECEIPT_ALREADY_BILLED');
    await co.accounts.api
      .post(`/purchase-orders/${po.id}/cancel`, { reason: 'no longer needed' })
      .expect(409);
    expect(
      order.lines.map(
        (l: { billed: string; received: string }) =>
          `${l.received}/${l.billed}`,
      ),
    ).toEqual(['6/6', '2/2']);
  });
});

describe('a small purchase', () => {
  it('below the quotation threshold one quotation is enough, and no comparative statement', async () => {
    const small = (
      await co.rafi.api
        .post(`${c}/purchase-requisitions`, {
          title: 'Printer paper',
          justification: 'Monthly stock',
          lines: [
            {
              description: 'A4 paper, 80 gsm',
              quantity: '5',
              unit: 'ream',
              estimatedUnitPrice: '650',
            },
          ],
        })
        .expect(201)
    ).body;
    const submitted = (
      await co.rafi.api
        .post(`/purchase-requisitions/${small.id}/submit`)
        .expect(200)
    ).body;
    await approve(submitted.approvalRequestId, co.salesHead.api);
    await approve(submitted.approvalRequestId, co.accounts.api);
    const withQuote = (
      await co.accounts.api
        .post(`/purchase-requisitions/${small.id}/quotations`, {
          vendorId: vendor.otobi,
          reference: 'walk-in',
          quotationDate: '2026-10-06',
          lines: [{ requisitionLineId: small.lines[0].id, unitPrice: '640' }],
        })
        .expect(201)
    ).body;
    expect(withQuote.comparativeStatement.needed).toBe(false);
    await co.accounts.api
      .post(`/purchase-requisitions/${small.id}/purchase-orders`, {
        quotationId: withQuote.quotations[0].id,
        orderDate: '2026-10-06',
        lines: [
          { requisitionLineId: small.lines[0].id, accountId: acct['5240'] },
        ],
      })
      .expect(201);

    // the requester follows it in the app
    const mine = (
      await co.rafi.api.get('/me/purchase-requisitions').expect(200)
    ).body;
    expect(mine.find((x: { id: string }) => x.id === small.id)).toMatchObject({
      state: 'ordered',
      purchaseOrder: { state: 'draft' },
    });
  });
});
