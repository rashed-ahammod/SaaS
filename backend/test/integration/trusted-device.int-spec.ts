/**
 * "Remember this device" (migration 0041, trusted-devices.service.ts).
 *
 * What it must do: after the code has been typed once with the box ticked, the
 * next sign-in from that device needs the password only.
 *
 * What it must NOT do, which is most of this file:
 *   - never let a wrong password through;
 *   - never work for a different user, or a made-up token;
 *   - never let high-risk actions skip the step-up code;
 *   - stop working once the device is forgotten, or the password is reset.
 */
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import request from 'supertest';
import { clientWithToken, startApp } from './api-client.js';
import { appDb, createTenant, type TestTenant } from './helpers.js';

process.env.SECURITY_MFA_ENFORCED = 'true';

const db = appDb();
let app: INestApplication;
let owner: TestTenant;
let secret: string;
let deviceToken: string;

const login = (body: Record<string, unknown>) =>
  request(app.getHttpServer())
    .post('/auth/login')
    .send({ workspace: owner.slug, login: owner.email, ...body });

/**
 * A code the server has not seen before. It refuses a code from a 30-second
 * window it already accepted (that is what stops a stolen code being replayed),
 * so each one has to come from a later window than the last.
 */
let lastWindow = -1;
async function code(): Promise<string> {
  for (;;) {
    const window = Math.floor(Date.now() / 1000 / 30);
    if (window > lastWindow) {
      lastWindow = window;
      return generate({ secret });
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

beforeAll(async () => {
  app = await startApp();
  owner = await createTenant(db, 'trusted-dev');

  // turn 2FA on for the owner (a privileged role must have it)
  const first = await login({ password: owner.password }).expect(200);
  const api = clientWithToken(app, first.body.accessToken);
  secret = (await api.post('/auth/mfa/setup').expect(200)).body.secret;
  await api.post('/auth/mfa/enable', { code: await code() }).expect(200);
});

afterAll(async () => {
  await app.close();
  await db.close();
});

describe('remembering a device', () => {
  it('does not remember anything unless the box is ticked', async () => {
    const step1 = await login({ password: owner.password }).expect(200);
    expect(step1.body.mfaRequired).toBe(true);

    const verified = await request(app.getHttpServer())
      .post('/auth/mfa/verify')
      .send({ mfaToken: step1.body.mfaToken, code: await code() })
      .expect(200);
    expect(verified.body.accessToken).toBeDefined();
    expect(verified.body.deviceToken).toBeUndefined();
    // waiting for an unused 30-second window can take most of one
  }, 60_000);

  it('returns a device token when the box is ticked, and then skips the code', async () => {
    const step1 = await login({ password: owner.password }).expect(200);
    const verified = await request(app.getHttpServer())
      .post('/auth/mfa/verify')
      .send({
        mfaToken: step1.body.mfaToken,
        code: await code(),
        rememberDevice: true,
      })
      .expect(200);
    deviceToken = verified.body.deviceToken;
    expect(deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verified.body.deviceTokenExpiresIn).toBe(30 * 24 * 60 * 60);

    // the next sign-in from this device: password only, and the session counts
    // as two-factor, so business routes open
    const again = await login({
      password: owner.password,
      deviceToken,
    }).expect(200);
    expect(again.body.mfaRequired).toBeUndefined();
    expect(again.body.accessToken).toBeDefined();
    await clientWithToken(app, again.body.accessToken)
      .get('/companies')
      .expect(200);
  }, 60_000);

  it('still refuses a wrong password, device or not', async () => {
    await login({ password: 'not-the-password', deviceToken }).expect(401);
  });

  it('ignores a made-up or malformed device token', async () => {
    const invented = 'a'.repeat(43);
    const withInvented = await login({
      password: owner.password,
      deviceToken: invented,
    }).expect(200);
    expect(withInvented.body.mfaRequired).toBe(true);

    // malformed values are refused by validation, not treated as "no device"
    await login({ password: owner.password, deviceToken: 'short' }).expect(400);
  });

  it('does not let the device skip the step-up code for a high-risk action', async () => {
    const signedIn = await login({
      password: owner.password,
      deviceToken,
    }).expect(200);
    const api = clientWithToken(app, signedIn.body.accessToken);
    const me = await api.get('/auth/me').expect(200);

    // resetting a password is high-risk: it needs a code typed now, even though
    // this session began without one because the device was remembered
    const withoutCode = await api.post(`/users/${me.body.id}/password`, {
      newPassword: 'Another-Horse-9',
    });
    expect([400, 403]).toContain(withoutCode.status);
    expect(JSON.stringify(withoutCode.body)).toMatch(/OTP|MFA|STEP_UP|CODE/i);
  });

  it('lists the device and forgets it on request', async () => {
    const signedIn = await login({
      password: owner.password,
      deviceToken,
    }).expect(200);
    const api = clientWithToken(app, signedIn.body.accessToken);

    const list = await api.get('/auth/devices').expect(200);
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0].lastUsedAt).not.toBeNull();

    await request(app.getHttpServer())
      .delete('/auth/devices')
      .set('Authorization', `Bearer ${signedIn.body.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    expect((await api.get('/auth/devices').expect(200)).body.devices).toEqual(
      [],
    );

    // forgotten: the code is asked for again
    const after = await login({
      password: owner.password,
      deviceToken,
    }).expect(200);
    expect(after.body.mfaRequired).toBe(true);
  });
});
