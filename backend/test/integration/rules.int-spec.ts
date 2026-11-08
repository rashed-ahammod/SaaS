/**
 * WP3 rule pack. Acceptance criterion (guide §24): an unverified value blocks
 * production use.
 */
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { AccessService } from '../../src/modules/identity/access/access.service.js';
import {
  publishRulePack,
  unverifyRuleValue,
  verifyRuleValue,
} from '../../src/modules/rules/rule-pack-admin.js';
import type { RulePackFile } from '../../src/modules/rules/rule-pack-file.js';
import { RulesService } from '../../src/modules/rules/rules.service.js';
import { AuditService } from '../../src/platform/audit/audit.service.js';
import { businessDate } from '../../src/platform/dates/business-date.js';
import { apiFor, startApp, type Api } from './api-client.js';
import {
  appDb,
  config,
  createTenant,
  ownerDb,
  type TestTenant,
} from './helpers.js';

const db = appDb();
const owner = ownerDb();
let app: INestApplication;
let tenant: TestTenant;
let admin: Api;
let bdPackId: string;

/** A small pack of our own, so verifying values never touches the shared BD pack. */
const testPack = (): RulePackFile => ({
  code: `TEST-${randomUUID().slice(0, 6).toUpperCase()}`,
  version: '2026.2',
  title: 'Test pack',
  values: [
    {
      key: 'leave.maternity.days',
      type: 'integer',
      unit: 'days',
      value: 126,
      effectiveFrom: '2026-01-01',
      descriptionEn: 'Maternity (test value)',
    },
    {
      key: 'overtime.rate_multiplier',
      type: 'decimal',
      value: '2',
      effectiveFrom: '2026-01-01',
      descriptionEn: 'OT multiplier (test)',
    },
  ],
});

beforeAll(async () => {
  app = await startApp();
  tenant = await createTenant(db, 'rules');
  admin = await apiFor(app, tenant);
  const packs = (await admin.get('/rule-packs').expect(200)).body.packs;
  bdPackId = packs.find(
    (p: { code: string; version: string }) =>
      p.code === 'BD-LABOUR' && p.version === '2026.1',
  ).id;
});

afterAll(async () => {
  await app.close();
  await Promise.all([db.close(), owner.close()]);
});

describe('the shipped Bangladesh pack', () => {
  it('is published with every value still to verify', async () => {
    const packs = (await admin.get('/rule-packs').expect(200)).body.packs;
    expect(packs.find((p: { id: string }) => p.id === bdPackId)).toMatchObject({
      values: 24,
      unverifiedValues: 24,
    });

    const pack = (await admin.get(`/rule-packs/${bdPackId}`).expect(200)).body;
    const maternity = pack.values.filter(
      (v: { key: string }) => v.key === 'leave.maternity.days',
    );
    expect(
      maternity.map(
        (v: { value: number; status: string }) => `${v.value}:${v.status}`,
      ),
    ).toEqual(['112:verify', '120:verify']);
    expect(maternity[1].history[0]).toMatchObject({ action: 'published' });
  });

  it('cannot be used before the company accepts a version', async () => {
    const res = await admin.get('/rules/leave.maternity.days?date=2026-05-01');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('RULE_PACK_NOT_ACCEPTED');
  });

  it('after acceptance, values follow their effective dates (2025 amendment)', async () => {
    const accepted = await admin
      .post(`/rule-packs/${bdPackId}/accept`, {
        effectiveFrom: '2025-01-01',
        note: 'Board decision',
      })
      .expect(201);
    expect(accepted.body.unverifiedRules).toContain('leave.maternity.days');
    expect(accepted.body.warning).toMatch(/not verified/);

    const before = await admin
      .get('/rules/leave.maternity.days?date=2026-03-01')
      .expect(200);
    const after = await admin
      .get('/rules/leave.maternity.days?date=2026-05-01')
      .expect(200);
    expect([before.body.value, after.body.value]).toEqual([112, 120]);

    const festival = await admin
      .get('/rules/holidays.festival.days_per_year?date=2026-12-01')
      .expect(200);
    expect(festival.body).toMatchObject({
      value: 13,
      status: 'verify',
      pack: 'BD-LABOUR 2026.1',
    });
  });

  it('lists every rule in force on a date and says it is not production-ready', async () => {
    const res = await admin.get('/rules?date=2026-08-01').expect(200);
    expect(res.body.usableInProduction).toBe(false);
    expect(res.body.rules.map((r: { key: string }) => r.key)).toContain(
      'tax.salary.slabs',
    );
    expect(
      res.body.rules.find((r: { key: string }) => r.key === 'tax.salary.slabs')
        .value[0],
    ).toEqual({ upTo: '375000.00', rate: '0' });
  });

  it('a rule missing on a date is a clear error', async () => {
    const res = await admin.get('/rules/tax.salary.slabs?date=2026-01-01'); // slabs start 2026-07-01
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: 'RULE_NOT_FOUND',
      details: { key: 'tax.salary.slabs' },
    });
  });
});

describe('a newer pack version accepted from a later date', () => {
  it('answers from the date it was accepted; earlier dates keep the old pack', async () => {
    const file = testPack();
    const { packId } = await publishRulePack(owner.kysely, file, 'test');
    await admin
      .post(`/rule-packs/${packId}/accept`, { effectiveFrom: '2026-09-01' })
      .expect(201);

    const june = await admin
      .get('/rules/leave.maternity.days?date=2026-06-01')
      .expect(200);
    const october = await admin
      .get('/rules/leave.maternity.days?date=2026-10-01')
      .expect(200);
    expect(june.body).toMatchObject({ value: 120, pack: 'BD-LABOUR 2026.1' });
    expect(october.body).toMatchObject({
      value: 126,
      pack: `${file.code} 2026.2`,
    });
  });
});

describe('acceptance: an unverified value blocks production use', () => {
  it('is refused in production, allowed after verification, refused again after unverify', async () => {
    // a tenant using a pack of its own
    const t = await createTenant(db, 'rules-prod');
    const file = testPack();
    const { packId } = await publishRulePack(owner.kysely, file, 'test');
    const tAdmin = await apiFor(app, t);
    await tAdmin
      .post(`/rule-packs/${packId}/accept`, { effectiveFrom: '2026-01-01' })
      .expect(201);

    // the same service as in the app, but configured as production
    const production = new RulesService(
      db,
      new AuditService(db),
      new AccessService(db),
      { ...config, isProduction: true },
    );
    const get = () =>
      db.withTenant({ tenantId: t.id, access: AccessGrants.system() }, () =>
        production.getInteger(
          'leave.maternity.days',
          businessDate('2026-10-01'),
        ),
      );

    // 1. unverified: refused, naming the rule
    await expect(get()).rejects.toMatchObject({
      response: {
        message: 'RULE_NOT_VERIFIED',
        details: { key: 'leave.maternity.days' },
      },
    });

    // 2. the compliance owner verifies it against the official source
    const selector = {
      code: file.code,
      version: file.version,
      key: 'leave.maternity.days',
    };
    await verifyRuleValue(owner.kysely, selector, {
      by: 'Adv. Nasrin Sultana (labour counsel)',
      sourceUrl: 'http://bdlaws.minlaw.gov.bd/act-952.html',
    });
    await expect(get()).resolves.toBe(126);

    // 3. taken back to "verify": refused again
    await unverifyRuleValue(owner.kysely, selector, {
      by: 'Adv. Nasrin Sultana (labour counsel)',
      reason: 'Amendment under review',
    });
    await expect(get()).rejects.toMatchObject({
      response: { message: 'RULE_NOT_VERIFIED' },
    });

    // the history shows all three steps
    const pack = (await tAdmin.get(`/rule-packs/${packId}`).expect(200)).body;
    const value = pack.values.find(
      (v: { key: string }) => v.key === 'leave.maternity.days',
    );
    expect(value.history.map((h: { action: string }) => h.action)).toEqual([
      'published',
      'verified',
      'unverified',
    ]);
  });

  it('development and tests may use unverified values', async () => {
    const res = await admin
      .get('/rules/overtime.rate_multiplier?date=2026-06-01')
      .expect(200);
    expect(res.body).toMatchObject({ value: '2', status: 'verify' });
  });

  it('verification needs a person and an official source URL', async () => {
    const file = testPack();
    await publishRulePack(owner.kysely, file, 'test');
    await expect(
      verifyRuleValue(
        owner.kysely,
        {
          code: file.code,
          version: file.version,
          key: 'overtime.rate_multiplier',
        },
        { by: 'Someone', sourceUrl: 'a blog post' },
      ),
    ).rejects.toThrow(/official source/);
  });
});

describe('published values are permanent', () => {
  it('a value cannot be edited or deleted, even by the table owner', async () => {
    const file = testPack();
    const { packId } = await publishRulePack(owner.kysely, file, 'test');
    await expect(
      owner.kysely
        .updateTable('rule_values')
        .set({ value: JSON.stringify(999) })
        .where('pack_id', '=', packId)
        .execute(),
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      owner.kysely
        .deleteFrom('rule_values')
        .where('pack_id', '=', packId)
        .execute(),
    ).rejects.toThrow(/never deleted/);
  });

  it('publishing the same version again changes nothing', async () => {
    const file = testPack();
    const first = await publishRulePack(owner.kysely, file, 'test');
    const again = await publishRulePack(
      owner.kysely,
      { ...file, values: [{ ...file.values[0], value: 1 }] },
      'test',
    );
    expect(again).toEqual({ packId: first.packId, created: false });
  });

  it('the API role cannot write central rule tables', async () => {
    await expect(
      db.withTenant({ tenantId: tenant.id }, () =>
        db.tx
          .updateTable('rule_values')
          .set({ status: 'verified' })
          .where('pack_id', '=', bdPackId)
          .execute(),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('who may do what', () => {
  it('HR can read rules but only Admin can accept a version; employees see nothing', async () => {
    const company = (
      await admin
        .post('/companies', {
          legalName: `Jamuna Agro Ltd ${randomUUID().slice(0, 4)}`,
        })
        .expect(201)
    ).body;
    const make = async (role: string, scope: object) => {
      const email = `${role}.${randomUUID().slice(0, 6)}@jamuna.test`;
      const user = (
        await admin
          .post('/users', { email, password: 'Jamuna-Pass-2026' })
          .expect(201)
      ).body;
      await admin
        .post(`/users/${user.id}/roles`, { role, ...scope })
        .expect(201);
      return apiFor(app, {
        slug: tenant.slug,
        email,
        password: 'Jamuna-Pass-2026',
      });
    };
    const hr = await make('hr', { scopeType: 'company', scopeId: company.id });
    await hr.get('/rules/leave.sick.days_per_year?date=2026-06-01').expect(200);
    await hr
      .post(`/rule-packs/${bdPackId}/accept`, { effectiveFrom: '2027-01-01' })
      .expect(403);

    // a login with only the Employee role
    const email = `rahim.${randomUUID().slice(0, 6)}@jamuna.test`;
    await admin
      .post('/users', { email, password: 'Jamuna-Pass-2026' })
      .expect(201);
    const employee = await apiFor(app, {
      slug: tenant.slug,
      email,
      password: 'Jamuna-Pass-2026',
    });
    await employee.get('/rule-packs').expect(403);
  });

  it('acceptance is per tenant: another company has not accepted anything', async () => {
    const other = await apiFor(app, await createTenant(db, 'rules-other'));
    const res = await other.get('/rules/leave.maternity.days?date=2026-05-01');
    expect(res.body.code).toBe('RULE_PACK_NOT_ACCEPTED');
  });
});
