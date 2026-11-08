/**
 * A small Bangladeshi company for access-control and approval tests, built
 * through the API exactly as an admin would (synthetic data only):
 *
 *   Meghna Foods Ltd (prefix MFL), Dhaka HQ (weekend FRI + SAT)
 *     Head Office (HO)              Anwar Hossain (MD)           -> admin (company)
 *       Human Resources (HR)        Farzana Akter                -> hr (company)
 *       Finance & Accounts (FIN)    Sujit Kumar Das              -> accounts (company)
 *                                   Sumaiya Islam (officer)      -> employee
 *       Sales (SALES)               Tanvir Hossain (head)        -> dept_head (SALES) + employee
 *         Sales Dhaka (SALES-DHK)   Mahmudul Hasan Rafi          -> employee
 *
 * Every person except the workspace owner gets a login linked to their employee
 * record, plus the "employee" role (own scope).
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { apiFor, type Api } from './api-client.js';
import { createTenant, type TestTenant } from './helpers.js';
import type { DatabaseService } from '../../src/platform/db/database.service.js';

export const PASSWORD = 'Dhaka-Pass-2026';

export interface Person {
  employeeId: string;
  userId: string;
  email: string;
  api: Api;
}

export interface BdCompany {
  tenant: TestTenant;
  owner: Api;
  companyId: string;
  branchId: string;
  departments: {
    ho: string;
    hr: string;
    fin: string;
    sales: string;
    salesDhaka: string;
  };
  md: Person;
  hr: Person;
  accounts: Person;
  financeOfficer: Person;
  salesHead: Person;
  rafi: Person;
}

export async function createBdCompany(
  app: INestApplication,
  db: DatabaseService,
): Promise<BdCompany> {
  const tenant = await createTenant(db, 'meghna');
  const owner = await apiFor(app, tenant);

  // structure
  const company = (
    await owner
      .post('/companies', {
        legalName: `Meghna Foods Ltd ${randomUUID().slice(0, 4)}`,
        employeeCodePrefix: 'MFL',
      })
      .expect(201)
  ).body;
  const c = `/companies/${company.id}`;
  const branch = (
    await owner
      .post(`${c}/branches`, {
        code: 'DHK',
        name: 'Dhaka HQ',
        weekendDays: ['FRI', 'SAT'],
      })
      .expect(201)
  ).body;
  const dept = async (code: string, name: string, parentId?: string) =>
    (await owner.post(`${c}/departments`, { code, name, parentId }).expect(201))
      .body.id as string;
  const ho = await dept('HO', 'Head Office');
  const hr = await dept('HR', 'Human Resources', ho);
  const fin = await dept('FIN', 'Finance & Accounts', ho);
  const sales = await dept('SALES', 'Sales', ho);
  const salesDhaka = await dept('SALES-DHK', 'Sales Dhaka', sales);
  const desig = (
    await owner
      .post(`${c}/designations`, {
        code: 'EXE',
        nameEn: 'Executive',
        nameBn: 'এক্সিকিউটিভ',
      })
      .expect(201)
  ).body.id;
  const grade = (
    await owner.post(`${c}/grades`, { code: 'G3', name: 'Grade 3' }).expect(201)
  ).body.id;

  // people: employee record + login + roles
  const hire = async (
    nameEn: string,
    nameBn: string,
    nid: string,
    departmentId: string,
    lineManagerId: string | undefined,
    roles: Array<{ role: string; scopeType: string; scopeId?: string }>,
  ): Promise<Person> => {
    const employee = (
      await owner
        .post('/employees', {
          companyId: company.id,
          fullNameEn: nameEn,
          fullNameBn: nameBn,
          nid,
          joinDate: '2025-01-01',
          branchId: branch.id,
          departmentId,
          designationId: desig,
          gradeId: grade,
          lineManagerId,
        })
        .expect(201)
    ).body;
    // onboarding done, employee active (probation)
    for (const item of (
      await owner.get(`/employees/${employee.id}/onboarding`).expect(200)
    ).body.items) {
      await owner
        .post(`/employees/${employee.id}/onboarding/${item.code}/complete`, {})
        .expect(200);
    }
    await owner.post(`/employees/${employee.id}/activate`).expect(200);

    const email = `${nameEn.split(' ')[0].toLowerCase()}.${randomUUID().slice(0, 4)}@meghna.test`;
    const user = (
      await owner
        .post('/users', { email, password: PASSWORD, employeeId: employee.id })
        .expect(201)
    ).body;
    for (const r of [{ role: 'employee', scopeType: 'own' }, ...roles]) {
      await owner.post(`/users/${user.id}/roles`, r).expect(201);
    }
    return {
      employeeId: employee.id,
      userId: user.id,
      email,
      api: await apiFor(app, { slug: tenant.slug, email, password: PASSWORD }),
    };
  };

  const md = await hire(
    'Anwar Hossain',
    'আনোয়ার হোসেন',
    '1970123456781',
    ho,
    undefined,
    [{ role: 'admin', scopeType: 'company', scopeId: company.id }],
  );
  const hrPerson = await hire(
    'Farzana Akter',
    'ফারজানা আক্তার',
    '1985123456782',
    hr,
    md.employeeId,
    [{ role: 'hr', scopeType: 'company', scopeId: company.id }],
  );
  const accounts = await hire(
    'Sujit Kumar Das',
    'সুজিত কুমার দাস',
    '1983123456783',
    fin,
    md.employeeId,
    [{ role: 'accounts', scopeType: 'company', scopeId: company.id }],
  );
  const financeOfficer = await hire(
    'Sumaiya Islam',
    'সুমাইয়া ইসলাম',
    '1995123456784',
    fin,
    accounts.employeeId,
    [],
  );
  const salesHead = await hire(
    'Tanvir Hossain',
    'তানভীর হোসেন',
    '1987123456785',
    sales,
    md.employeeId,
    [{ role: 'dept_head', scopeType: 'department', scopeId: sales }],
  );
  const rafi = await hire(
    'Mahmudul Hasan Rafi',
    'মাহমুদুল হাসান রাফি',
    '1998123456786',
    salesDhaka,
    salesHead.employeeId,
    [],
  );

  // department heads (used by dept_head approval steps)
  for (const [deptId, head] of [
    [ho, md],
    [hr, hrPerson],
    [fin, accounts],
    [sales, salesHead],
  ] as const) {
    const d = (await owner.get(`/departments/${deptId}`).expect(200)).body;
    await owner
      .patch(`/departments/${deptId}`, {
        headEmployeeId: head.employeeId,
        version: d.version,
      })
      .expect(200);
  }

  return {
    tenant,
    owner,
    companyId: company.id,
    branchId: branch.id,
    departments: { ho, hr, fin, sales, salesDhaka },
    md,
    hr: hrPerson,
    accounts,
    financeOfficer,
    salesHead,
    rafi,
  };
}
