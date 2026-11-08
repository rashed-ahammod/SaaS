/**
 * WP19 assets and stock through the API (Meghna Foods test company).
 * Acceptance (docs/phase-2-plan.md): "Depreciation schedule reproducible; stock never
 * negative; asset return blocks final settlement".
 *
 * Assets: an HP laptop for Sales Dhaka (Tk 98,000, 3 years straight line, in service
 * 15 July 2026) and a Toyota Hiace brought from the old books (Tk 25 lakh, 20 %
 * reducing balance, Tk 5 lakh already depreciated by 30 June 2026). Stock: A4 paper
 * in the Head Office store; Rafi asks for 5 reams.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { LifecycleService } from '../../src/modules/employees/lifecycle.service.js';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { ManualClock } from '../../src/platform/clock.js';
import { Money } from '../../src/platform/money/money.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
const clock = new ManualClock(new Date('2026-10-20T10:00:00+06:00'));
let app: INestApplication;
let co: BdCompany;
let c: string;
let checker: Api;
const acct: Record<string, string> = {};
const cls: Record<string, string> = {};
let laptop: string;
let van: string;
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const scheduled = async (assetId: string, period: string) => {
  const rows = (
    await co.accounts.api.get(`/assets/${assetId}/schedule`).expect(200)
  ).body.rows as Array<{ period: string; accumulated: string }>;
  return rows.filter((r) => r.period <= period).at(-1)?.accumulated ?? '0.00';
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
    .post(`${c}/ledger/setup`, { asOf: '2026-07-01' })
    .expect(200);
  for (const a of (await co.accounts.api.get(`${c}/accounts`).expect(200)).body)
    acct[a.code] = a.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('the register', () => {
  it('the Admin sets up the classes and registers assets; Accounts and HR only look', async () => {
    await co.accounts.api.post(`${c}/asset-classes/defaults`).expect(403);
    const classes = (
      await co.md.api.post(`${c}/asset-classes/defaults`).expect(201)
    ).body;
    for (const k of classes) cls[k.code] = k.id;
    expect(classes.map((k: { code: string }) => k.code).sort()).toEqual([
      'FURN',
      'IT',
      'OFFEQ',
      'VEH',
    ]);
    await co.hr.api.get(`${c}/asset-classes`).expect(200);

    const body = {
      classId: cls.IT,
      name: 'HP ProBook 450 G10',
      serialNo: '5CD3281XYZ',
      inServiceDate: '2026-07-15',
      cost: '98000',
      departmentId: co.departments.salesDhaka,
      location: 'Gulshan HQ, 3rd floor',
    };
    await co.accounts.api.post(`${c}/assets`, body).expect(403);
    const a = (await co.md.api.post(`${c}/assets`, body).expect(201)).body;
    laptop = a.id;
    expect(a).toMatchObject({
      tag: 'AST-00001',
      state: 'in_store',
      bookValue: '98000.00',
      class: { method: 'straight_line', usefulLifeMonths: 36 },
    });

    const v = (
      await co.md.api
        .post(`${c}/assets`, {
          classId: cls.VEH,
          name: 'Toyota Hiace (Dhaka Metro-Cha 15-2247)',
          inServiceDate: '2024-07-01',
          cost: '2500000',
          residualValue: '300000',
          openingAccumulated: '500000',
          openingAsOf: '2026-06-30',
          departmentId: co.departments.ho,
        })
        .expect(201)
    ).body;
    van = v.id;
    expect(v).toMatchObject({
      tag: 'AST-00002',
      accumulated: '500000.00',
      bookValue: '2000000.00',
    });
  });
});

describe('depreciation', () => {
  it("a run posts each asset's scheduled amount less what is posted (missing months caught up)", async () => {
    await co.md.api
      .post(`${c}/depreciation-runs`, { period: '2026-09' })
      .expect(403);
    const preview = (
      await co.accounts.api
        .get(`${c}/depreciation-runs/preview?period=2026-09`)
        .expect(200)
    ).body;
    const run = (
      await co.accounts.api
        .post(`${c}/depreciation-runs`, { period: '2026-09' })
        .expect(201)
    ).body;
    expect(run.lines.map((l: { amount: string }) => l.amount)).toEqual(
      preview.map((p: { charge: string }) => p.charge),
    );

    // reproducible: July-September of the laptop, and three months of the van after its opening
    const laptopLine = run.lines.find(
      (l: { assetId: string }) => l.assetId === laptop,
    );
    expect(laptopLine).toMatchObject({
      amount: await scheduled(laptop, '2026-09'),
      accumulatedAfter: '8166.67',
    });
    const vanLine = run.lines.find(
      (l: { assetId: string }) => l.assetId === van,
    );
    expect(vanLine.amount).toBe(
      Money.of(await scheduled(van, '2026-09'))
        .minus('500000')
        .toDb(),
    );
    expect(vanLine.amount).toBe('98342.59'); // 33,333.33 + 32,777.78 + 32,231.48

    // one journal: Dr depreciation by cost centre, Cr accumulated depreciation
    const voucher = (
      await co.accounts.api.get(`/vouchers/${run.voucherId}`).expect(200)
    ).body;
    expect(voucher).toMatchObject({
      state: 'posted',
      voucherDate: '2026-09-30',
      total: run.total,
    });
    const debit = voucher.lines.find(
      (l: { accountId: string; departmentId: string | null }) =>
        l.accountId === acct['5280'] &&
        l.departmentId === co.departments.salesDhaka,
    );
    expect(debit.debit).toBe('8166.67');
  });

  it('month by month: no month twice, none before the last, none in the future', async () => {
    for (const period of ['2026-09', '2026-08', '2026-12']) {
      expect(
        (
          await co.accounts.api
            .post(`${c}/depreciation-runs`, { period })
            .expect(400)
        ).body.code,
      ).toBe('DEPRECIATION_PERIOD_INVALID');
    }
    const october = (
      await co.accounts.api
        .post(`${c}/depreciation-runs`, { period: '2026-10' })
        .expect(201)
    ).body;
    expect(
      october.lines.find((l: { assetId: string }) => l.assetId === laptop)
        .amount,
    ).toBe('2722.22');
  });

  it('only the latest run is reversed (through the checker); then the month runs again, the same', async () => {
    const runs = (
      await co.accounts.api.get(`${c}/depreciation-runs`).expect(200)
    ).body;
    const [october, september] = runs;
    expect(
      (
        await co.accounts.api
          .post(`/depreciation-runs/${september.id}/reverse`, { reason: 'x' })
          .expect(409)
      ).body.code,
    ).toBe('DEPRECIATION_NOT_LATEST');
    await co.accounts.api
      .post(`/depreciation-runs/${october.id}/reverse`, {
        reason: 'Run before the October laptop transfer',
      })
      .expect(200);
    const reversal = (
      await co.accounts.api.get(`${c}/vouchers?state=in_approval`).expect(200)
    ).body.find(
      (v: { reversalOf: string | null }) => v.reversalOf === october.voucherId,
    );
    await checker
      .post(`/approvals/requests/${reversal.approvalRequestId}/approve`, {})
      .expect(200);
    expect(
      (
        await co.accounts.api
          .get(`/depreciation-runs/${october.id}`)
          .expect(200)
      ).body.state,
    ).toBe('reversed');
    const again = (
      await co.accounts.api
        .post(`${c}/depreciation-runs`, { period: '2026-10' })
        .expect(201)
    ).body;
    expect(again.total).toBe(october.total);
  });
});

describe('assignment', () => {
  it('Rafi receives the laptop and acknowledges it in the app', async () => {
    await co.md.api
      .post(`/assets/${laptop}/assign`, {
        employeeId: co.rafi.employeeId,
        assignedOn: '2026-10-20',
        note: 'For dealer visits',
      })
      .expect(200);
    expect(
      (
        await co.md.api
          .post(`/assets/${laptop}/assign`, {
            employeeId: co.salesHead.employeeId,
            assignedOn: '2026-10-20',
          })
          .expect(409)
      ).body.code,
    ).toBe('ASSET_ASSIGNED');
    const mine = (await co.rafi.api.get('/me/assets').expect(200)).body;
    expect(mine).toEqual([
      expect.objectContaining({
        tag: 'AST-00001',
        acknowledgedAt: null,
        returnedOn: null,
      }),
    ]);
    await co.salesHead.api
      .post(`/me/assets/${mine[0].assignmentId}/acknowledge`)
      .expect(404); // not his
    const acked = (
      await co.rafi.api
        .post(`/me/assets/${mine[0].assignmentId}/acknowledge`)
        .expect(200)
    ).body;
    expect(acked[0].acknowledgedAt).not.toBeNull();
    expect(
      (
        await co.md.api
          .get(`${c}/assets?employeeId=${co.rafi.employeeId}`)
          .expect(200)
      ).body[0].holder,
    ).toMatchObject({ acknowledged: true });
    // the Dept Head sees his department's assets; an employee cannot list the register
    expect(
      (await co.salesHead.api.get(`${c}/assets`).expect(200)).body.map(
        (a: { tag: string }) => a.tag,
      ),
    ).toEqual(['AST-00001']);
    await co.rafi.api.get(`${c}/assets`).expect(403);
  });

  it('an asset not returned blocks the clearance and the final settlement', async () => {
    await co.hr.api
      .post(`/employees/${co.rafi.employeeId}/notice`, {
        kind: 'resignation',
        noticeDate: '2026-10-20',
        lastWorkingDay: '2026-11-30',
        reason: 'Moving to Sylhet',
      })
      .expect(200);
    const separation = (
      await co.hr.api
        .get(`/employees/${co.rafi.employeeId}/separation`)
        .expect(200)
    ).body;
    expect(separation.owed.assets).toEqual([
      expect.objectContaining({ tag: 'AST-00001' }),
    ]);
    expect(
      (
        await co.md.api
          .post(`/separations/${separation.id}/clearances/admin_assets`, {})
          .expect(409)
      ).body.code,
    ).toBe('ASSETS_NOT_RETURNED');
    const lifecycle = app.get(LifecycleService, { strict: false });
    await expect(
      asTenant(() => lifecycle.settlementCheck(co.rafi.employeeId)),
    ).rejects.toMatchObject({ response: { message: 'ASSETS_NOT_RETURNED' } });

    // returned: the clearance can be given; the settlement now waits only for the other clearances
    await co.md.api
      .post(`/assets/${laptop}/return`, {
        returnedOn: '2026-11-30',
        condition: 'good',
        note: 'Charger and bag returned',
      })
      .expect(200);
    await co.md.api
      .post(`/separations/${separation.id}/clearances/admin_assets`, {
        note: 'Laptop AST-00001 returned',
      })
      .expect(200);
    await expect(
      asTenant(() => lifecycle.settlementCheck(co.rafi.employeeId)),
    ).rejects.toMatchObject({
      response: { message: 'SEPARATION_NOT_CLEARED' },
    });
    await co.hr.api
      .post(`/separations/${separation.id}/withdraw`, {
        reason: 'Stays in Dhaka after all',
      })
      .expect(200);
  });
});

describe('maintenance and disposal', () => {
  it('a service is logged', async () => {
    const a = (
      await co.md.api
        .post(`/assets/${van}/maintenance`, {
          doneOn: '2026-10-18',
          kind: 'service',
          description:
            'Engine oil, filters, brake pads (Navana Toyota, Tejgaon)',
          cost: '18500',
          nextDue: '2027-01-18',
        })
        .expect(201)
    ).body;
    expect(a.maintenance[0]).toMatchObject({
      kind: 'service',
      cost: '18500.00',
      nextDue: '2027-01-18',
    });
  });

  it('the van is sold: depreciation to the month before, then cost out and the gain or loss', async () => {
    // October is depreciated: a disposal in October would overlap it
    await co.md.api
      .post(`/assets/${van}/dispose`, {
        disposedOn: '2026-10-25',
        method: 'sale',
        proceeds: '1800000',
        receivedIntoAccountId: acct['1110'],
        note: 'x',
      })
      .expect(400);
    clock.set(new Date('2026-11-06T10:00:00+06:00'));
    const bookValue = Money.of('2500000').minus(
      await scheduled(van, '2026-10'),
    );
    const sold = (
      await co.md.api
        .post(`/assets/${van}/dispose`, {
          disposedOn: '2026-11-05',
          method: 'sale',
          proceeds: '1800000',
          receivedIntoAccountId: acct['1110'],
          note: 'Sold to Rahim Transport, Tejgaon',
        })
        .expect(200)
    ).body;
    expect(sold).toMatchObject({
      state: 'disposed',
      bookValue: '0.00',
      disposalProceeds: '1800000.00',
    });
    const journal = (
      await co.accounts.api
        .get(`/vouchers/${sold.disposalVoucherId}`)
        .expect(200)
    ).body;
    const loss = Money.of('1800000').minus(bookValue);
    expect(loss.isNegative()).toBe(true); // 18 lakh for a van with a higher book value
    const line = (code: string, side: 'debit' | 'credit') =>
      journal.lines.find(
        (l: { accountId: string; debit: string; credit: string }) =>
          l.accountId === acct[code] && l[side] !== '0.00',
      )?.[side];
    expect(line('5285', 'debit')).toBe(loss.negate().toDb());
    expect(line('1240', 'credit')).toBe('2500000.00');
    expect(line('1110', 'debit')).toBe('1800000.00');
    expect(journal).toMatchObject({
      state: 'posted',
      voucherDate: '2026-11-05',
    });
    // the next run leaves the disposed van out
    const november = (
      await co.accounts.api
        .get(`${c}/depreciation-runs/preview?period=2026-11`)
        .expect(200)
    ).body;
    expect(november.map((l: { assetId: string }) => l.assetId)).not.toContain(
      van,
    );
  });
});

describe('stock', () => {
  let store: string;
  let paper: string;

  it('the store receives; the balance follows the ledger', async () => {
    store = (
      await co.accounts.api
        .post(`${c}/stores`, {
          code: 'HO',
          name: 'Head office store',
          keeperEmployeeId: co.accounts.employeeId,
        })
        .expect(201)
    ).body.id;
    paper = (
      await co.accounts.api
        .post(`${c}/stock-items`, {
          code: 'a4-80',
          name: 'A4 paper, 80 gsm',
          nameBn: 'এ৪ কাগজ, ৮০ জিএসএম',
          unit: 'ream',
          reorderLevel: '20',
        })
        .expect(201)
    ).body.id;
    await co.rafi.api
      .post(`${c}/stock-items`, { code: 'X', name: 'x', unit: 'pcs' })
      .expect(403);
    const after = (
      await co.accounts.api
        .post(`/stores/${store}/moves`, {
          kind: 'receipt',
          moveDate: '2026-11-02',
          reference: 'Karim Traders KT/2026/1311',
          lines: [{ itemId: paper, quantity: '50' }],
        })
        .expect(201)
    ).body;
    expect(
      after.find((b: { itemId: string }) => b.itemId === paper),
    ).toMatchObject({ quantity: '50', belowReorder: false });
  });

  it('Rafi asks; his Dept Head approves; the store issues in parts, never more than asked', async () => {
    const asked = (
      await co.rafi.api
        .post(`${c}/stock-requests`, {
          storeId: store,
          note: 'Dealer price lists',
          lines: [{ itemId: paper, quantity: '5' }],
        })
        .expect(201)
    ).body;
    expect(asked).toMatchObject({
      number: expect.stringMatching(/^SIR\/2026-27\/\d{5}$/),
      state: 'in_approval',
    });
    await co.accounts.api
      .post(`/stock-requests/${asked.id}/issue`, {
        issueDate: '2026-11-03',
        lines: [{ itemId: paper, quantity: '5' }],
      })
      .expect(409); // not approved yet
    await co.salesHead.api
      .post(`/approvals/requests/${asked.approvalRequestId}/approve`, {})
      .expect(200);
    const part = (
      await co.accounts.api
        .post(`/stock-requests/${asked.id}/issue`, {
          issueDate: '2026-11-03',
          lines: [{ itemId: paper, quantity: '3' }],
        })
        .expect(200)
    ).body;
    expect(part).toMatchObject({
      state: 'partially_issued',
      lines: [{ quantityIssued: '3', inStock: '47' }],
    });
    await co.accounts.api
      .post(`/stock-requests/${asked.id}/issue`, {
        issueDate: '2026-11-04',
        lines: [{ itemId: paper, quantity: '3' }],
      })
      .expect(400);
    const done = (
      await co.accounts.api
        .post(`/stock-requests/${asked.id}/issue`, {
          issueDate: '2026-11-04',
          lines: [{ itemId: paper, quantity: '2' }],
        })
        .expect(200)
    ).body;
    expect(done).toMatchObject({
      state: 'issued',
      lines: [{ quantityIssued: '5', inStock: '45' }],
    });
    expect(
      (await co.rafi.api.get('/me/stock-requests').expect(200)).body[0],
    ).toMatchObject({ state: 'issued' });
  });

  it('stock never goes below zero: refused by the service and by the database', async () => {
    const out = await co.accounts.api
      .post(`/stores/${store}/moves`, {
        kind: 'adjustment',
        moveDate: '2026-11-05',
        note: 'Stock count',
        lines: [{ itemId: paper, quantity: '-46' }],
      })
      .expect(409);
    expect(out.body).toMatchObject({
      code: 'STOCK_NOT_ENOUGH',
      details: { inStock: '45' },
    });
    await expect(
      asTenant(() =>
        sql`INSERT INTO stock_moves (store_id, item_id, move_date, kind, quantity, note) VALUES (${store}, ${paper}, '2026-11-05', 'adjustment', -46, 'direct')`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow(/below zero/);
    await expect(
      asTenant(() =>
        sql`UPDATE stock_moves SET quantity = 1 WHERE store_id = ${store}`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow();

    // a count finds 30 damaged reams: below the reorder level now
    await co.accounts.api
      .post(`/stores/${store}/moves`, {
        kind: 'adjustment',
        moveDate: '2026-11-05',
        note: 'Water damage in the store room',
        lines: [{ itemId: paper, quantity: '-30' }],
      })
      .expect(201);
    const low = (
      await co.accounts.api.get(`${c}/stock?belowReorder=true`).expect(200)
    ).body;
    expect(low).toEqual([
      expect.objectContaining({
        itemCode: 'A4-80',
        quantity: '15',
        belowReorder: true,
      }),
    ]);
    const ledger = (
      await co.accounts.api
        .get(`/stores/${store}/moves?itemId=${paper}`)
        .expect(200)
    ).body;
    expect(
      ledger.map(
        (m: { kind: string; quantity: string }) =>
          `${m.kind}:${Number(m.quantity)}`,
      ),
    ).toEqual(['adjustment:-30', 'issue:-2', 'issue:-3', 'receipt:50']);
  });
});
