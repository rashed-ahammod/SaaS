/**
 * WP1 organization: companies, branches, department tree (closure table),
 * designations, grades. Includes cross-tenant attacks on the new routes.
 */
import type { INestApplication } from '@nestjs/common';
import { apiFor, startApp, type Api } from './api-client.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

const db = appDb();
let app: INestApplication;
let api: Api;
let tenant: TestTenant;
let companyId: string;

beforeAll(async () => {
  app = await startApp();
  tenant = await createTenant(db, 'org');
  api = await apiFor(app, tenant);
  const company = await api
    .post('/companies', {
      legalName: 'Org Test Ltd',
      employeeCodePrefix: 'otl',
    })
    .expect(201);
  companyId = company.body.id;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('companies', () => {
  it('creates with Bangladesh defaults', async () => {
    const res = await api.get(`/companies/${companyId}`).expect(200);
    expect(res.body).toMatchObject({
      legalName: 'Org Test Ltd',
      fiscalYearStart: '07-01',
      baseCurrency: 'BDT',
      employeeCodePrefix: 'OTL',
      probationMonths: 6,
      version: 1,
    });
  });

  it('updates with optimistic locking', async () => {
    const ok = await api
      .patch(`/companies/${companyId}`, { shortName: 'OTL', version: 1 })
      .expect(200);
    expect(ok.body).toMatchObject({ shortName: 'OTL', version: 2 });

    const stale = await api.patch(`/companies/${companyId}`, {
      shortName: 'X',
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_VERSION');
  });

  it('rejects a duplicate legal name', async () => {
    const res = await api.post('/companies', { legalName: 'Org Test Ltd' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_VALUE');
  });
});

describe('branches', () => {
  it('creates with weekend days and geo-fence', async () => {
    const res = await api
      .post(`/companies/${companyId}/branches`, {
        code: 'dhk',
        name: 'Dhaka HQ',
        weekendDays: ['FRI', 'SAT'],
        geoLat: 23.7806,
        geoLng: 90.4074,
        geoRadiusM: 150,
      })
      .expect(201);
    expect(res.body).toMatchObject({
      code: 'DHK',
      weekendDays: ['FRI', 'SAT'],
      geoFence: { lat: 23.7806, lng: 90.4074, radiusM: 150 },
    });
  });

  it('requires the geo-fence fields together', async () => {
    await api
      .post(`/companies/${companyId}/branches`, {
        code: 'CTG',
        name: 'Chattogram',
        geoLat: 22.3,
      })
      .expect(400);
  });

  it('refuses unknown weekdays', async () => {
    await api
      .post(`/companies/${companyId}/branches`, {
        code: 'X1',
        name: 'X',
        weekendDays: ['FRIDAY'],
      })
      .expect(400);
  });
});

describe('department tree', () => {
  let ho: string, sales: string, salesDhaka: string, it_: string;

  beforeAll(async () => {
    ho = (
      await api
        .post(`/companies/${companyId}/departments`, {
          code: 'HO',
          name: 'Head Office',
        })
        .expect(201)
    ).body.id;
    sales = (
      await api
        .post(`/companies/${companyId}/departments`, {
          code: 'SALES',
          name: 'Sales',
          parentId: ho,
        })
        .expect(201)
    ).body.id;
    salesDhaka = (
      await api
        .post(`/companies/${companyId}/departments`, {
          code: 'SALES-DHK',
          name: 'Sales Dhaka',
          parentId: sales,
        })
        .expect(201)
    ).body.id;
    it_ = (
      await api
        .post(`/companies/${companyId}/departments`, { code: 'IT', name: 'IT' })
        .expect(201)
    ).body.id;
  });

  /** Read the closure table directly. */
  function paths() {
    return db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('department_paths')
        .select(['ancestor_id', 'descendant_id', 'depth'])
        .execute(),
    );
  }

  it('lists in tree order with depth', async () => {
    const res = await api
      .get(`/companies/${companyId}/departments`)
      .expect(200);
    expect(
      res.body.map(
        (d: { code: string; depth: number }) => `${d.depth}:${d.code}`,
      ),
    ).toEqual(['0:HO', '1:SALES', '2:SALES-DHK', '0:IT']);
  });

  it('keeps the closure table complete', async () => {
    const rows = await paths();
    const has = (a: string, d: string, depth: number) =>
      rows.some(
        (r) =>
          r.ancestor_id === a && r.descendant_id === d && r.depth === depth,
      );
    expect(has(ho, salesDhaka, 2)).toBe(true);
    expect(has(sales, salesDhaka, 1)).toBe(true);
    expect(has(salesDhaka, salesDhaka, 0)).toBe(true);
  });

  it('moves a subtree and re-links its paths', async () => {
    const before = (await api.get(`/departments/${sales}`)).body;
    await api
      .patch(`/departments/${sales}`, {
        parentId: it_,
        version: before.version,
      })
      .expect(200);

    const rows = await paths();
    const has = (a: string, d: string) =>
      rows.some((r) => r.ancestor_id === a && r.descendant_id === d);
    expect(has(it_, salesDhaka)).toBe(true);
    expect(has(ho, salesDhaka)).toBe(false);
    expect(has(ho, sales)).toBe(false);
  });

  it('refuses to move a department under its own sub-department', async () => {
    const current = (await api.get(`/departments/${sales}`)).body;
    const res = await api.patch(`/departments/${sales}`, {
      parentId: salesDhaka,
      version: current.version,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('DEPARTMENT_CYCLE');
  });

  it('refuses a duplicate code in the same company', async () => {
    const res = await api.post(`/companies/${companyId}/departments`, {
      code: 'it',
      name: 'IT again',
    });
    expect(res.status).toBe(409);
  });
});

describe('designations and grades', () => {
  it('creates a designation with Bangla name', async () => {
    const res = await api
      .post(`/companies/${companyId}/designations`, {
        code: 'SE',
        nameEn: 'Senior Executive',
        nameBn: 'সিনিয়র এক্সিকিউটিভ',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      code: 'SE',
      nameBn: 'সিনিয়র এক্সিকিউটিভ',
    });
  });

  it('creates a grade with a salary band as money strings', async () => {
    const res = await api
      .post(`/companies/${companyId}/grades`, {
        code: 'G5',
        name: 'Grade 5',
        rank: 5,
        otEligible: true,
        salaryMin: '25000',
        salaryMax: '40000.5',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      salaryMin: '25000.00',
      salaryMax: '40000.50',
      otEligible: true,
    });
  });

  it('refuses salaryMax below salaryMin and float numbers', async () => {
    await api
      .post(`/companies/${companyId}/grades`, {
        code: 'G6',
        name: 'G6',
        salaryMin: '50000',
        salaryMax: '40000',
      })
      .expect(400);
    await api
      .post(`/companies/${companyId}/grades`, {
        code: 'G7',
        name: 'G7',
        salaryMin: 25000.1,
      })
      .expect(400);
  });
});

describe('cross-tenant attacks on organization routes', () => {
  let other: Api;
  beforeAll(async () => {
    other = await apiFor(app, await createTenant(db, 'org-b'));
  });

  it("cannot read or list another tenant's company", async () => {
    await other.get(`/companies/${companyId}`).expect(404);
    const list = await other.get('/companies').expect(200);
    expect(list.body).toEqual([]);
    await other.get(`/companies/${companyId}/departments`).expect(404);
  });

  it("cannot create records under another tenant's company", async () => {
    const res = await other.post(`/companies/${companyId}/branches`, {
      code: 'HACK',
      name: 'Hack',
    });
    expect(res.status).toBe(404);
  });

  it("cannot update another tenant's company", async () => {
    await other
      .patch(`/companies/${companyId}`, { legalName: 'Hacked', version: 2 })
      .expect(404);
  });
});
