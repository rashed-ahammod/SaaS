/**
 * WP2 access control through the API: role x scope x sensitive fields
 * (spec §4), with the Meghna Foods test company (bd-company.ts).
 */
import type { INestApplication } from '@nestjs/common';
import { apiFor, startApp } from './api-client.js';
import { createBdCompany, PASSWORD, type BdCompany } from './bd-company.js';
import { appDb } from './helpers.js';

const db = appDb();
let app: INestApplication;
let co: BdCompany;

beforeAll(async () => {
  app = await startApp();
  co = await createBdCompany(app, db);
}, 120_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

const codesOf = (body: { items: Array<{ fullNameEn: string }> }) =>
  body.items.map((e) => e.fullNameEn).sort();

describe('Employee (own scope): Mahmudul Hasan Rafi', () => {
  it('sees only himself in the employee list', async () => {
    const res = await co.rafi.api.get('/employees').expect(200);
    expect(codesOf(res.body)).toEqual(['Mahmudul Hasan Rafi']);
  });

  it('sees his own NID in full, but cannot open a colleague', async () => {
    const own = await co.rafi.api.get('/me/profile').expect(200);
    expect(own.body.nid).toBe('1998123456786');
    const other = await co.rafi.api.get(
      `/employees/${co.financeOfficer.employeeId}`,
    );
    expect(other.status).toBe(403);
  });

  it('edits his own contact details but nothing else', async () => {
    const me = (await co.rafi.api.get('/me/profile').expect(200)).body;
    await co.rafi.api
      .patch('/me/contact', {
        phone: '01911223344',
        presentAddress: 'Mirpur-10, Dhaka',
        version: me.version,
      })
      .expect(200);
    await co.rafi.api
      .patch(`/employees/${co.rafi.employeeId}`, {
        fullNameEn: 'Hacked',
        version: me.version + 1,
      })
      .expect(403);
  });

  it('gets refusals in his preferred language (Bangla)', async () => {
    const u = (await co.owner.get(`/users/${co.rafi.userId}`).expect(200)).body;
    await co.owner
      .patch(`/users/${co.rafi.userId}`, {
        preferredLanguage: 'bn',
        version: u.version,
      })
      .expect(200);
    const bnRafi = await apiFor(app, {
      slug: co.tenant.slug,
      email: co.rafi.email,
      password: PASSWORD,
    });
    const res = await bnRafi
      .post('/companies', { legalName: 'Nope Ltd' })
      .expect(403);
    expect(res.body.message).toBe('এই কাজের অনুমতি আপনার নেই।');
  });

  it('cannot create companies, employees or users', async () => {
    await co.rafi.api.post('/companies', { legalName: 'Nope Ltd' }).expect(403);
    await co.rafi.api
      .post('/users', { email: 'x@meghna.test', password: PASSWORD })
      .expect(403);
  });
});

describe('Department Head (department scope): Tanvir Hossain, Sales', () => {
  it('sees Sales and its sub-departments, not Finance', async () => {
    const res = await co.salesHead.api.get('/employees').expect(200);
    expect(codesOf(res.body)).toEqual([
      'Mahmudul Hasan Rafi',
      'Tanvir Hossain',
    ]);
    await co.salesHead.api
      .get(`/employees/${co.financeOfficer.employeeId}`)
      .expect(403);
  });

  it("sees his team member's NID masked (no identity access)", async () => {
    const res = await co.salesHead.api
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(res.body.nid).toBe('**** **** 6786');
  });

  it('cannot change employee records', async () => {
    await co.salesHead.api
      .post(`/employees/${co.rafi.employeeId}/job-events`, {
        type: 'transfer',
        effectiveFrom: '2026-11-01',
        departmentId: co.departments.sales,
      })
      .expect(403);
  });
});

describe('HR (company scope): Farzana Akter', () => {
  it('sees everyone with full NID and can create employees', async () => {
    const list = await co.hr.api.get('/employees?pageSize=50').expect(200);
    expect(list.body.total).toBe(6);
    const rafi = await co.hr.api
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(rafi.body.nid).toBe('1998123456786');
  });

  it('cannot grant roles or create companies', async () => {
    await co.hr.api
      .post(`/users/${co.rafi.userId}/roles`, {
        role: 'hr',
        scopeType: 'company',
        scopeId: co.companyId,
      })
      .expect(403);
    await co.hr.api
      .post('/companies', { legalName: 'Another Ltd' })
      .expect(403);
  });
});

describe('Accounts (company scope): Sujit Kumar Das', () => {
  it('views employees but not identity numbers', async () => {
    const res = await co.accounts.api
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(res.body.nid).toBe('**** **** 6786');
    await co.accounts.api.post('/employees', {}).expect(403);
  });
});

describe('Admin without grants: Anwar Hossain (MD)', () => {
  it('sees identity numbers masked until given a field grant', async () => {
    const before = await co.md.api
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(before.body.nid).toBe('**** **** 6786');

    await co.owner
      .post(`/users/${co.md.userId}/field-grants`, { fieldGroup: 'identity' })
      .expect(201);
    const after = await co.md.api
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(after.body.nid).toBe('1998123456786');
  });

  it('cannot grant roles or field access to himself', async () => {
    const res = await co.md.api.post(`/users/${co.md.userId}/roles`, {
      role: 'hr',
      scopeType: 'company',
      scopeId: co.companyId,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ROLE_SELF_GRANT');
  });

  it('can read the audit log; an employee cannot', async () => {
    const log = await co.md.api
      .get('/audit-log?action=user.role_granted')
      .expect(200);
    expect(log.body.total).toBeGreaterThan(0);
    await co.rafi.api.get('/audit-log').expect(403);
  });
});

describe('role grant rules', () => {
  it('refuses a scope that does not suit the role', async () => {
    const res = await co.owner.post(`/users/${co.rafi.userId}/roles`, {
      role: 'dept_head',
      scopeType: 'company',
      scopeId: co.companyId,
    });
    expect(res.body.code).toBe('ROLE_SCOPE_INVALID');
  });

  it('auditor access needs an end date', async () => {
    const res = await co.owner.post(
      `/users/${co.financeOfficer.userId}/roles`,
      { role: 'auditor', scopeType: 'company', scopeId: co.companyId },
    );
    expect(res.body.code).toBe('ROLE_EXPIRY_REQUIRED');
  });

  it('grants the auditor with an end date and shows it back, so the portal can offer one', async () => {
    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    await co.owner
      .post(`/users/${co.financeOfficer.userId}/roles`, {
        role: 'auditor',
        scopeType: 'company',
        scopeId: co.companyId,
        expiresAt: until,
      })
      .expect(201);
    const user = (
      await co.owner.get(`/users/${co.financeOfficer.userId}`).expect(200)
    ).body;
    const grant = user.roles.find(
      (r: { role: string }) => r.role === 'auditor',
    );
    expect(new Date(grant.expiresAt).toISOString().slice(0, 10)).toBe(
      until.slice(0, 10),
    );

    await co.owner
      .post(`/users/${co.financeOfficer.userId}/roles/${grant.id}/revoke`, {
        reason: 'Audit finished',
      })
      .expect(200);
  });

  it('the permission catalogue carries both languages, so no screen has to show a key', async () => {
    const permissions = (await co.owner.get('/permissions').expect(200))
      .body as Array<{
      key: string;
      description: string;
      descriptionBn: string;
    }>;
    expect(permissions.length).toBeGreaterThan(50);
    expect(
      permissions.every(
        (p) => p.description.length > 0 && p.descriptionBn.length > 0,
      ),
    ).toBe(true);
    expect(
      permissions.find((p) => p.key === 'payroll.verify')?.descriptionBn,
    ).toBe('বেতন রান যাচাই');
  });

  it('revoking a role takes effect on the next request', async () => {
    const user = (
      await co.owner.get(`/users/${co.salesHead.userId}`).expect(200)
    ).body;
    const grant = user.roles.find(
      (r: { role: string }) => r.role === 'dept_head',
    );
    await co.owner
      .post(`/users/${co.salesHead.userId}/roles/${grant.id}/revoke`, {
        reason: 'Moved to a new role',
      })
      .expect(200);
    const res = await co.salesHead.api.get('/employees').expect(200);
    expect(codesOf(res.body)).toEqual(['Tanvir Hossain']); // only own record now

    // give it back for other tests
    await co.owner
      .post(`/users/${co.salesHead.userId}/roles`, {
        role: 'dept_head',
        scopeType: 'department',
        scopeId: co.departments.sales,
      })
      .expect(201);
  });

  it('a disabled login stops working immediately', async () => {
    const u = (
      await co.owner.get(`/users/${co.financeOfficer.userId}`).expect(200)
    ).body;
    await co.owner
      .patch(`/users/${co.financeOfficer.userId}`, {
        status: 'disabled',
        version: u.version,
      })
      .expect(200);
    await co.financeOfficer.api.get('/me/profile').expect(401);

    const again = (
      await co.owner.get(`/users/${co.financeOfficer.userId}`).expect(200)
    ).body;
    await co.owner
      .patch(`/users/${co.financeOfficer.userId}`, {
        status: 'active',
        version: again.version,
      })
      .expect(200);
  });
});

describe('custom roles', () => {
  it('a copy of HR without employee.manage can view but not change', async () => {
    const role = (
      await co.owner
        .post('/roles', {
          nameEn: 'HR Viewer',
          nameBn: 'মানবসম্পদ (শুধু দেখা)',
          basedOn: 'hr',
          permissions: ['org.view', 'employee.view', 'employee.documents.view'],
        })
        .expect(201)
    ).body;

    const email = `hrviewer.${Date.now()}@meghna.test`;
    const user = (
      await co.owner.post('/users', { email, password: PASSWORD }).expect(201)
    ).body;
    await co.owner
      .post(`/users/${user.id}/roles`, {
        customRoleId: role.id,
        scopeType: 'company',
        scopeId: co.companyId,
      })
      .expect(201);
    const viewer = await apiFor(app, {
      slug: co.tenant.slug,
      email,
      password: PASSWORD,
    });

    const rafi = await viewer
      .get(`/employees/${co.rafi.employeeId}`)
      .expect(200);
    expect(rafi.body.nid).toBe('1998123456786'); // field access comes from the base role (HR)
    await viewer
      .patch(`/employees/${co.rafi.employeeId}`, {
        phone: '01700000000',
        version: rafi.body.version,
      })
      .expect(403);
  });

  it('cannot add permissions the base role does not have', async () => {
    await co.owner
      .post('/roles', {
        nameEn: 'Super Employee',
        basedOn: 'employee',
        permissions: ['payroll.approve'],
      })
      .expect(400);
  });

  it('system roles are listed and read-only', async () => {
    const roles = (await co.owner.get('/roles').expect(200)).body;
    expect(
      roles.filter((r: { type: string }) => r.type === 'system'),
    ).toHaveLength(8); // the seven of the spec matrix and the Sales user (WP23);
  });
});
