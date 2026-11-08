/**
 * WP18 budgets through the API (Meghna Foods test company).
 * Acceptance (docs/phase-2-plan.md): "Commitments and actuals equal the source
 * documents; thresholds route approvals".
 *
 * Sales Dhaka's 2026-27 budget: furniture (1210) Tk 1,00,000 and printing and stationery
 * (5240) Tk 20,000. A stationery bill makes Tk 18,000 actual (90 %: a warning). A
 * furniture order of Tk 73,400 is committed; a second order would take furniture over
 * the budget, so the requisition and the order both need the Admin. Then the bill for
 * the first order turns part of the commitment into actual; the Dept Head asks for a
 * bigger furniture budget and the Admin approves it.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import { BudgetsService } from '../../src/modules/budgets/budgets.service.js';
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
let budgetId: string;
let firstOrder: { id: string; lines: Array<{ id: string }> };
const asTenant = <T>(work: () => Promise<T>) =>
  db.withTenant(
    { tenantId: co.tenant.id, access: AccessGrants.system() },
    work,
  );
const approve = (requestId: string, who: Api) =>
  who.post(`/approvals/requests/${requestId}/approve`, {}).expect(200);
const budget = async () =>
  (await co.accounts.api.get(`/budgets/${budgetId}`).expect(200)).body;
const line = (b: { lines: Array<{ accountId: string }> }, code: string) =>
  b.lines.find((l) => l.accountId === acct[code]) as Record<string, string>;

/** A requisition by Rafi, approved by everyone the chain asks, then one quotation and an order on 1210. */
async function orderFurniture(title: string, unitPrice: string, qty: string) {
  const pr = (
    await co.rafi.api
      .post(`${c}/purchase-requisitions`, {
        title,
        justification: 'Sales Dhaka',
        lines: [
          {
            description: title,
            quantity: qty,
            unit: 'pcs',
            estimatedUnitPrice: unitPrice,
          },
        ],
      })
      .expect(201)
  ).body;
  const sent = (
    await co.rafi.api.post(`/purchase-requisitions/${pr.id}/submit`).expect(200)
  ).body;
  return { pr, sent };
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
  // one quotation is enough up to Tk 2 lakh in this company
  await co.accounts.api
    .put(`${c}/procurement-settings`, { quotationThreshold: '200000' })
    .expect(200);
  vendor.partex = (
    await co.accounts.api
      .post(`${c}/vendors`, {
        name: 'Partex Furniture Industries Ltd',
        tin: '434567890123',
        bin: '000434567-0101',
        withholdingCategory: 'SUPPLY',
      })
      .expect(201)
  ).body.id;
  vendor.karim = (
    await co.accounts.api
      .post(`${c}/vendors`, {
        name: 'Karim Traders, Nawabpur Road',
        tin: '345678901234',
        bin: '000345678-0103',
        withholdingCategory: 'SUPPLY',
      })
      .expect(201)
  ).body.id;
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('the budget', () => {
  it('Accounts prepares it; the Admin approves; then it changes only through a revision', async () => {
    const body = {
      fiscalYear: '2026-27',
      departmentId: co.departments.salesDhaka,
      note: 'Board meeting, 28 September',
      lines: [
        { accountId: acct['1210'], amount: '100000' },
        { accountId: acct['5240'], amount: '20000' },
      ],
    };
    await co.salesHead.api.post(`${c}/budgets`, body).expect(403);
    await co.accounts.api
      .post(`${c}/budgets`, {
        ...body,
        lines: [{ accountId: acct['1110'], amount: '5000' }],
      })
      .expect(400); // cash is not a budget line
    await co.accounts.api
      .post(`${c}/budgets`, { ...body, fiscalYear: '2026-28' })
      .expect(400);
    const draft = (await co.accounts.api.post(`${c}/budgets`, body).expect(201))
      .body;
    budgetId = draft.id;
    expect(draft).toMatchObject({
      state: 'draft',
      total: '120000.00',
      fiscalYearFrom: '2026-07-01',
      fiscalYearTo: '2027-06-30',
    });
    expect(
      (await co.accounts.api.post(`${c}/budgets`, body).expect(409)).body.code,
    ).toBe('BUDGET_EXISTS');

    const sent = (
      await co.accounts.api.post(`/budgets/${budgetId}/submit`).expect(200)
    ).body;
    await approve(sent.approvalRequestId, co.md.api);
    const approved = await budget();
    expect(approved).toMatchObject({
      state: 'approved',
      position: { budget: '120000.00', used: '0.00', status: 'within' },
    });
    await co.accounts.api
      .patch(`/budgets/${budgetId}`, { version: approved.version, note: 'x' })
      .expect(409);
    await expect(
      asTenant(() =>
        sql`UPDATE budget_lines SET amount = 1 WHERE budget_id = ${budgetId}`.execute(
          db.tx,
        ),
      ),
    ).rejects.toThrow(/approved revision/);

    // the Dept Head sees his department's budget; an employee does not
    await co.salesHead.api.get(`/budgets/${budgetId}`).expect(200);
    await co.rafi.api.get(`/budgets/${budgetId}`).expect(403);
  });

  it('a posted bill is actual (90 % of stationery: a warning) and the alert is raised once', async () => {
    const draft = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.karim,
          billNo: 'KT/2026/1301',
          billDate: '2026-10-03',
          narration: 'Paper, toner and files for Sales Dhaka',
          lines: [
            {
              accountId: acct['5240'],
              departmentId: co.departments.salesDhaka,
              description: 'Stationery',
              amount: '18000',
              vatPercent: '15',
            },
          ],
        })
        .expect(201)
    ).body;
    const sent = (
      await co.accounts.api.post(`/vendor-bills/${draft.id}/submit`).expect(200)
    ).body;
    await approve(sent.approvalRequestId, checker);

    expect(line(await budget(), '5240')).toMatchObject({
      budget: '20000.00',
      actual: '18000.00',
      committed: '0.00',
      percent: '90.00',
      status: 'warning',
    });
    const budgets = app.get(BudgetsService, { strict: false });
    expect(await asTenant(() => budgets.raiseAlerts())).toBe(1); // stationery at 80 %; the total is at 15 %
    expect(await asTenant(() => budgets.raiseAlerts())).toBe(0);
    const event = await asTenant(() =>
      db.tx
        .selectFrom('outbox_events')
        .select(['type', 'payload'])
        .where('type', '=', 'budget.threshold_reached')
        .executeTakeFirstOrThrow(),
    );
    expect(event.payload).toMatchObject({
      budgetId,
      accountId: acct['5240'],
      level: 80,
      percent: '90.00',
    });
  });
});

describe('commitments and routing', () => {
  it('an order within the budget is issued at once and committed', async () => {
    const { pr, sent } = await orderFurniture(
      'Office chairs and meeting tables',
      '9175',
      '8',
    );
    const request = (
      await co.salesHead.api
        .get(`/approvals/requests/${sent.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(request.steps).toHaveLength(2); // within the budget: no Admin
    await approve(sent.approvalRequestId, co.salesHead.api);
    await approve(sent.approvalRequestId, co.accounts.api);
    const withQuote = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/quotations`, {
          vendorId: vendor.partex,
          reference: 'PFIL/Q/1042',
          quotationDate: '2026-10-06',
          lines: [
            {
              requisitionLineId: pr.lines[0].id,
              unitPrice: '9175',
              vatPercent: '15',
            },
          ],
        })
        .expect(201)
    ).body;
    const order = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/purchase-orders`, {
          quotationId: withQuote.quotations[0].id,
          orderDate: '2026-10-08',
          lines: [
            { requisitionLineId: pr.lines[0].id, accountId: acct['1210'] },
          ],
        })
        .expect(201)
    ).body;
    firstOrder = (
      await co.accounts.api
        .post(`/purchase-orders/${order.id}/issue`)
        .expect(200)
    ).body;
    expect(firstOrder).toMatchObject({
      state: 'issued',
      budget: { status: 'within' },
    });
    expect(line(await budget(), '1210')).toMatchObject({
      actual: '0.00',
      committed: '73400.00',
      percent: '73.40',
      status: 'within',
    });
  });

  it('over the department budget: the requisition needs the Admin, and so does the order', async () => {
    // department: 18,000 actual + 73,400 committed + 50,000 = 1,41,400 > 1,20,000
    const { pr, sent } = await orderFurniture(
      'Two more desks for the new officers',
      '25000',
      '2',
    );
    const request = (
      await co.salesHead.api
        .get(`/approvals/requests/${sent.approvalRequestId}`)
        .expect(200)
    ).body;
    expect(request.steps).toHaveLength(3);
    expect(request.snapshot.budget).toMatch(/over$/);
    await approve(sent.approvalRequestId, co.salesHead.api);
    await approve(sent.approvalRequestId, co.accounts.api);
    expect(
      (await co.rafi.api.get(`/purchase-requisitions/${pr.id}`).expect(200))
        .body,
    ).toMatchObject({ state: 'in_approval', budget: { status: 'over' } });
    await approve(sent.approvalRequestId, co.md.api);

    const withQuote = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/quotations`, {
          vendorId: vendor.partex,
          reference: 'PFIL/Q/1077',
          quotationDate: '2026-10-07',
          lines: [{ requisitionLineId: pr.lines[0].id, unitPrice: '25000' }],
        })
        .expect(201)
    ).body;
    const order = (
      await co.accounts.api
        .post(`/purchase-requisitions/${pr.id}/purchase-orders`, {
          quotationId: withQuote.quotations[0].id,
          orderDate: '2026-10-09',
          lines: [
            { requisitionLineId: pr.lines[0].id, accountId: acct['1210'] },
          ],
        })
        .expect(201)
    ).body;
    // furniture: 73,400 + 50,000 > 1,00,000 -> the Admin first; nothing is committed meanwhile
    const waiting = (
      await co.accounts.api
        .post(`/purchase-orders/${order.id}/issue`)
        .expect(200)
    ).body;
    expect(waiting).toMatchObject({
      state: 'in_approval',
      budget: { status: 'over', needsAdmin: true },
    });
    expect(line(await budget(), '1210').committed).toBe('73400.00');
    await approve(waiting.approvalRequestId, co.md.api);
    expect(
      (await co.accounts.api.get(`/purchase-orders/${order.id}`).expect(200))
        .body.state,
    ).toBe('issued');
    expect(line(await budget(), '1210')).toMatchObject({
      committed: '123400.00',
      status: 'over',
      available: '-23400.00',
    });
  });

  it('a bill turns its part of the commitment into actual: the sum stays the source documents', async () => {
    await co.accounts.api
      .post(`/purchase-orders/${firstOrder.id}/receipts`, {
        receivedDate: '2026-10-12',
        lines: [{ poLineId: firstOrder.lines[0].id, quantity: '4' }],
      })
      .expect(201);
    const bill = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.partex,
          billNo: 'PFIL/INV/7781',
          billDate: '2026-10-13',
          narration: 'Chairs',
          purchaseOrderId: firstOrder.id,
          lines: [
            {
              accountId: acct['1210'],
              departmentId: co.departments.salesDhaka,
              description: 'Office chairs',
              amount: '36700',
              vatPercent: '15',
              poLineId: firstOrder.lines[0].id,
              quantity: '4',
            },
          ],
        })
        .expect(201)
    ).body;
    const sent = (
      await co.accounts.api.post(`/vendor-bills/${bill.id}/submit`).expect(200)
    ).body;
    await approve(sent.approvalRequestId, checker);
    // actual 36,700 from the voucher; committed 1,23,400 - 36,700 = 86,700
    expect(line(await budget(), '1210')).toMatchObject({
      actual: '36700.00',
      committed: '86700.00',
      used: '123400.00',
    });
    const vouchers = await asTenant(() =>
      db.tx
        .selectFrom('voucher_lines as l')
        .innerJoin('vouchers as v', 'v.id', 'l.voucher_id')
        .select(sql<string>`sum(l.debit) - sum(l.credit)`.as('amount'))
        .where('l.account_id', '=', acct['1210'])
        .where('l.department_id', '=', co.departments.salesDhaka)
        .where('v.state', '=', 'posted')
        .executeTakeFirstOrThrow(),
    );
    expect(vouchers.amount).toBe('36700.00');

    const budgets = app.get(BudgetsService, { strict: false });
    await asTenant(() => budgets.raiseAlerts());
    const levels = await asTenant(() =>
      db.tx
        .selectFrom('budget_alerts')
        .select(['account_id', 'level'])
        .where('budget_id', '=', budgetId)
        .execute(),
    );
    expect(
      levels
        .filter((l) => l.account_id === acct['1210'])
        .map((l) => l.level)
        .sort(),
    ).toEqual([100, 80]);
  });

  it('a department without a budget needs the Admin once the company uses budgets', async () => {
    const pr = (
      await co.hr.api
        .post(`${c}/purchase-requisitions`, {
          title: 'Filing cabinet for HR',
          justification: 'Personnel files',
          lines: [
            {
              description: 'Steel filing cabinet',
              quantity: '1',
              unit: 'pcs',
              estimatedUnitPrice: '14500',
            },
          ],
        })
        .expect(201)
    ).body;
    await co.hr.api.post(`/purchase-requisitions/${pr.id}/submit`).expect(200);
    expect(
      (await co.hr.api.get(`/purchase-requisitions/${pr.id}`).expect(200)).body
        .budget,
    ).toMatchObject({ status: 'no_budget' });
  });
});

describe('revisions and the report', () => {
  it('the Dept Head asks for more; the Admin approves; one open change at a time', async () => {
    await co.rafi.api
      .post(`/budgets/${budgetId}/revisions`, {
        reason: 'x',
        lines: [{ accountId: acct['1210'], amount: '150000' }],
      })
      .expect(403);
    const asked = (
      await co.salesHead.api
        .post(`/budgets/${budgetId}/revisions`, {
          reason: 'Two more sales officers approved in October',
          lines: [{ accountId: acct['1210'], amount: '150000' }],
        })
        .expect(201)
    ).body;
    expect(asked.revisions[0]).toMatchObject({
      state: 'in_approval',
      lines: [{ oldAmount: '100000.00', newAmount: '150000.00' }],
    });
    expect(
      (
        await co.accounts.api
          .post(`/budgets/${budgetId}/revisions`, {
            reason: 'again',
            lines: [{ accountId: acct['5240'], amount: '25000' }],
          })
          .expect(409)
      ).body.code,
    ).toBe('BUDGET_REVISION_OPEN');
    await approve(asked.revisions[0].approvalRequestId, co.md.api);
    const b = await budget();
    expect(b).toMatchObject({
      total: '170000.00',
      revisions: [{ state: 'approved' }],
    });
    expect(line(b, '1210')).toMatchObject({
      budget: '150000.00',
      used: '123400.00',
      status: 'warning',
    });
  });

  it('budget vs actual: each department, the lines, and spending without a budget', async () => {
    // Head Office spends without a budget
    const ho = (
      await co.accounts.api
        .post(`${c}/vendor-bills`, {
          vendorId: vendor.karim,
          billNo: 'KT/2026/1302',
          billDate: '2026-10-04',
          narration: 'HO stationery',
          lines: [
            {
              accountId: acct['5240'],
              departmentId: co.departments.ho,
              description: 'Stationery',
              amount: '5000',
              vatPercent: '15',
            },
          ],
        })
        .expect(201)
    ).body;
    await approve(
      (await co.accounts.api.post(`/vendor-bills/${ho.id}/submit`).expect(200))
        .body.approvalRequestId,
      checker,
    );

    const report = (
      await co.md.api
        .get(`${c}/budget-vs-actual?fiscalYear=2026-27`)
        .expect(200)
    ).body;
    const sales = report.departments.find(
      (d: { departmentId: string }) =>
        d.departmentId === co.departments.salesDhaka,
    );
    expect(sales.total).toMatchObject({
      budget: '170000.00',
      actual: '54700.00',
      committed: '86700.00',
    });
    const hoRow = report.departments.find(
      (d: { departmentId: string }) => d.departmentId === co.departments.ho,
    );
    expect(hoRow).toMatchObject({
      budgetId: null,
      total: { budget: '0.00', actual: '5000.00', status: 'over' },
    });
    // the Dept Head sees only his department
    const own = (
      await co.salesHead.api
        .get(`${c}/budget-vs-actual?fiscalYear=2026-27`)
        .expect(200)
    ).body;
    expect(
      own.departments.map((d: { departmentId: string }) => d.departmentId),
    ).not.toContain(co.departments.ho);
  });
});
