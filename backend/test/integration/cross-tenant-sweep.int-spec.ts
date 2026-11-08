/**
 * Cross-tenant attack sweep (guide §20, §21; WP12): every route, not a sample.
 *
 * Company A (Meghna Foods) is filled with real records. The owner of company B
 * holds every company-wide role (System Admin, Admin, HR, Accounts, group scope),
 * then:
 *   - calls every route that takes an id with A's real ids: the answer must be
 *     a refusal (400/401/403/404/409/422), never a success and never a crash;
 *   - calls every list route without ids: the answer must not contain any of A's
 *     ids or A's company name.
 * A route added later is swept automatically (routes.ts reads the controllers).
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import type { Database } from '../../src/platform/db/schema.js';
import { apiFor, startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb, createTenant } from './helpers.js';
import { allRoutes } from './routes.js';

const db = appDb();
let app: INestApplication;
let a: BdCompany;
let attacker: { token: string };
const ids = new Map<string, string>(); // table -> one of A's ids
let companyName: string;

/** Which table a path parameter points into (by name, then by the route around it). */
function tableFor(
  param: string,
  route: string,
): keyof Database | 'global' | null {
  const byName: Record<string, keyof Database | 'global'> = {
    employeeId: 'employees',
    companyId: 'companies',
    userId: 'users',
    batchId: 'import_batches',
    fileId: 'disbursement_files',
    holidayId: 'holidays',
    calendarId: 'holiday_calendars',
    gradeId: 'grades',
    flagId: 'payroll_flags',
    documentId: 'employee_documents',
    deviceId: 'employee_devices',
    designationId: 'designations',
    departmentId: 'departments',
    branchId: 'branches',
    variableId: 'payroll_variables',
    shiftId: 'shifts',
    salaryId: 'employee_salaries',
    roleId: 'custom_roles',
    paymentId: 'payments',
    leaveTypeId: 'leave_types',
    keyId: 'service_keys',
    delegationId: 'delegations',
    chainId: 'approval_chains',
    accountId: 'accounts',
    voucherId: 'vouchers',
    vendorId: 'vendors',
    billId: 'vendor_bills',
    vendorPaymentId: 'vendor_payments',
    challanId: 'tax_challans',
    certificateId: 'tax_certificates',
    claimId: 'expense_claims',
    advanceId: 'expense_advances',
    categoryId: 'expense_categories',
    loanId: 'loans',
    budgetId: 'budgets',
    assetId: 'assets',
    classId: 'asset_classes',
    assignmentId: 'asset_assignments',
    storeId: 'stores',
    saleId: 'vat_sales',
    returnId: 'vat_returns',
    comparisonId: 'old_system_comparisons',
    leadId: 'leads',
    customerId: 'customers',
    territoryId: 'sales_territories',
    activityId: 'crm_activities',
    opportunityId: 'opportunities',
    stageId: 'opportunity_stages',
    productId: 'products',
    quotationId: 'sales_quotations',
    orderId: 'sales_orders',
    invoiceId: 'sales_invoices',
    bankAccountId: 'company_bank_accounts',
    lineId: 'bank_statement_lines',
    item: 'global',
    // shared by every tenant (published rule packs, template names): not tenant data
    packId: 'global',
    key: 'global',
    entity: 'global',
    itemCode: 'global',
    rowNo: 'global',
    employeeCode: 'global',
    period: 'global',
  };
  if (byName[param]) return byName[param];
  if (param === 'requestId')
    return route.includes('/leave/')
      ? 'leave_requests'
      : route.includes('stock-requests')
        ? 'stock_issue_requests'
        : 'approval_requests';
  if (param === 'runId')
    return route.includes('depreciation-runs')
      ? 'depreciation_runs'
      : 'payroll_runs';
  if (param === 'itemId')
    return route.includes('vat-items')
      ? 'vat_items'
      : route.includes('compliance')
        ? 'compliance_items'
        : route.includes('receivable-items')
          ? 'receivable_items'
          : 'stock_items';
  if (param === 'receiptId')
    return route.includes('goods-receipts')
      ? 'goods_receipts'
      : route.includes('customer-receipts')
        ? 'customer_receipts'
        : 'expense_receipts';
  if (param === 'eventId')
    return route.includes('job-events')
      ? 'employee_job_events'
      : 'outbox_events';
  if (param === 'grantId')
    return route.includes('field-grants') ? 'field_grants' : 'user_roles';
  if (param === 'id') {
    if (route.includes('/ai/policy-documents')) return 'ai_policy_documents';
    if (route.includes('/ai/interactions')) return 'ai_interactions';
    if (route.includes('parallel-comparisons'))
      return 'parallel_run_comparisons';
    if (route.includes('notifications')) return 'notifications';
  }
  return null;
}

const TABLES: Array<keyof Database> = [
  'employees',
  'companies',
  'payroll_runs',
  'users',
  'import_batches',
  'disbursement_files',
  'holidays',
  'holiday_calendars',
  'grades',
  'payroll_flags',
  'employee_documents',
  'employee_devices',
  'designations',
  'departments',
  'branches',
  'payroll_variables',
  'shifts',
  'employee_salaries',
  'custom_roles',
  'payments',
  'leave_types',
  'service_keys',
  'delegations',
  'approval_chains',
  'leave_requests',
  'approval_requests',
  'employee_job_events',
  'outbox_events',
  'field_grants',
  'user_roles',
  'ai_policy_documents',
  'ai_interactions',
  'notifications',
  'parallel_run_comparisons',
  'accounts',
  'vouchers',
  'vendors',
  'vendor_bills',
  'vendor_payments',
  'tax_challans',
  'tax_certificates',
  'expense_claims',
  'expense_advances',
  'expense_categories',
  'loans',
  'expense_receipts',
  'budgets',
  'assets',
  'asset_classes',
  'asset_assignments',
  'stores',
  'stock_items',
  'stock_issue_requests',
  'company_bank_accounts',
  'bank_statement_lines',
  'vat_items',
  'vat_sales',
  'compliance_items',
  'leads',
  'customers',
  'sales_territories',
  'crm_activities',
  'opportunities',
  'opportunity_stages',
  'products',
  'sales_quotations',
  'sales_orders',
  'sales_invoices',
  'customer_receipts',
];

beforeAll(async () => {
  app = await startApp();
  a = await createBdCompany(app, db);
  const c = `/companies/${a.companyId}`;
  companyName = (await a.owner.get(c).expect(200)).body.legalName;

  // fill A with records of most kinds, through the API
  const packs = (await a.owner.get('/rule-packs').expect(200)).body.packs;
  await a.owner
    .post(
      `/rule-packs/${packs.find((p: { code: string }) => p.code === 'BD-LABOUR').id}/accept`,
      { effectiveFrom: '2025-01-01' },
    )
    .expect(201);
  await a.hr.api.post(`${c}/leave-types/defaults`).expect(201);
  await a.hr.api.post(`${c}/salary-heads/defaults`).expect(201);
  await a.hr.api
    .post('/leave/accruals/run', { companyId: a.companyId, asOf: '2026-10-15' })
    .expect(201);
  const calendar = (
    await a.hr.api
      .post(`${c}/holiday-calendars`, { name: 'Bangladesh 2026' })
      .expect(201)
  ).body.id;
  await a.hr.api
    .post(`/holiday-calendars/${calendar}/holidays`, {
      date: '2026-12-16',
      nameEn: 'Victory Day',
      nameBn: 'বিজয় দিবস',
      type: 'public',
    })
    .expect(201);
  const types = (await a.hr.api.get(`${c}/leave-types`).expect(200)).body;
  const cl = types.find((t: { code: string }) => t.code === 'CL').id;
  await a.rafi.api
    .post(`/employees/${a.rafi.employeeId}/leave-requests`, {
      leaveTypeId: cl,
      fromDate: '2026-11-10',
      toDate: '2026-11-11',
      reason: 'Family wedding in Cumilla',
    })
    .expect(201);
  await a.hr.api
    .post('/ai/policy-documents', {
      title: 'Meghna handbook',
      language: 'en',
      body: '# Leave\n\nTen days of casual leave a year.',
    })
    .expect(201);
  await a.hr.api
    .upload(
      `${c}/imports`,
      { entity: 'loans', cutOverDate: '2026-10-01' },
      {
        content: Buffer.from(
          'employee_code,outstanding,installment,next_period,reason\r\nNOPE,1000,100,2026-10,Advance\r\n',
        ),
        name: 'loans.csv',
      },
    )
    .expect(201);
  // books: chart of accounts and a draft voucher (WP14)
  await a.accounts.api
    .post(`${c}/ledger/setup`, { asOf: '2026-10-15' })
    .expect(200);
  const chart = (await a.accounts.api.get(`${c}/accounts`).expect(200))
    .body as Array<{ id: string; code: string }>;
  const code = (k: string) => chart.find((x) => x.code === k)!.id;
  await a.accounts.api
    .post(`${c}/vouchers`, {
      voucherType: 'payment',
      voucherDate: '2026-10-05',
      narration: 'Office rent October, Gulshan-2',
      lines: [
        { accountId: code('5210'), debit: '85000' },
        { accountId: code('1130'), credit: '85000' },
      ],
    })
    .expect(201);
  // payables (WP15): a vendor and a draft bill through the API (tax-at-source rates: pack 2026.3)
  const pack3 = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.3',
  );
  await a.owner
    .post(`/rule-packs/${pack3.id}/accept`, { effectiveFrom: '2026-01-01' })
    .expect(201);
  const vendorId = (
    await a.accounts.api
      .post(`${c}/vendors`, {
        name: 'Clean & Care Services Ltd',
        tin: '123456789012',
        withholdingCategory: 'SERVICE',
      })
      .expect(201)
  ).body.id;
  // expenses (WP16): categories, Rafi's draft claim with a receipt, his cash advance
  await a.accounts.api.post(`${c}/expense-categories/defaults`).expect(201);
  const claimId = (
    await a.rafi.api
      .post('/me/expense-claims', { title: 'Dealer visit, Chattogram' })
      .expect(201)
  ).body.id;
  await a.rafi.api
    .upload(
      `/expense-claims/${claimId}/receipts`,
      {},
      {
        content: Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          Buffer.from('bus ticket'),
        ]),
        name: 'bus.png',
      },
    )
    .expect(201);
  await a.rafi.api
    .post('/me/expense-advances', {
      purpose: 'Dealer visit, Chattogram',
      amount: '20000',
    })
    .expect(201);
  // budgets (WP18): a draft budget
  await a.accounts.api
    .post(`${c}/budgets`, {
      fiscalYear: '2026-27',
      departmentId: a.departments.sales,
      lines: [{ accountId: code('5250'), amount: '120000' }],
    })
    .expect(201);
  // assets and stock (WP19): a laptop with Rafi; a store, an item and Rafi's request
  const classes = (
    await a.md.api.post(`${c}/asset-classes/defaults`).expect(201)
  ).body as Array<{ id: string; code: string }>;
  const laptop = (
    await a.md.api
      .post(`${c}/assets`, {
        classId: classes.find((k) => k.code === 'IT')!.id,
        name: 'HP ProBook 450 G10',
        inServiceDate: '2026-10-01',
        cost: '98000',
      })
      .expect(201)
  ).body.id;
  await a.md.api
    .post(`/assets/${laptop}/assign`, {
      employeeId: a.rafi.employeeId,
      assignedOn: '2026-10-10',
    })
    .expect(200);
  const store = (
    await a.accounts.api
      .post(`${c}/stores`, { code: 'HO', name: 'Head office store' })
      .expect(201)
  ).body.id;
  const paper = (
    await a.accounts.api
      .post(`${c}/stock-items`, { code: 'A4', name: 'A4 paper', unit: 'ream' })
      .expect(201)
  ).body.id;
  await a.rafi.api
    .post(`${c}/stock-requests`, {
      storeId: store,
      lines: [{ itemId: paper, quantity: '2' }],
    })
    .expect(201);
  // bank reconciliation (WP20): the bank account and an imported statement
  const bank = (
    await a.accounts.api
      .post(`${c}/bank-accounts`, {
        accountId: code('1130'),
        bankName: 'Dutch-Bangla Bank PLC',
        accountName: 'Meghna Foods Ltd',
        accountNo: '1101100012345',
        statementFormat: 'generic',
        reconcileFrom: '2026-10-01',
        openingBankBalance: '0',
      })
      .expect(201)
  ).body.id;
  await a.accounts.api
    .upload(
      `/bank-accounts/${bank}/statements`,
      {},
      {
        content: Buffer.from(
          'Date,Description,Reference,Withdrawal,Deposit,Balance\n2026-10-02,NPSB CREDIT,,,5000,5000\n',
        ),
        name: 'oct.csv',
      },
    )
    .expect(201);
  // VAT and compliance (WP21): the items, a VAT invoice, the calendar
  const vatItems = (
    await a.accounts.api
      .post(`${c}/vat-items/defaults`, { fiscalYear: '2026-27' })
      .expect(201)
  ).body as Array<{ id: string; code: string }>;
  await a.accounts.api
    .post(`${c}/vat-sales`, {
      invoiceDate: '2026-10-12',
      customerName: 'Sylhet Agro Ltd',
      receivedIntoAccountId: code('1130'),
      lines: [
        {
          itemId: vatItems.find((i) => i.code === 'GOODS-STD')!.id,
          description: 'Mustard oil',
          value: '10000',
        },
      ],
    })
    .expect(201);
  await a.accounts.api.get(`${c}/compliance`).expect(200);
  // CRM (WP23): a territory, a lead with a task, a customer
  await a.owner
    .post(`/users/${a.rafi.userId}/roles`, { role: 'sales', scopeType: 'own' })
    .expect(201);
  await a.md.api
    .post(`${c}/sales-territories`, {
      code: 'CTG',
      name: 'Chattogram',
      districts: ['Chattogram'],
      memberIds: [a.rafi.userId],
    })
    .expect(201);
  const crmLead = (
    await a.md.api
      .post(`${c}/leads`, {
        name: 'Abdul Karim',
        phone: '01711223344',
        source: 'walk_in',
        ownerId: a.rafi.userId,
      })
      .expect(201)
  ).body;
  await a.md.api
    .post(`/leads/${crmLead.id}/activities`, {
      kind: 'task',
      subject: 'Send the price list',
      dueOn: '2026-11-05',
    })
    .expect(201);
  const karim = (
    await a.md.api
      .post(`/leads/${crmLead.id}/qualify`, {
        customer: { kind: 'company', name: 'Karim Stores' },
        opportunity: {
          title: 'Rice bran oil, 200 cans a month',
          value: '360000',
          expectedCloseOn: '2026-11-20',
        },
      })
      .expect(200)
  ).body.customerId as string;
  // sales (WP25-WP27): a product, a quotation accepted into an order, its invoice, a receipt
  const oil = (
    await a.accounts.api
      .post(`${c}/products`, {
        code: 'RBO-5L',
        name: 'Rice bran oil 5 L can',
        unit: 'can',
        vatItemId: vatItems.find((i) => i.code === 'GOODS-STD')!.id,
      })
      .expect(201)
  ).body.id;
  const karimRow = (await a.md.api.get(`/customers/${karim}`).expect(200)).body;
  await a.accounts.api
    .put(`/customers/${karim}/credit`, {
      version: karimRow.version,
      creditLimit: '1000000',
      paymentTermsDays: 30,
    })
    .expect(200);
  let q = (
    await a.md.api
      .post(`${c}/quotations`, {
        customerId: karim,
        validUntil: '2027-06-30',
        lines: [{ productId: oil, quantity: '10', unitPrice: '1850' }],
      })
      .expect(201)
  ).body;
  for (const s of ['submit', 'send', 'accept'])
    q = (
      await a.md.api
        .post(`/quotations/${q.id}/${s}`, { version: q.version })
        .expect(200)
    ).body;
  const so = (await a.md.api.get(`/sales-orders/${q.order.id}`).expect(200))
    .body;
  await a.md.api
    .post(`/sales-orders/${so.id}/deliver`, {
      version: so.version,
      challanNo: 'DC-1',
    })
    .expect(200);
  const inv = (
    await a.accounts.api.post(`/sales-orders/${so.id}/invoice`, {}).expect(201)
  ).body;
  await a.accounts.api
    .post(`${c}/customer-receipts`, {
      customerId: karim,
      receiptDate: inv.invoiceDate,
      method: 'cash',
      receivedIntoAccountId: code('1110'),
      amount: '1000',
      allocations: [{ itemId: inv.itemId, amount: '1000' }],
    })
    .expect(201);
  await a.hr.api
    .post(`/employees/${a.rafi.employeeId}/loans`, {
      principal: '10000',
      installment: '2500',
      firstPeriod: '2026-11',
      reason: 'Medical',
    })
    .expect(201);
  await a.accounts.api
    .post(`${c}/vendor-bills`, {
      vendorId,
      billNo: 'CCS/2026/1043',
      billDate: '2026-10-05',
      narration: 'Office cleaning',
      lines: [
        {
          accountId: code('5275'),
          amount: '120000',
          vatPercent: '15',
          description: 'Cleaning',
        },
      ],
    })
    .expect(201);
  await db.withTenant(
    { tenantId: a.tenant.id, access: AccessGrants.system() },
    async () => {
      const run = await db.tx
        .insertInto('payroll_runs')
        .values({
          company_id: a.companyId,
          period: '2026-09',
          run_type: 'regular',
          state: 'calculated',
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await db.tx
        .insertInto('payroll_flags')
        .values({
          run_id: run.id,
          employee_id: a.rafi.employeeId,
          code: 'NET_CHANGE',
          message: 'Net pay changed 38%',
        })
        .execute();
      // a (withdrawn) vendor payment, tax challan and certificate, so their routes get real ids
      await db.tx
        .insertInto('vendor_payments')
        .values({
          company_id: a.companyId,
          vendor_id: vendorId,
          payment_date: '2026-10-20',
          method: 'cheque',
          paid_from_account_id: code('1130'),
          amount: '1000',
          state: 'cancelled',
        })
        .execute();
      await db.tx
        .insertInto('tax_challans')
        .values({
          company_id: a.companyId,
          tax_type: 'tds',
          period: '2026-10',
          challan_no: 'TR-1',
          challan_date: '2026-11-10',
          paid_from_account_id: code('1130'),
          amount: '9000',
          state: 'cancelled',
        })
        .execute();
      await db.tx
        .insertInto('tax_certificates')
        .values({
          company_id: a.companyId,
          vendor_id: vendorId,
          tax_type: 'tds',
          number: 'TDSC/2026-27/00001',
          period_from: '2026-07-01',
          period_to: '2026-12-31',
          amount: '9000',
        })
        .execute();

      // one id of every kind A has
      for (const table of TABLES) {
        const row = await db.tx
          .selectFrom(table as 'employees')
          .select('id')
          .limit(1)
          .executeTakeFirst();
        if (row) ids.set(table, row.id);
      }
    },
  );

  // the attacker: company B's owner with every company-wide role
  const b = await createTenant(db, 'attacker');
  await db.withTenant({ tenantId: b.id, access: AccessGrants.system() }, () =>
    db.tx
      .insertInto('user_roles')
      .values({
        user_id: b.userId,
        system_role: 'accounts',
        scope_type: 'group',
        scope_id: null,
      })
      .execute(),
  );
  attacker = await apiFor(app, b);
}, 240_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

const call = (method: string, url: string) => {
  const server = app.getHttpServer();
  const auth = {
    Authorization: `Bearer ${attacker.token}`,
    'Idempotency-Key': randomUUID(),
  };
  const m = method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  const req = request(server)[m](url).set(auth);
  return m === 'get' ? req : req.send({});
};

describe('cross-tenant sweep: every route', () => {
  it('company A has records of most kinds to attack', () => {
    expect(ids.size).toBeGreaterThanOrEqual(18);
  });

  it("routes with ids: A's real ids are always refused, never served or changed", async () => {
    const routes = (await allRoutes()).filter((r) => r.route.includes(':'));
    const leaks: string[] = [];
    let withRealIds = 0;
    for (const { route } of routes) {
      const [method, pattern] = route.split(' ');
      let real = true;
      const url = pattern.replace(/:([a-zA-Z]+)/g, (_m, param: string) => {
        const table = tableFor(param, pattern);
        if (table === 'global') return param === 'rowNo' ? '1' : 'x';
        const id = table ? ids.get(table) : undefined;
        if (!id) real = false;
        return id ?? randomUUID();
      });
      if (real) withRealIds++;
      const res = await call(method, url);
      if (![400, 401, 403, 404, 409, 422].includes(res.status))
        leaks.push(
          `${method} ${url} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`,
        );
    }
    expect(leaks).toEqual([]);
    // most of the sweep used real records of A, not made-up ids
    expect(withRealIds / routes.length).toBeGreaterThan(0.8);
  }, 120_000);

  it("list routes: nothing of A appears in B's answers", async () => {
    const routes = (await allRoutes()).filter(
      (r) => r.route.startsWith('GET ') && !r.route.includes(':'),
    );
    const secrets = [companyName, ...ids.values()];
    const leaks: string[] = [];
    for (const { route } of routes) {
      const res = await call('GET', route.split(' ')[1]);
      const text = res.text ?? '';
      const found = secrets.filter((s) => text.includes(s));
      if (found.length)
        leaks.push(`${route} -> ${res.status} contains ${found.join(', ')}`);
    }
    expect(routes.length).toBeGreaterThan(20);
    expect(leaks).toEqual([]);
  }, 120_000);
});
