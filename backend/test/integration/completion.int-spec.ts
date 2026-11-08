/**
 * What was completed before go-live (2026-10-30), through the API (Meghna Foods, clock
 * 3 November 2026):
 *   resignation from the app   Rafi resigns; Tanvir (Dept Head) and HR approve; the notice starts
 *   PF settlement              interest for 2025-26, a withdrawal from his own part, and on leaving
 *                              the final settlement (under 3 years: the employer part is forfeited)
 *   customer import            the old system's customers through the migration tool, and back
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
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
    .post(`${c}/ledger/setup`, { asOf: '2025-07-01' })
    .expect(200);
  await co.accounts.api
    .post(`${c}/fiscal-years`, { forDate: '2026-07-01' })
    .expect(201);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('resignation from the app', () => {
  it('Rafi resigns; the Dept Head, then HR approve; his notice starts', async () => {
    const before = (await co.rafi.api.get('/me/resignation').expect(200)).body;
    expect(before).toMatchObject({
      status: expect.stringMatching(/active|probation/),
      canResign: true,
      request: null,
    });
    await co.rafi.api
      .post('/me/resignation', { lastWorkingDay: '2026-10-01', reason: 'x' })
      .expect(400); // in the past
    const r = (
      await co.rafi.api
        .post('/me/resignation', {
          lastWorkingDay: '2026-11-30',
          reason: 'Moving to Chattogram with my family',
        })
        .expect(201)
    ).body;
    expect(r).toMatchObject({
      canResign: false,
      request: { state: 'in_approval', lastWorkingDay: '2026-11-30' },
    });
    expect(
      (
        await co.rafi.api
          .post('/me/resignation', {
            lastWorkingDay: '2026-12-15',
            reason: 'again',
          })
          .expect(409)
      ).body.code,
    ).toBe('RESIGNATION_PENDING');

    const id = r.request.approvalRequestId;
    await co.rafi.api.post(`/approvals/requests/${id}/approve`, {}).expect(403); // not his own
    await co.salesHead.api
      .post(`/approvals/requests/${id}/approve`, {
        comment: 'Sad to see him go',
      })
      .expect(200);
    expect(
      (await co.rafi.api.get('/me/resignation').expect(200)).body.request.state,
    ).toBe('in_approval');
    await co.hr.api.post(`/approvals/requests/${id}/approve`, {}).expect(200);

    const after = (await co.rafi.api.get('/me/resignation').expect(200)).body;
    expect(after).toMatchObject({
      status: 'notice',
      lastWorkingDay: '2026-11-30',
      request: { state: 'accepted', separationId: expect.any(String) },
    });
    const sep = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/separation`)
        .expect(200)
    ).body;
    expect(sep).toMatchObject({
      kind: 'resignation',
      lastWorkingDay: '2026-11-30',
    });
  });
});

describe('PF: interest, withdrawal, final settlement', () => {
  it('interest for 2025-26 on the year-end balance, both parts, once', async () => {
    await co.hr.api
      .put(`/employees/${co.rafi.employeeId}/pf-opening`, {
        asOf: '2025-06-30',
        employeePart: '48000',
        employerPart: '48000',
        note: 'From the old payroll',
      })
      .expect(200);
    const r = (
      await co.hr.api
        .post(`${c}/pf-interest`, { fiscalYear: '2025-26', ratePercent: '8' })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ members: 1, total: '7680.00' });
    expect(
      (
        await co.hr.api
          .post(`${c}/pf-interest`, { fiscalYear: '2025-26', ratePercent: '8' })
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    await co.hr.api
      .post(`${c}/pf-interest`, { fiscalYear: '2026-27', ratePercent: '8' })
      .expect(400); // the year has not ended
    expect(await balance('2170')).toBe('-7680.00');
    expect(await balance('5140')).toBe('7680.00');
    const ledger = (await co.rafi.api.get('/me/pf-ledger').expect(200)).body;
    expect(ledger.totals).toEqual({
      employeePart: '51840.00',
      employerPart: '51840.00',
      balance: '103680.00',
    });
    expect(ledger.entries.map((e: { kind: string }) => e.kind)).toEqual([
      'interest',
    ]);
  });

  it('a withdrawal only from his own part; it counts once the checker posts it', async () => {
    const pay = {
      date: '2026-11-03',
      paidFromAccountId: acct['1130'],
      reason: "Daughter's admission, Dhaka University",
    };
    expect(
      (
        await co.accounts.api
          .post(`/employees/${co.rafi.employeeId}/pf-withdrawals`, {
            ...pay,
            amount: '60000',
          })
          .expect(400)
      ).body.code,
    ).toBe('PF_TOO_MUCH');
    const w = (
      await co.accounts.api
        .post(`/employees/${co.rafi.employeeId}/pf-withdrawals`, {
          ...pay,
          amount: '30000',
        })
        .expect(201)
    ).body;
    expect(
      (
        await co.accounts.api
          .post(`/employees/${co.rafi.employeeId}/pf-withdrawals`, {
            ...pay,
            amount: '1000',
          })
          .expect(409)
      ).body.code,
    ).toBe('PF_PENDING');
    expect(
      (await co.rafi.api.get('/me/pf-ledger').expect(200)).body.totals
        .employeePart,
    ).toBe('51840.00'); // not yet
    await checker
      .post(`/approvals/requests/${w.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (await co.rafi.api.get('/me/pf-ledger').expect(200)).body.totals,
    ).toMatchObject({ employeePart: '21840.00', employerPart: '51840.00' });
  });

  it('on leaving: his own part paid, the employer part not vested (under 3 years) forfeited; the balance is nil', async () => {
    const p = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/pf-settlement`)
        .expect(200)
    ).body;
    expect(p).toMatchObject({
      date: '2026-11-30',
      yearsOfService: 1,
      vestedPercent: '0.00',
      ownPart: '21840.00',
      employerPart: '51840.00',
      vestedEmployerPart: '0.00',
      forfeited: '51840.00',
      payable: '21840.00',
      canSettle: true,
    });
    await co.accounts.api
      .post(`/employees/${co.salesHead.employeeId}/pf-settlement`, {
        date: '2026-11-30',
        paidFromAccountId: acct['1130'],
      })
      .expect(409); // not leaving
    const s = (
      await co.accounts.api
        .post(`/employees/${co.rafi.employeeId}/pf-settlement`, {
          date: '2026-11-03',
          paidFromAccountId: acct['1130'],
        })
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/employees/${co.rafi.employeeId}/pf-settlement`, {
        date: '2026-11-03',
        paidFromAccountId: acct['1130'],
      })
      .expect(409);
    await checker
      .post(`/approvals/requests/${s.approvalRequestId}/approve`, {})
      .expect(200);
    const ledger = (await co.rafi.api.get('/me/pf-ledger').expect(200)).body;
    expect(ledger.totals).toEqual({
      employeePart: '0.00',
      employerPart: '0.00',
      balance: '0.00',
    });
    expect(ledger.entries.map((e: { kind: string }) => e.kind)).toEqual([
      'interest',
      'withdrawal',
      'settlement',
      'forfeit',
    ]);
    expect(await balance('4200')).toBe('-51840.00'); // the forfeited employer part
  });
});

describe('customer import', () => {
  const csv = (lines: string[]) => ({
    content: Buffer.from(lines.join('\r\n') + '\r\n', 'utf8'),
    name: 'customers.csv',
  });
  const upload = (lines: string[]) =>
    co.hr.api.upload(
      `${c}/imports`,
      { entity: 'customers', cutOverDate: '2026-10-01' },
      csv(lines),
    );

  it('the old customers come in with their credit terms; a bad row is shown, and the batch can go back', async () => {
    await co.owner
      .post(`/users/${co.rafi.userId}/roles`, {
        role: 'sales',
        scopeType: 'own',
      })
      .expect(201);
    const header =
      'name,kind,customer_type,name_bn,old_code,bin,tin,phone,email,address,district,account_manager_email,credit_limit,payment_terms_days';
    const badRes = await upload([
      header,
      'Meghna Dealers,company,dealer,,D-0412,0002345670201,,031-2852211,,Khatunganj,Chittagong,' +
        co.rafi.email +
        ',500000,30',
      'Bad Row,company,wholesale,,,,,+1 415 555,,,,,,',
    ]);
    expect(badRes.status, JSON.stringify(badRes.body)).toBe(201);
    const bad = badRes.body;
    expect(bad.counts).toMatchObject({ errors: 1 });
    await co.hr.api
      .post(`/imports/${bad.id}/discard`, { reason: 'Fix the file' })
      .expect(200);

    const batch = (
      await upload([
        header,
        'Meghna Dealers,company,dealer,মেঘনা ডিলার্স,D-0412,0002345670201,,031-2852211,,"Khatunganj, Chattogram",Chittagong,' +
          co.rafi.email +
          ',500000,30',
        'Sylhet Agro Ltd,company,corporate,,C-0077,,,,accounts@sylhetagro.com.bd,"Zindabazar, Sylhet",Sylhet,,300000,45',
      ]).expect(201)
    ).body;
    expect(batch.counts.errors).toBe(0);
    const dry = (
      await co.hr.api.get(`/imports/${batch.id}/dry-run`).expect(200)
    ).body;
    expect(JSON.stringify(dry)).toContain('"customers":2');
    await co.hr.api.post(`/imports/${batch.id}/commit`).expect(200);
    const list = (await co.md.api.get(`${c}/customers`).expect(200))
      .body as Array<{
      name: string;
      bin: string | null;
      district: string | null;
      creditLimit: string;
      paymentTermsDays: number;
      accountManagerId: string | null;
      phone: string | null;
    }>;
    expect(list.find((x) => x.name === 'Meghna Dealers')).toMatchObject({
      bin: '000234567-0201',
      district: 'Chattogram',
      creditLimit: '500000.00',
      paymentTermsDays: 30,
      accountManagerId: co.rafi.userId,
      phone: '+880312852211',
    });
    // the phone is now taken: a lead with it is refused
    expect(
      (
        await co.md.api
          .post(`${c}/leads`, {
            name: 'Jasim',
            phone: '031 285 2211',
            source: 'call',
            ownerId: co.rafi.userId,
          })
          .expect(409)
      ).body.code,
    ).toBe('CRM_DUPLICATE');

    await co.hr.api
      .post(`/imports/${batch.id}/rollback`, {
        reason: 'Imported into the wrong company',
      })
      .expect(200);
    expect(
      (await co.md.api.get(`${c}/customers`).expect(200)).body,
    ).toHaveLength(0);
  });
});

describe('sales take stock out of the store (2026-10-31)', () => {
  it('delivery issues the goods from the store named, never more than is there; a credit note brings returns back', async () => {
    const stockOf = async (store: string, item: string) =>
      (
        (await co.accounts.api.get(`${c}/stock?storeId=${store}`).expect(200))
          .body as Array<{ itemId: string; quantity: string }>
      ).find((b) => b.itemId === item)?.quantity ?? '0';
    await co.owner
      .post(`/users/${co.rafi.userId}/roles`, {
        role: 'sales',
        scopeType: 'own',
      })
      .expect((r) => expect([201, 409]).toContain(r.status));
    const items = (
      await co.accounts.api
        .post(`${c}/vat-items/defaults`, { fiscalYear: '2026-27' })
        .expect(201)
    ).body as Array<{ id: string; code: string }>;
    const store = (
      await co.accounts.api
        .post(`${c}/stores`, {
          code: 'CTG-DEPOT',
          name: 'Chattogram depot, Sagarika Road',
        })
        .expect(201)
    ).body.id;
    const can = (
      await co.accounts.api
        .post(`${c}/stock-items`, {
          code: 'RBO-5L',
          name: 'Rice bran oil 5 L can',
          unit: 'can',
        })
        .expect(201)
    ).body.id;
    const bottle = (
      await co.accounts.api
        .post(`${c}/stock-items`, {
          code: 'SOY-1L',
          name: 'Soybean oil 1 L',
          unit: 'bottle',
        })
        .expect(201)
    ).body.id;
    const vatItemId = items.find((i) => i.code === 'GOODS-STD')!.id;
    // the unit must match the stock item's
    expect(
      (
        await co.accounts.api
          .post(`${c}/products`, {
            code: 'RBO-5L',
            name: 'Rice bran oil 5 L can',
            unit: 'carton',
            vatItemId,
            stockItemId: can,
          })
          .expect(400)
      ).body.code,
    ).toBe('VALIDATION_FAILED');
    const product = (
      await co.accounts.api
        .post(`${c}/products`, {
          code: 'RBO-5L',
          name: 'Rice bran oil 5 L can',
          unit: 'can',
          vatItemId,
          stockItemId: can,
        })
        .expect(201)
    ).body;
    expect(product.stockItemId).toBe(can);
    await co.accounts.api
      .post(`/stores/${store}/moves`, {
        kind: 'receipt',
        moveDate: '2026-11-01',
        reference: 'From the Bhatiary mill',
        lines: [
          { itemId: can, quantity: '150' },
          { itemId: bottle, quantity: '10' },
        ],
      })
      .expect(201);

    const cust = (
      await co.rafi.api
        .post(`${c}/customers`, {
          kind: 'company',
          name: 'Agrabad Super Shop',
          customerType: 'retail',
          phone: '01819-112233',
          district: 'Chattogram',
        })
        .expect(201)
    ).body;
    await co.accounts.api
      .put(`/customers/${cust.id}/credit`, {
        version: cust.version,
        creditLimit: '1000000',
        paymentTermsDays: 15,
      })
      .expect(200);
    let q = (
      await co.rafi.api
        .post(`${c}/quotations`, {
          customerId: cust.id,
          validUntil: '2026-11-30',
          lines: [
            { productId: product.id, quantity: '200', unitPrice: '1850' },
          ],
        })
        .expect(201)
    ).body;
    for (const s of ['submit', 'send', 'accept'])
      q = (
        await co.rafi.api
          .post(`/quotations/${q.id}/${s}`, { version: q.version })
          .expect(200)
      ).body;
    let o = (await co.rafi.api.get(`/sales-orders/${q.order.id}`).expect(200))
      .body;
    expect(o.needsStore).toBe(true);

    expect(
      (
        await co.rafi.api
          .post(`/sales-orders/${o.id}/deliver`, {
            version: o.version,
            challanNo: 'DC-CTG-0091',
          })
          .expect(400)
      ).body.code,
    ).toBe('SALES_STORE_NEEDED');
    const short = (
      await co.rafi.api
        .post(`/sales-orders/${o.id}/deliver`, {
          version: o.version,
          challanNo: 'DC-CTG-0091',
          storeId: store,
        })
        .expect(409)
    ).body;
    expect(short).toMatchObject({
      code: 'STOCK_NOT_ENOUGH',
      details: { product: 'RBO-5L', inStock: '150', asked: '200' },
    });
    expect(await stockOf(store, can)).toBe('150'); // nothing moved

    await co.accounts.api
      .post(`/stores/${store}/moves`, {
        kind: 'receipt',
        moveDate: '2026-11-02',
        reference: 'From the Bhatiary mill',
        lines: [{ itemId: can, quantity: '100' }],
      })
      .expect(201);
    o = (
      await co.rafi.api
        .post(`/sales-orders/${o.id}/deliver`, {
          version: o.version,
          challanNo: 'DC-CTG-0091',
          storeId: store,
        })
        .expect(200)
    ).body;
    expect(o).toMatchObject({ state: 'delivered', store: { id: store } });
    expect(await stockOf(store, can)).toBe('50');
    expect(await stockOf(store, bottle)).toBe('10'); // not on this order
    const moves = (
      await co.accounts.api
        .get(`/stores/${store}/moves?itemId=${can}`)
        .expect(200)
    ).body as Array<{ kind: string; quantity: string; reference: string }>;
    expect(moves.find((m) => m.kind === 'sales_issue')).toMatchObject({
      quantity: '-200.000',
      reference: expect.stringContaining('DC-CTG-0091'),
    });

    const inv = (
      await co.accounts.api
        .post(`/sales-orders/${o.id}/invoice`, {})
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/sales-invoices/${inv.id}/credit-notes`, {
        reason: '12 cans leaking, taken back',
        returnToStock: true,
        lines: [{ invoiceLineId: inv.lines[0].id, quantity: '12' }],
      })
      .expect(201);
    expect(await stockOf(store, can)).toBe('62');
    // a credit note without returned goods leaves the store alone
    await co.accounts.api
      .post(`/sales-invoices/${inv.id}/credit-notes`, {
        reason: 'Price difference on 5 cans',
        lines: [{ invoiceLineId: inv.lines[0].id, quantity: '5' }],
      })
      .expect(201);
    expect(await stockOf(store, can)).toBe('62');

    // the database: a sales issue must name its order
    await expect(
      asTenant(() =>
        db.tx
          .insertInto('stock_moves')
          .values({
            store_id: store,
            item_id: can,
            move_date: '2026-11-03',
            kind: 'sales_issue',
            quantity: '-1',
          })
          .execute(),
      ),
    ).rejects.toThrow();
  });
});
