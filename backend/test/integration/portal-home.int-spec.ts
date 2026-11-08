/**
 * The portal home screen: GET /companies/:id/portal/overview — setup progress
 * and what waits for this user, with everything the user may not see left out.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { apiFor, startApp, type Api } from './api-client.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

const db = appDb();
let app: INestApplication;
let api: Api;
let tenant: TestTenant;
let companyId: string;

beforeAll(async () => {
  app = await startApp();
  tenant = await createTenant(db, 'home');
  api = await apiFor(app, tenant);
  const company = await api
    .post('/companies', {
      legalName: 'Portal Home Ltd',
      employeeCodePrefix: 'phl',
    })
    .expect(201);
  companyId = company.body.id;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('portal overview', () => {
  it('lists the setup steps of a brand-new company, none of them done', async () => {
    const res = await api
      .get(`/companies/${companyId}/portal/overview`)
      .expect(200);
    expect(res.body.companyId).toBe(companyId);
    expect(res.body.setup.total).toBeGreaterThan(5);
    expect(res.body.setup.complete).toBe(false);
    const branches = res.body.setup.steps.find(
      (s: { key: string }) => s.key === 'branches',
    );
    expect(branches).toMatchObject({
      done: false,
      count: 0,
      href: '/portal/organization',
    });
    // the admin of a fresh tenant has a login, so that one step is already done
    expect(
      res.body.setup.steps.find((s: { key: string }) => s.key === 'users'),
    ).toMatchObject({ done: true });
  });

  it('counts what has been created, and marks the step done', async () => {
    await api
      .post(`/companies/${companyId}/branches`, {
        code: 'dhk',
        name: 'Dhaka HQ',
        weekendDays: ['FRI', 'SAT'],
      })
      .expect(201);
    const res = await api
      .get(`/companies/${companyId}/portal/overview`)
      .expect(200);
    expect(
      res.body.setup.steps.find((s: { key: string }) => s.key === 'branches'),
    ).toMatchObject({ done: true, count: 1 });
    expect(res.body.setup.done).toBeGreaterThan(0);
  });

  it('leaves out attention items with nothing waiting', async () => {
    const res = await api
      .get(`/companies/${companyId}/portal/overview`)
      .expect(200);
    for (const item of res.body.attention)
      expect(item.count).toBeGreaterThan(0);
    // nothing has been asked for yet, so the inbox is not in the list
    expect(
      res.body.attention.find((a: { key: string }) => a.key === 'approvals'),
    ).toBeUndefined();
  });

  it('reminds about the unlocked month once attendance is managed', async () => {
    const res = await api
      .get(`/companies/${companyId}/portal/overview`)
      .expect(200);
    expect(
      res.body.attention.find(
        (a: { key: string }) => a.key === 'attendanceLock',
      ),
    ).toMatchObject({ count: 1, href: '/portal/attendance' });
  });

  it('warns about a document whose expiry date is near, and links to the list it is on', async () => {
    // a company needs its structure before it can have an employee with a contract
    const c = `/companies/${companyId}`;
    const branch = (await api.get(`${c}/branches`).expect(200)).body[0].id;
    const department = (
      await api
        .post(`${c}/departments`, { code: 'ho', name: 'Head Office' })
        .expect(201)
    ).body.id;
    const designation = (
      await api
        .post(`${c}/designations`, { code: 'exe', nameEn: 'Executive' })
        .expect(201)
    ).body.id;
    const grade = (
      await api.post(`${c}/grades`, { code: 'g1', name: 'Grade 1' }).expect(201)
    ).body.id;
    const employee = (
      await api
        .post('/employees', {
          companyId,
          fullNameEn: 'Shahadat Hossain',
          joinDate: '2026-01-01',
          branchId: branch,
          departmentId: department,
          designationId: designation,
          gradeId: grade,
        })
        .expect(201)
    ).body;

    const before = await api.get(`${c}/portal/overview`).expect(200);
    expect(
      before.body.attention.find(
        (a: { key: string }) => a.key === 'documentExpiry',
      ),
    ).toBeUndefined();

    const in10Days = new Date(Date.now() + 10 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await api
      .upload(
        `/employees/${employee.id}/documents`,
        { docType: 'contract', expiresOn: in10Days },
        { content: Buffer.from('%PDF-1.4\n%%EOF\n'), name: 'contract.pdf' },
      )
      .expect(201);

    const after = await api.get(`${c}/portal/overview`).expect(200);
    expect(
      after.body.attention.find(
        (a: { key: string }) => a.key === 'documentExpiry',
      ),
    ).toMatchObject({
      count: 1,
      tone: 'warn',
      href: '/portal/lifecycle?tab=papers',
    });
  });

  it('404s for a company that does not exist', async () => {
    await api.get(`/companies/${randomUUID()}/portal/overview`).expect(404);
  });

  it('does not answer for another tenant’s company', async () => {
    const other = await createTenant(db, 'home2');
    const otherApi = await apiFor(app, other);
    await otherApi.get(`/companies/${companyId}/portal/overview`).expect(404);
  });
});
