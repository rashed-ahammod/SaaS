/**
 * End-to-end through HTTP with the real Nest app: login, 2FA, guards, error
 * format, and idempotent write endpoints.
 */
import {
  Body,
  Controller,
  INestApplication,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generate } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AuthGuard } from '../../src/modules/identity/auth.guard.js';
import { IdentityModule } from '../../src/modules/identity/identity.module.js';
import { AuditService } from '../../src/platform/audit/audit.service.js';
import { OutboxService } from '../../src/platform/outbox/outbox.service.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

/** A small write endpoint used only by this test, shaped like a real business route. */
@Controller('test-items')
class TestItemsController {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  @UseGuards(AuthGuard)
  @Post()
  async create(@Body() body: Record<string, unknown>) {
    const eventId = await this.outbox.add({
      type: 'test.item_created',
      payload: { name: String(body.name) },
    });
    await this.audit.record({
      action: 'test.item_created',
      entity: 'test_item',
      after: body,
    });
    return { eventId };
  }
}

let app: INestApplication;
const db = appDb();
let t: TestTenant;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, IdentityModule],
    controllers: [TestItemsController],
  }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  t = await createTenant(db, 'http');
});

afterAll(async () => {
  await app.close();
  await db.close();
});

const http = () => request(app.getHttpServer());

async function loginToken(tenant: TestTenant = t): Promise<string> {
  const res = await http().post('/auth/login').send({
    workspace: tenant.slug,
    login: tenant.email,
    password: tenant.password,
  });
  expect(res.status).toBe(200);
  return res.body.accessToken;
}

describe('health', () => {
  it('reports ok', async () => {
    await http().get('/health').expect(200, { status: 'ok', database: 'ok' });
  });

  it('sends security headers and hides the framework (WP12)', async () => {
    const res = await http().get('/health').expect(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'cache-control': 'no-store',
    });
  });

  it('refuses a JSON body over 1 MB', async () => {
    await http()
      .post('/auth/login')
      .send({ workspace: 'x', login: 'y', password: 'z'.repeat(1_100_000) })
      .expect(413);
  });
});

describe('login', () => {
  it('returns an access token for correct credentials', async () => {
    const token = await loginToken();
    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body).toMatchObject({
      id: t.userId,
      tenantId: t.id,
      email: t.email,
    });
    expect(me.body.roles).toEqual(
      expect.arrayContaining(['system_admin:group', 'admin:group', 'hr:group']),
    );
    // what the apps may show (the API still checks every request)
    expect(me.body.permissions).toEqual(
      expect.arrayContaining([
        'employee.manage',
        'payroll.prepare',
        'users.manage',
      ]),
    );
    expect(me.body.permissions).not.toContain('payroll.verify');
    expect(me.body.password_hash).toBeUndefined();
    expect(me.body.mfa_secret).toBeUndefined();
  });

  it('gives the same answer for unknown workspace, unknown user and wrong password', async () => {
    const attempts = [
      { workspace: 'no-such-workspace', login: t.email, password: t.password },
      { workspace: t.slug, login: 'nobody@x.test', password: t.password },
      { workspace: t.slug, login: t.email, password: 'wrong-password' },
    ];
    for (const body of attempts) {
      const res = await http().post('/auth/login').send(body);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
  });

  it('answers in Bangla when asked', async () => {
    const res = await http()
      .post('/auth/login')
      .set('Accept-Language', 'bn-BD')
      .send({ workspace: t.slug, login: t.email, password: 'wrong-password' });
    expect(res.body.message).toBe(
      'ওয়ার্কস্পেস, ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।',
    );
  });

  it('the app language switch (X-Language) wins over the saved preference', async () => {
    const login = await http()
      .post('/auth/login')
      .send({ workspace: t.slug, login: t.email, password: t.password })
      .expect(200);
    const missing = '/approvals/requests/00000000-0000-4000-8000-000000000000';
    const asSaved = await http()
      .get(missing)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(404);
    expect(asSaved.body.message).not.toMatch(/[ঀ-৿]/); // saved preference: English
    const asked = await http()
      .get(missing)
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('X-Language', 'bn')
      .expect(404);
    expect(asked.body.message).toMatch(/[ঀ-৿]/);
  });

  it('rejects invalid bodies with field details', async () => {
    const res = await http()
      .post('/auth/login')
      .send({ workspace: t.slug, login: t.email, extra: 1 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('locks the account after 5 wrong passwords', async () => {
    const victim = await createTenant(db, 'lock');
    for (let i = 0; i < 5; i++) {
      await http().post('/auth/login').send({
        workspace: victim.slug,
        login: victim.email,
        password: 'wrong',
      });
    }
    const res = await http().post('/auth/login').send({
      workspace: victim.slug,
      login: victim.email,
      password: victim.password,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('AUTH_ACCOUNT_LOCKED');
  });

  it('rejects requests without a valid token', async () => {
    await http().get('/auth/me').expect(401);
    const res = await http()
      .get('/auth/me')
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });
});

describe('two-factor authentication', () => {
  it('can be enabled, is then required at login, and a code cannot be reused', async () => {
    const u = await createTenant(db, 'mfa');
    const token = await loginToken(u);
    const auth = { Authorization: `Bearer ${token}` };

    // set up: get secret, confirm with a code
    const setup = await http().post('/auth/mfa/setup').set(auth).expect(200);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const secret: string = setup.body.secret;
    await http()
      .post('/auth/mfa/enable')
      .set(auth)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ code: await generate({ secret }) })
      .expect(200)
      .expect((res) =>
        expect(res.body).toMatchObject({
          mfaEnabled: true,
          accessToken: expect.any(String),
        }),
      );

    // login now asks for the second step
    const step1 = await http()
      .post('/auth/login')
      .send({ workspace: u.slug, login: u.email, password: u.password })
      .expect(200);
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(step1.body.accessToken).toBeUndefined();

    // the mfa token is not an access token
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${step1.body.mfaToken}`)
      .expect(401);

    // a code from the next 30-second window (the current one was used when enabling)
    const code = await generate({
      secret,
      epoch: Math.floor(Date.now() / 1000) + 30,
    });
    const step2 = await http()
      .post('/auth/mfa/verify')
      .send({ mfaToken: step1.body.mfaToken, code })
      .expect(200);
    expect(step2.body.accessToken).toBeTruthy();

    // replaying the same code fails
    const replay = await http()
      .post('/auth/mfa/verify')
      .send({ mfaToken: step1.body.mfaToken, code });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('AUTH_MFA_INVALID_CODE');
  });
});

describe('idempotent write endpoints', () => {
  let token: string;
  beforeAll(async () => {
    token = await loginToken();
  });

  const post = (key: string | undefined, body: object) => {
    const req = http()
      .post('/test-items')
      .set('Authorization', `Bearer ${token}`);
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };

  async function countEvents(eventId: string) {
    return db.withTenant({ tenantId: t.id }, async () => {
      const rows = await db.tx
        .selectFrom('outbox_events')
        .select('id')
        .where('type', '=', 'test.item_created')
        .execute();
      return rows.filter((r) => r.id === eventId).length;
    });
  }

  it('requires an Idempotency-Key', async () => {
    const res = await post(undefined, { name: 'a' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('returns the first result for a repeated key without running the action again', async () => {
    const key = crypto.randomUUID();
    const first = await post(key, { name: 'chair' }).expect(201);
    const second = await post(key, { name: 'chair' }).expect(201);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(await countEvents(first.body.eventId)).toBe(1);

    const events = await db.withTenant({ tenantId: t.id }, () =>
      db.tx
        .selectFrom('outbox_events')
        .select('id')
        .where('payload', '@>', JSON.stringify({ name: 'chair' }))
        .execute(),
    );
    expect(events).toHaveLength(1);
  });

  it('handles a double-click (two requests at the same time) as one action', async () => {
    const key = crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      post(key, { name: 'desk' }),
      post(key, { name: 'desk' }),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(r1.body.eventId).toBe(r2.body.eventId);

    const events = await db.withTenant({ tenantId: t.id }, () =>
      db.tx
        .selectFrom('outbox_events')
        .select('id')
        .where('payload', '@>', JSON.stringify({ name: 'desk' }))
        .execute(),
    );
    expect(events).toHaveLength(1);
  });

  it('rejects the same key with a different body', async () => {
    const key = crypto.randomUUID();
    await post(key, { name: 'lamp' }).expect(201);
    const res = await post(key, { name: 'sofa' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('keys are separate per tenant', async () => {
    const other = await createTenant(db, 'http-b');
    const otherToken = await loginToken(other);
    const key = crypto.randomUUID();
    const mine = await post(key, { name: 'shelf' }).expect(201);
    const theirs = await http()
      .post('/test-items')
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Idempotency-Key', key)
      .send({ name: 'shelf' })
      .expect(201);
    expect(theirs.body.eventId).not.toBe(mine.body.eventId);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
  });
});
