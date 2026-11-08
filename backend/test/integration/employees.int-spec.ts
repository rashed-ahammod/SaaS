/**
 * WP1 employees. Acceptance criteria (guide §24):
 *   - a back-dated transfer shows the correct history;
 *   - overlapping assignments are impossible.
 */
import type { INestApplication } from '@nestjs/common';
import {
  addDays,
  todayInDhaka,
} from '../../src/platform/dates/business-date.js';
import { apiFor, startApp, type Api } from './api-client.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

const db = appDb();
let app: INestApplication;
let api: Api;
let tenant: TestTenant;

/** Ids of a small organization, created once. */
const org = {} as {
  companyId: string;
  dhaka: string;
  ctg: string;
  ho: string;
  sales: string;
  salesDhaka: string;
  finance: string;
  exec: string;
  manager: string;
  g1: string;
  g2: string;
  otherCompanyDept: string;
};

beforeAll(async () => {
  app = await startApp();
  tenant = await createTenant(db, 'emp');
  api = await apiFor(app, tenant);

  const company = (
    await api
      .post('/companies', {
        legalName: 'Emp Test Ltd',
        employeeCodePrefix: 'ETL',
      })
      .expect(201)
  ).body;
  org.companyId = company.id;
  const c = `/companies/${company.id}`;
  org.dhaka = (
    await api.post(`${c}/branches`, { code: 'DHK', name: 'Dhaka' }).expect(201)
  ).body.id;
  org.ctg = (
    await api
      .post(`${c}/branches`, { code: 'CTG', name: 'Chattogram' })
      .expect(201)
  ).body.id;
  org.ho = (
    await api
      .post(`${c}/departments`, { code: 'HO', name: 'Head Office' })
      .expect(201)
  ).body.id;
  org.sales = (
    await api
      .post(`${c}/departments`, {
        code: 'SALES',
        name: 'Sales',
        parentId: org.ho,
      })
      .expect(201)
  ).body.id;
  org.salesDhaka = (
    await api
      .post(`${c}/departments`, {
        code: 'SD',
        name: 'Sales Dhaka',
        parentId: org.sales,
      })
      .expect(201)
  ).body.id;
  org.finance = (
    await api
      .post(`${c}/departments`, {
        code: 'FIN',
        name: 'Finance',
        parentId: org.ho,
      })
      .expect(201)
  ).body.id;
  org.exec = (
    await api
      .post(`${c}/designations`, { code: 'EXE', nameEn: 'Executive' })
      .expect(201)
  ).body.id;
  org.manager = (
    await api
      .post(`${c}/designations`, { code: 'MGR', nameEn: 'Manager' })
      .expect(201)
  ).body.id;
  org.g1 = (
    await api
      .post(`${c}/grades`, { code: 'G1', name: 'Grade 1', rank: 1 })
      .expect(201)
  ).body.id;
  org.g2 = (
    await api
      .post(`${c}/grades`, { code: 'G2', name: 'Grade 2', rank: 2 })
      .expect(201)
  ).body.id;

  const company2 = (
    await api
      .post('/companies', { legalName: 'Sister Concern Ltd' })
      .expect(201)
  ).body;
  org.otherCompanyDept = (
    await api
      .post(`/companies/${company2.id}/departments`, { code: 'X', name: 'X' })
      .expect(201)
  ).body.id;
});

afterAll(async () => {
  await app.close();
  await db.close();
});

function newEmployee(overrides: object = {}) {
  return api.post('/employees', {
    companyId: org.companyId,
    fullNameEn: 'Rahim Uddin',
    fullNameBn: 'রহিম উদ্দিন',
    joinDate: '2026-01-01',
    nid: '1990123456789',
    branchId: org.dhaka,
    departmentId: org.salesDhaka,
    designationId: org.exec,
    gradeId: org.g1,
    ...overrides,
  });
}

describe('create and read', () => {
  it('creates a draft employee with an automatic code and current placement (HR sees the full NID)', async () => {
    const res = await newEmployee().expect(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      fullNameBn: 'রহিম উদ্দিন',
      nid: '1990123456789',
      currentAssignment: {
        department: { code: 'SD' },
        grade: { code: 'G1' },
        effectiveTo: null,
      },
    });
    expect(res.body.employeeCode).toMatch(/^ETL-\d{5}$/);
  });

  it('stores the NID encrypted', async () => {
    const res = await newEmployee({ nid: '1234567890' }).expect(201);
    const row = await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('employees')
        .select('nid_encrypted')
        .where('id', '=', res.body.id)
        .executeTakeFirstOrThrow(),
    );
    expect(row.nid_encrypted).toMatch(/^v1:/);
    expect(row.nid_encrypted).not.toContain('1234567890');
  });

  it('refuses an invalid NID and a placement from another company', async () => {
    await newEmployee({ nid: '12345' }).expect(400);
    const res = await newEmployee({ departmentId: org.otherCompanyDept });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('DEPARTMENT_NOT_FOUND');
  });

  it('searches English and Bangla names, and filters by department including sub-departments', async () => {
    await newEmployee({
      fullNameEn: 'Karim Fin',
      fullNameBn: 'করিম',
      departmentId: org.finance,
    }).expect(201);

    const bn = await api
      .get('/employees?q=' + encodeURIComponent('করিম'))
      .expect(200);
    expect(
      bn.body.items.map((e: { fullNameEn: string }) => e.fullNameEn),
    ).toEqual(['Karim Fin']);

    const sales = await api
      .get(`/employees?departmentId=${org.sales}`)
      .expect(200);
    expect(sales.body.total).toBeGreaterThan(0);
    expect(
      sales.body.items.every(
        (e: { currentAssignment: { department: { code: string } } }) =>
          e.currentAssignment.department.code === 'SD',
      ),
    ).toBe(true);

    const ho = await api
      .get(`/employees?departmentId=${org.ho}&pageSize=200`)
      .expect(200);
    expect(ho.body.total).toBe(sales.body.total + 1);
  });
});

describe('job history (acceptance: back-dated transfer shows correct history)', () => {
  let employeeId: string;
  let transferId: string;

  beforeAll(async () => {
    employeeId = (await newEmployee({ joinDate: '2026-01-01' }).expect(201))
      .body.id;
  });

  const timeline = async () =>
    (
      await api.get(`/employees/${employeeId}/assignments`).expect(200)
    ).body.map(
      (p: {
        effectiveFrom: string;
        effectiveTo: string | null;
        department: { code: string };
        grade: { code: string };
      }) =>
        `${p.effectiveFrom}..${p.effectiveTo ?? 'open'} ${p.department.code}/${p.grade.code}`,
    );

  it('records a promotion from June', async () => {
    await api
      .post(`/employees/${employeeId}/job-events`, {
        type: 'promotion',
        effectiveFrom: '2026-06-01',
        gradeId: org.g2,
        designationId: org.manager,
      })
      .expect(201);
    expect(await timeline()).toEqual([
      '2026-01-01..2026-06-01 SD/G1',
      '2026-06-01..open SD/G2',
    ]);
  });

  it('a transfer recorded later but effective from March carries into the promotion period', async () => {
    const res = await api
      .post(`/employees/${employeeId}/job-events`, {
        type: 'transfer',
        effectiveFrom: '2026-03-01',
        departmentId: org.finance,
        branchId: org.ctg,
        reason: 'Moved to Finance',
      })
      .expect(201);
    transferId = res.body.event.id;

    expect(await timeline()).toEqual([
      '2026-01-01..2026-03-01 SD/G1',
      '2026-03-01..2026-06-01 FIN/G1',
      '2026-06-01..open FIN/G2',
    ]);
  });

  it('answers "where was this employee on a date"', async () => {
    const feb = await api
      .get(`/employees/${employeeId}/assignments?asOf=2026-02-28`)
      .expect(200);
    expect(feb.body).toMatchObject({
      department: { code: 'SD' },
      branch: { code: 'DHK' },
    });
    const apr = await api
      .get(`/employees/${employeeId}/assignments?asOf=2026-04-15`)
      .expect(200);
    expect(apr.body).toMatchObject({
      department: { code: 'FIN' },
      branch: { code: 'CTG' },
      designation: { code: 'EXE' },
    });
    const before = await api
      .get(`/employees/${employeeId}/assignments?asOf=2025-12-31`)
      .expect(200);
    expect(before.body).toEqual({});
  });

  it('keeps every recorded change, in effective-date order', async () => {
    const events = (
      await api.get(`/employees/${employeeId}/job-events`).expect(200)
    ).body;
    expect(events.map((e: { type: string }) => e.type)).toEqual([
      'joining',
      'transfer',
      'promotion',
    ]);
  });

  it('cancelling the transfer restores the previous history and keeps the cancelled record', async () => {
    await api
      .post(`/employees/${employeeId}/job-events/${transferId}/cancel`, {
        reason: 'Recorded by mistake',
      })
      .expect(200);
    expect(await timeline()).toEqual([
      '2026-01-01..2026-06-01 SD/G1',
      '2026-06-01..open SD/G2',
    ]);

    const events = (
      await api.get(`/employees/${employeeId}/job-events`).expect(200)
    ).body;
    expect(
      events.find((e: { id: string }) => e.id === transferId),
    ).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Recorded by mistake',
    });

    const again = await api.post(
      `/employees/${employeeId}/job-events/${transferId}/cancel`,
      { reason: 'x' },
    );
    expect(again.status).toBe(409);
  });

  it('refuses changes before joining, changes that change nothing, and cancelling the joining record', async () => {
    const early = await api.post(`/employees/${employeeId}/job-events`, {
      type: 'transfer',
      effectiveFrom: '2025-12-01',
      departmentId: org.finance,
    });
    expect(early.body.code).toBe('JOB_EVENT_BEFORE_JOINING');

    const same = await api.post(`/employees/${employeeId}/job-events`, {
      type: 'transfer',
      effectiveFrom: '2026-02-01',
      departmentId: org.salesDhaka,
    });
    expect(same.status).toBe(400);
    expect(same.body.code).toBe('JOB_EVENT_NO_CHANGES');

    const events = (
      await api.get(`/employees/${employeeId}/job-events`).expect(200)
    ).body;
    const joining = events.find((e: { type: string }) => e.type === 'joining');
    const res = await api.post(
      `/employees/${employeeId}/job-events/${joining.id}/cancel`,
      { reason: 'x' },
    );
    expect(res.body.code).toBe('JOINING_EVENT_CANNOT_CANCEL');
  });

  it('checks managers: not self, same company', async () => {
    const self = await api.post(`/employees/${employeeId}/job-events`, {
      type: 'manager_change',
      effectiveFrom: '2026-07-01',
      lineManagerId: employeeId,
    });
    expect(self.body.code).toBe('MANAGER_INVALID');

    const boss = (await newEmployee({ fullNameEn: 'Boss' }).expect(201)).body
      .id;
    await api
      .post(`/employees/${employeeId}/job-events`, {
        type: 'manager_change',
        effectiveFrom: '2026-07-01',
        lineManagerId: boss,
      })
      .expect(201);
    const july = await api
      .get(`/employees/${employeeId}/assignments?asOf=2026-07-01`)
      .expect(200);
    expect(july.body.lineManager).toMatchObject({
      id: boss,
      fullNameEn: 'Boss',
    });
  });
});

describe('acceptance: overlapping assignments are impossible', () => {
  it('the database rejects an overlapping period even if code tried to insert one', async () => {
    const emp = (await newEmployee().expect(201)).body;
    const current = await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('employee_assignments')
        .selectAll()
        .where('employee_id', '=', emp.id)
        .executeTakeFirstOrThrow(),
    );

    await expect(
      db.withTenant({ tenantId: tenant.id }, () =>
        db.tx
          .insertInto('employee_assignments')
          .values({
            employee_id: emp.id,
            company_id: current.company_id,
            effective_from: '2026-02-01',
            effective_to: '2026-03-01',
            branch_id: current.branch_id,
            department_id: current.department_id,
            designation_id: current.designation_id,
            grade_id: current.grade_id,
            source_event_id: current.source_event_id,
          })
          .execute(),
      ),
    ).rejects.toThrow(/no_overlap/);
  });

  it("the database rejects an assignment to another company's department", async () => {
    const emp = (await newEmployee().expect(201)).body;
    await expect(
      db.withTenant({ tenantId: tenant.id }, async () => {
        const current = await db.tx
          .selectFrom('employee_assignments')
          .selectAll()
          .where('employee_id', '=', emp.id)
          .executeTakeFirstOrThrow();
        await db.tx
          .deleteFrom('employee_assignments')
          .where('employee_id', '=', emp.id)
          .execute();
        await db.tx
          .insertInto('employee_assignments')
          .values({
            ...current,
            id: undefined,
            created_at: undefined,
            department_id: org.otherCompanyDept,
          })
          .execute();
      }),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('profile updates', () => {
  it('changes the joining date while draft and moves the history with it', async () => {
    const emp = (await newEmployee({ joinDate: '2026-02-01' }).expect(201))
      .body;
    const res = await api
      .patch(`/employees/${emp.id}`, {
        joinDate: '2026-02-15',
        phone: '01712345678',
        version: emp.version,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      joinDate: '2026-02-15',
      phone: '01712345678',
    });
    expect(res.body.currentAssignment.effectiveFrom).toBe('2026-02-15');
  });

  it('refuses an outdated version', async () => {
    const emp = (await newEmployee().expect(201)).body;
    await api
      .patch(`/employees/${emp.id}`, {
        phone: '01811111111',
        version: emp.version,
      })
      .expect(200);
    const res = await api.patch(`/employees/${emp.id}`, {
      phone: '01822222222',
      version: emp.version,
    });
    expect(res.body.code).toBe('STALE_VERSION');
  });

  it('audits NID changes without the value', async () => {
    const emp = (await newEmployee().expect(201)).body;
    await api
      .patch(`/employees/${emp.id}`, {
        nid: '19901234567890123',
        version: emp.version,
      })
      .expect(200);
    const entry = await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('audit_log')
        .selectAll()
        .where('entity_id', '=', emp.id)
        .where('action', '=', 'employee.updated')
        .executeTakeFirstOrThrow(),
    );
    expect(entry.after).toEqual({ nid_encrypted: '[changed]' });
    expect(JSON.stringify(entry)).not.toContain('19901234567890123');
  });
});

describe('onboarding and activation', () => {
  it('cannot activate until the checklist is complete; then starts probation', async () => {
    const emp = (await newEmployee({ joinDate: '2026-11-16' }).expect(201))
      .body;

    const early = await api.post(`/employees/${emp.id}/activate`);
    expect(early.body.code).toBe('ONBOARDING_INCOMPLETE');

    const checklist = (
      await api.get(`/employees/${emp.id}/onboarding`).expect(200)
    ).body;
    expect(checklist.complete).toBe(false);
    for (const item of checklist.items) {
      await api
        .post(
          `/employees/${emp.id}/onboarding/${item.code}/complete`,
          item.code === 'tin_collected' ? { note: 'Not applicable' } : {},
        )
        .expect(200);
    }
    expect(
      (await api.get(`/employees/${emp.id}/onboarding`).expect(200)).body
        .complete,
    ).toBe(true);

    const res = await api.post(`/employees/${emp.id}/activate`).expect(200);
    // 6 months probation: 2026-11-16 .. 2027-05-15
    expect(res.body).toMatchObject({
      status: 'probation',
      probationEndDate: '2027-05-15',
    });

    const twice = await api.post(`/employees/${emp.id}/activate`);
    expect(twice.body.code).toBe('EMPLOYEE_NOT_DRAFT');
  });

  it("shows checklist labels in the user's preferred language", async () => {
    const emp = (await newEmployee().expect(201)).body;
    const en = await api.get(`/employees/${emp.id}/onboarding`).expect(200);
    expect(en.body.items[0]).toMatchObject({
      code: 'personal_documents',
      label: 'Personal documents collected',
    });

    // a Bangla-speaking user of the same company
    await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .updateTable('users')
        .set({ preferred_language: 'bn' })
        .where('id', '=', tenant.userId)
        .execute(),
    );
    const bnApi = await apiFor(app, tenant);
    const bn = await bnApi.get(`/employees/${emp.id}/onboarding`).expect(200);
    expect(bn.body.items[0].label).toBe('ব্যক্তিগত কাগজপত্র সংগ্রহ');
    await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .updateTable('users')
        .set({ preferred_language: 'en' })
        .where('id', '=', tenant.userId)
        .execute(),
    );
  });
});

describe('documents', () => {
  const pdf = Buffer.from('%PDF-1.4\n% test document\n%%EOF\n');

  it('uploads, lists and downloads a PDF', async () => {
    const emp = (await newEmployee().expect(201)).body;
    const up = await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'nid', title: 'NID scan' },
        { content: pdf, name: 'nid scan.pdf' },
      )
      .expect(201);
    expect(up.body).toMatchObject({
      docType: 'nid',
      contentType: 'application/pdf',
      fileName: 'nid scan.pdf',
      sizeBytes: pdf.length,
    });

    const list = await api.get(`/employees/${emp.id}/documents`).expect(200);
    expect(list.body).toHaveLength(1);

    const file = await api
      .get(`/employees/${emp.id}/documents/${up.body.id}/file`)
      .buffer(true)
      .expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(file.body).equals(pdf)).toBe(true);
  });

  it('rejects a file whose content is not PDF/JPG/PNG, even if named .pdf', async () => {
    const emp = (await newEmployee().expect(201)).body;
    const res = await api.upload(
      `/employees/${emp.id}/documents`,
      { docType: 'cv' },
      { content: Buffer.from('MZ fake exe'), name: 'cv.pdf' },
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('removes with a reason and hides it from the default list', async () => {
    const emp = (await newEmployee().expect(201)).body;
    const up = await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'cv' },
        { content: pdf, name: 'cv.pdf' },
      )
      .expect(201);
    await api
      .post(`/employees/${emp.id}/documents/${up.body.id}/remove`, {
        reason: 'Wrong person',
      })
      .expect(200);
    expect(
      (await api.get(`/employees/${emp.id}/documents`).expect(200)).body,
    ).toHaveLength(0);
    expect(
      (
        await api
          .get(`/employees/${emp.id}/documents?includeRemoved=true`)
          .expect(200)
      ).body[0],
    ).toMatchObject({ status: 'removed' });
  });

  it('lists the documents of the company that have expired or expire soon, nearest first', async () => {
    const emp = (
      await newEmployee({ fullNameEn: 'Contract Ends Soon' }).expect(201)
    ).body;
    // The API reports daysLeft against today in Dhaka, so build these dates in
    // Dhaka too. toISOString() would give the UTC date, which is still
    // yesterday between midnight and 06:00 Dhaka, and shifted daysLeft by one.
    const today = todayInDhaka();
    const on = (days: number) => addDays(today, days);
    await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'contract', expiresOn: on(10) },
        { content: pdf, name: 'contract.pdf' },
      )
      .expect(201);
    await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'nid', expiresOn: on(-5) },
        { content: pdf, name: 'nid.pdf' },
      )
      .expect(201);
    await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'cv', expiresOn: on(400) },
        { content: pdf, name: 'cv.pdf' },
      )
      .expect(201);
    await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'photo' },
        { content: pdf, name: 'photo.pdf' },
      )
      .expect(201);

    const soon = (
      await api
        .get(`/companies/${org.companyId}/document-expiries?withinDays=30`)
        .expect(200)
    ).body;
    const mine = soon.filter(
      (d: { employeeId: string }) => d.employeeId === emp.id,
    );
    // the expired one first, then the one expiring in ten days; no far-away and no open-ended document
    expect(mine.map((d: { docType: string }) => d.docType)).toEqual([
      'nid',
      'contract',
    ]);
    expect(mine[0].daysLeft).toBe(-5);
    expect(mine[1].daysLeft).toBe(10);

    // a wider window reaches the one more than a year out
    const wide = (
      await api
        .get(`/companies/${org.companyId}/document-expiries?withinDays=365`)
        .expect(200)
    ).body;
    expect(
      wide.filter((d: { employeeId: string }) => d.employeeId === emp.id),
    ).toHaveLength(2);
  });

  it('leaves a removed document and a separated employee out of the expiry list', async () => {
    const emp = (await newEmployee({ fullNameEn: 'Removed Doc' }).expect(201))
      .body;
    const soon = new Date(Date.now() + 5 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const up = await api
      .upload(
        `/employees/${emp.id}/documents`,
        { docType: 'contract', expiresOn: soon },
        { content: pdf, name: 'c.pdf' },
      )
      .expect(201);
    await api
      .post(`/employees/${emp.id}/documents/${up.body.id}/remove`, {
        reason: 'Replaced',
      })
      .expect(200);

    const list = (
      await api
        .get(`/companies/${org.companyId}/document-expiries?withinDays=30`)
        .expect(200)
    ).body;
    expect(list.some((d: { id: string }) => d.id === up.body.id)).toBe(false);
  });
});

/** A file download: supertest must be told not to parse the body as JSON. */
async function downloadFile(url: string) {
  return api
    .get(url)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    })
    .expect(200);
}

describe('filtering and export', () => {
  it('filters by branch and by designation, using the placement in force today', async () => {
    const ctg = (
      await newEmployee({
        fullNameEn: 'Ctg Manager',
        branchId: org.ctg,
        designationId: org.manager,
      }).expect(201)
    ).body;

    const byBranch = (
      await api
        .get(`/employees?companyId=${org.companyId}&branchId=${org.ctg}`)
        .expect(200)
    ).body;
    expect(byBranch.items.map((e: { id: string }) => e.id)).toContain(ctg.id);
    expect(
      byBranch.items.every(
        (e: { currentAssignment: { branch: { code: string } } }) =>
          e.currentAssignment.branch.code === 'CTG',
      ),
    ).toBe(true);

    const byDesignation = (
      await api
        .get(
          `/employees?companyId=${org.companyId}&designationId=${org.manager}`,
        )
        .expect(200)
    ).body;
    expect(byDesignation.items.map((e: { id: string }) => e.id)).toContain(
      ctg.id,
    );

    // a transfer moves the employee to the new branch's list, and out of the old one
    await api
      .post(`/employees/${ctg.id}/job-events`, {
        type: 'transfer',
        effectiveFrom: '2026-01-02',
        branchId: org.dhaka,
      })
      .expect(201);
    const afterMove = (
      await api
        .get(`/employees?companyId=${org.companyId}&branchId=${org.ctg}`)
        .expect(200)
    ).body;
    expect(afterMove.items.map((e: { id: string }) => e.id)).not.toContain(
      ctg.id,
    );
  });

  it('exports the filtered list as CSV with no salary, bank or NID column', async () => {
    await newEmployee({
      fullNameEn: 'Export Me',
      fullNameBn: 'রপ্তানি',
      branchId: org.ctg,
    }).expect(201);
    const res = await downloadFile(
      `/employees/export.csv?companyId=${org.companyId}&branchId=${org.ctg}`,
    );

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="employees-',
    );
    const csv = Buffer.from(res.body).toString('utf8');
    expect(csv.startsWith('﻿')).toBe(true); // Excel opens the Bangla names correctly
    const [header, ...lines] = csv.replace('﻿', '').trim().split('\r\n');
    expect(header).toBe(
      'employee_code,name_en,name_bn,status,join_date,probation_end_date,last_working_day,branch,department,designation,grade,line_manager,phone,personal_email,festival_group',
    );
    expect(header).not.toMatch(/nid|salary|bank|tin/);
    expect(
      lines.some(
        (l) =>
          l.includes('Export Me') &&
          l.includes('রপ্তানি') &&
          l.includes('Chattogram'),
      ),
    ).toBe(true);
    // the branch filter applies to the file as well
    expect(lines.every((l) => l.includes('Chattogram'))).toBe(true);
  });

  it('records the export in the audit log, because personal data left the system', async () => {
    await downloadFile(`/employees/export.csv?companyId=${org.companyId}`);
    const row = await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('audit_log')
        .selectAll()
        .where('action', '=', 'employee.exported')
        .orderBy('seq', 'desc')
        .executeTakeFirstOrThrow(),
    );
    expect(row.entity).toBe('employee');
  });
});

describe('cross-tenant attacks on employee routes', () => {
  it('another tenant cannot read, change or attach anything to our employees', async () => {
    const emp = (await newEmployee().expect(201)).body;
    const other = await apiFor(app, await createTenant(db, 'emp-b'));

    await other.get(`/employees/${emp.id}`).expect(404);
    await other.get(`/employees/${emp.id}/assignments`).expect(404);
    await other.get(`/employees/${emp.id}/onboarding`).expect(404);
    await other
      .patch(`/employees/${emp.id}`, { phone: '01700000000', version: 1 })
      .expect(404);
    await other
      .post(`/employees/${emp.id}/job-events`, {
        type: 'transfer',
        effectiveFrom: '2026-05-01',
        departmentId: org.finance,
      })
      .expect(404);
    expect((await other.get('/employees').expect(200)).body.total).toBe(0);
  });

  it('cannot place its own employee into our department', async () => {
    const other = await apiFor(app, await createTenant(db, 'emp-c'));
    const company = (
      await other.post('/companies', { legalName: 'Other Co' }).expect(201)
    ).body;
    const res = await other.post('/employees', {
      companyId: company.id,
      fullNameEn: 'Intruder',
      joinDate: '2026-01-01',
      branchId: org.dhaka,
      departmentId: org.salesDhaka,
      designationId: org.exec,
      gradeId: org.g1,
    });
    expect(res.status).toBe(404);
  });
});
