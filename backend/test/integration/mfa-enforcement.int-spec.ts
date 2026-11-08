/**
 * Spec §11 with SECURITY_MFA_ENFORCED=true (as in production):
 *   - 2FA is mandatory for Admin, System Admin, HR and Accounts;
 *   - granting roles needs a fresh step-up code (X-OTP-Code), usable once;
 *   - ordinary employees are not forced to use 2FA;
 *   - an employee without 2FA can still ask for a new salary account (HR approves it).
 */
import type { INestApplication } from '@nestjs/common';
import { generate } from 'otplib';
import request from 'supertest';
import { apiFor, clientWithToken, startApp } from './api-client.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

process.env.SECURITY_MFA_ENFORCED = 'true';

const db = appDb();
let app: INestApplication;
let owner: TestTenant;

beforeAll(async () => {
  app = await startApp();
  owner = await createTenant(db, 'mfa-enf');
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('mandatory 2FA for privileged roles', () => {
  let secret: string;
  let mfaToken: string;

  it('login works but asks for 2FA setup; business routes are closed until then', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        workspace: owner.slug,
        login: owner.email,
        password: owner.password,
      })
      .expect(200);
    expect(login.body.mfaSetupRequired).toBe(true);

    const api = clientWithToken(app, login.body.accessToken);
    const blocked = await api.get('/companies');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('AUTH_MFA_REQUIRED');
    await api.get('/auth/me').expect(200); // allowed, to set up 2FA

    // set up and enable 2FA: the response carries a token that counts as 2FA
    secret = (await api.post('/auth/mfa/setup').expect(200)).body.secret;
    const enabled = await api
      .post('/auth/mfa/enable', { code: await generate({ secret }) })
      .expect(200);
    mfaToken = enabled.body.accessToken;
    await clientWithToken(app, mfaToken).get('/companies').expect(200);
  });

  it('granting a role needs a fresh step-up code, which works only once', async () => {
    const api = clientWithToken(app, mfaToken);
    const company = (
      await api
        .post('/companies', { legalName: 'Padma Textiles Ltd' })
        .expect(201)
    ).body;
    const user = (
      await api
        .post('/users', {
          email: `nusrat.${Date.now()}@padma.test`,
          password: 'Padma-Pass-2026',
        })
        .expect(201)
    ).body;
    const grant = {
      role: 'accounts',
      scopeType: 'company',
      scopeId: company.id,
    };

    const noCode = await api.post(`/users/${user.id}/roles`, grant);
    expect(noCode.status).toBe(403);
    expect(noCode.body.code).toBe('AUTH_STEP_UP_REQUIRED');

    // the code of the next 30-second window (the current one was used to enable 2FA)
    const code = await generate({
      secret,
      epoch: Math.floor(Date.now() / 1000) + 30,
    });
    await api
      .post(`/users/${user.id}/roles`, grant, { 'X-OTP-Code': code })
      .expect(201);

    const reused = await api.post(
      `/users/${user.id}/roles`,
      { ...grant, role: 'hr' },
      { 'X-OTP-Code': code },
    );
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('AUTH_STEP_UP_INVALID');
  });

  it('a user without privileged roles is not forced to use 2FA', async () => {
    const api = clientWithToken(app, mfaToken);
    const email = `employee.${Date.now()}@padma.test`;
    await api
      .post('/users', { email, password: 'Padma-Pass-2026' })
      .expect(201);
    const plain = await apiFor(app, {
      slug: owner.slug,
      email,
      password: 'Padma-Pass-2026',
    });
    const me = await plain.get('/auth/me').expect(200);
    expect(me.body.roles).toEqual([]);
  });

  it('an employee without 2FA asks for a new salary account without a code; it waits for HR', async () => {
    const api = clientWithToken(app, mfaToken);
    const company = (
      await api
        .post('/companies', {
          legalName: 'Karnaphuli Shoes Ltd',
          employeeCodePrefix: 'KSL',
        })
        .expect(201)
    ).body;
    const c = `/companies/${company.id}`;
    const branch = (
      await api
        .post(`${c}/branches`, {
          code: 'CTG',
          name: 'Chattogram',
          weekendDays: ['FRI'],
        })
        .expect(201)
    ).body.id;
    const dept = (
      await api
        .post(`${c}/departments`, { code: 'PRD', name: 'Production' })
        .expect(201)
    ).body.id;
    const desig = (
      await api
        .post(`${c}/designations`, { code: 'OPR', nameEn: 'Operator' })
        .expect(201)
    ).body.id;
    const grade = (
      await api
        .post(`${c}/grades`, { code: 'W1', name: 'Worker 1' })
        .expect(201)
    ).body.id;
    const employee = (
      await api
        .post('/employees', {
          companyId: company.id,
          fullNameEn: 'Shahnaz Parvin',
          nid: '1996123456787',
          joinDate: '2026-01-01',
          branchId: branch,
          departmentId: dept,
          designationId: desig,
          gradeId: grade,
        })
        .expect(201)
    ).body;
    const email = `shahnaz.${Date.now()}@karnaphuli.test`;
    const user = (
      await api
        .post('/users', {
          email,
          password: 'Padma-Pass-2026',
          employeeId: employee.id,
        })
        .expect(201)
    ).body;
    // the employee role directly (each grant through the API needs a new step-up window)
    await db.withTenant({ tenantId: owner.id }, () =>
      db.tx
        .insertInto('user_roles')
        .values({
          user_id: user.id,
          system_role: 'employee',
          scope_type: 'own',
          scope_id: null,
        })
        .execute(),
    );

    const shahnaz = await apiFor(app, {
      slug: owner.slug,
      email,
      password: 'Padma-Pass-2026',
    });
    const body = {
      kind: 'wallet',
      walletProvider: 'bkash',
      walletNumber: '01811223344',
      accountName: 'Shahnaz Parvin',
    };
    const requested = (
      await shahnaz
        .post(`/employees/${employee.id}/bank-accounts`, body)
        .expect(201)
    ).body;
    expect(requested).toMatchObject({
      account: { status: 'pending' },
      approvalRequestId: expect.any(String),
    });

    // HR-side users (privileged) still need the code
    const noCode = await api.post(
      `/employees/${employee.id}/bank-accounts`,
      body,
    );
    expect(noCode.body.code).toBe('AUTH_STEP_UP_REQUIRED');
  });
});
