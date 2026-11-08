/**
 * WP10 notifications through the real dispatcher and a fake n8n (Meghna Foods).
 * Acceptance criterion (guide §24): replayed events do not send duplicate messages.
 *
 * The fake n8n does what the real workflow does (n8n/workflows/erp-notifications.json):
 * receive the signed webhook, claim the event's messages with the callback token,
 * "send" them (records them here), download payslip attachments, report results.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import { ManualClock } from '../../src/platform/clock.js';
import { signCallbackToken } from '../../src/platform/outbox/callback-token.js';
import { OutboxDispatcher } from '../../src/platform/outbox/outbox-dispatcher.js';
import { OutboxService } from '../../src/platform/outbox/outbox.service.js';
import { requeueUndelivered } from '../../src/modules/notifications/notification-retry.js';
import { verifyWebhookSignature } from '../../src/platform/outbox/webhook-signature.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb, config, workerDb } from './helpers.js';

const db = appDb();
const worker = workerDb();
const clock = new ManualClock(new Date('2026-10-02T10:00:00+06:00'));
const SECRET = config.outbox.webhookSecret!;
let app: INestApplication;
let co: BdCompany;
let server: Server;
let dispatcher: OutboxDispatcher;

/** What the fake n8n "sent" to the outside world. */
interface Sent {
  eventType: string;
  channel: string;
  to: string;
  subject: string;
  text: string;
  attachment?: Buffer;
}
let sent: Sent[] = [];
/** Make the next SMS fail at "both gateways" (to see the retry). */
let failSms = 0;

beforeAll(async () => {
  app = await startApp({ clock });
  co = await createBdCompany(app, db);

  // a fake n8n
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      fakeN8n(req, body)
        .then((status) => {
          res.statusCode = status;
          res.end();
        })
        .catch(() => {
          res.statusCode = 500;
          res.end();
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  dispatcher = new OutboxDispatcher(worker, {
    webhookBaseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook/erp`,
    webhookSecret: SECRET,
    maxAttempts: 5,
    batchSize: 100,
    baseRetryDelayMs: 0,
  });
  // other tests' events are not ours
  await worker.kysely
    .updateTable('outbox_events')
    .set({ status: 'sent' })
    .where('status', '=', 'pending')
    .where('tenant_id', '<>', co.tenant.id)
    .execute();
}, 180_000);

afterAll(async () => {
  server.close();
  await app.close();
  await Promise.all([db.close(), worker.close()]);
});

/** One workflow run: verify, claim, send, report (the real workflow answers 200 first and sends afterwards). */
async function fakeN8n(req: IncomingMessage, body: string): Promise<number> {
  const ok = verifyWebhookSignature({
    secret: SECRET,
    timestamp: req.headers['x-timestamp'] as string,
    signature: req.headers['x-signature'] as string,
    body,
  });
  if (!ok) return 401;
  const event = JSON.parse(body) as {
    id: string;
    type: string;
    tenantId: string;
  };
  const auth = {
    Authorization: `EventToken ${req.headers['x-callback-token']}`,
  };
  const http = request(app.getHttpServer());

  const claimed = await http
    .post(`/notifications/events/${event.id}/claim`)
    .set(auth);
  if (claimed.status !== 200) return 500;
  for (const m of claimed.body.messages as Array<{
    id: string;
    channel: string;
    to: string;
    subject: string;
    text: string;
    attachment: { path: string } | null;
  }>) {
    if (m.channel === 'sms' && failSms > 0) {
      failSms--;
      await http.post(`/notifications/${m.id}/result`).set(auth).send({
        status: 'failed',
        provider: 'sms-primary+sms-fallback',
        error: 'both gateways refused',
      });
      continue;
    }
    let attachment: Buffer | undefined;
    if (m.attachment) {
      const file = await http
        .get(m.attachment.path)
        .set(auth)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      attachment = file.body as Buffer;
    }
    // other test files share the database: only this tenant's messages count here
    if (event.tenantId === co.tenant.id)
      sent.push({
        eventType: event.type,
        channel: m.channel,
        to: m.to,
        subject: m.subject,
        text: m.text,
        attachment,
      });
    await http
      .post(`/notifications/${m.id}/result`)
      .set(auth)
      .send({
        status: 'sent',
        provider: m.channel === 'sms' ? 'sms-primary' : 'email',
        providerMessageId: `msg-${sent.length}`,
      });
  }
  return 200;
}

/**
 * Deliver until every event of this tenant reached the fake n8n. Other test files
 * run their own dispatchers on the shared test database and may take an event
 * first; such events are simply sent again (which is safe: that is the point).
 */
async function dispatchAll() {
  for (let round = 0; round < 10; round++) {
    for (let i = 0; i < 5; i++) {
      const r = await dispatcher.dispatchBatch();
      if (r.sent + r.retried + r.dead === 0) break;
    }
    const missed = await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .selectFrom('outbox_events as o')
        .leftJoin('notification_events as n', 'n.event_id', 'o.id')
        .select('o.id')
        .where('n.event_id', 'is', null)
        .execute(),
    );
    if (missed.length === 0) return;
    await worker.kysely
      .updateTable('outbox_events')
      .set({ status: 'pending', next_attempt_at: new Date(0) })
      .where(
        'id',
        'in',
        missed.map((m) => m.id),
      )
      .execute();
  }
}

/** Admin replay of every event of the tenant (and n8n receiving them again). */
async function replayEverything() {
  await worker.kysely
    .updateTable('outbox_events')
    .set({ status: 'pending', attempts: 0, next_attempt_at: new Date(0) })
    .where('tenant_id', '=', co.tenant.id)
    .execute();
  await dispatchAll();
}

describe('approval nudges', () => {
  it('a new leave request: the approver gets an e-mail and an in-app message', async () => {
    const c = `/companies/${co.companyId}`;
    const packs = (await co.owner.get('/rule-packs').expect(200)).body.packs;
    const pack = packs.find(
      (p: { code: string; version: string }) =>
        p.code === 'BD-LABOUR' && p.version === '2026.2',
    );
    await co.owner
      .post(`/rule-packs/${pack.id}/accept`, { effectiveFrom: '2025-01-01' })
      .expect(201);
    await co.hr.api.post(`${c}/leave-types/defaults`).expect(201);
    await co.hr.api
      .post('/leave/accruals/run', {
        companyId: co.companyId,
        asOf: '2026-10-02',
      })
      .expect(201);
    const types = (await co.hr.api.get(`${c}/leave-types`).expect(200)).body;
    const cl = types.find((t: { code: string }) => t.code === 'CL').id;
    await co.rafi.api
      .post(`/employees/${co.rafi.employeeId}/leave-requests`, {
        leaveTypeId: cl,
        fromDate: '2026-10-21',
        toDate: '2026-10-21',
        reason: 'Bijoya Dashami at home in Cumilla',
      })
      .expect(201);

    await dispatchAll();
    const tanvir = (
      await co.owner.get(`/users/${co.salesHead.userId}`).expect(200)
    ).body;
    const toTanvir = sent.filter(
      (s) => s.to === tanvir.email && s.eventType === 'approval.pending',
    );
    expect(toTanvir).toHaveLength(1);
    expect(toTanvir[0]).toMatchObject({ channel: 'email' });
    expect(toTanvir[0].text).toContain('Leave: Mahmudul Hasan Rafi');
    expect(toTanvir[0].text).toMatch(
      /http:\/\/localhost:3001\/approvals\/[0-9a-f-]{36}/,
    );

    const inbox = (
      await co.salesHead.api.get('/me/notifications?unread=true').expect(200)
    ).body;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0].title).toContain('Leave: Mahmudul Hasan Rafi');
    await co.salesHead.api
      .post(`/me/notifications/${inbox.items[0].id}/read`)
      .expect(200);
    expect(
      (await co.salesHead.api.get('/me/notifications?unread=true').expect(200))
        .body.unread,
    ).toBe(0);
  });

  it('acceptance: replaying every event sends nothing twice', async () => {
    const before = sent.length;
    const rows = async () =>
      (
        await db.withTenant({ tenantId: co.tenant.id }, () =>
          sql<{
            n: number;
          }>`SELECT count(*)::int AS n FROM notifications`.execute(db.tx),
        )
      ).rows[0].n;
    const stored = await rows();
    await replayEverything();
    await replayEverything();
    expect(sent.length).toBe(before);
    expect(await rows()).toBe(stored);
  });
});

describe('payslip delivery', () => {
  it('after disbursement: e-mail with the protected payslip PDF and a "salary paid" SMS; a failed SMS is retried alone', async () => {
    const c = `/companies/${co.companyId}`;
    // Rafi's mobile number (for the SMS)
    const rafi = (
      await co.hr.api.get(`/employees/${co.rafi.employeeId}`).expect(200)
    ).body;
    await co.hr.api
      .patch(`/employees/${co.rafi.employeeId}`, {
        phone: '01712345678',
        version: rafi.version,
      })
      .expect(200);

    // September payroll, approved and paid in cash
    const structureId = (
      await co.hr.api.post(`${c}/salary-heads/defaults`).expect(201)
    ).body.structureId;
    for (const [person, gross] of [
      [co.md, '150000'],
      [co.hr, '80000'],
      [co.accounts, '90000'],
      [co.financeOfficer, '40000'],
      [co.salesHead, '100000'],
      [co.rafi, '30000'],
    ] as const) {
      await co.hr.api
        .post(`/employees/${person.employeeId}/salaries`, {
          effectiveFrom: '2025-01-01',
          gross,
          structureId,
          reason: 'Joining salary',
        })
        .expect(201);
    }
    await co.hr.api
      .post('/attendance/locks', { companyId: co.companyId, period: '2026-09' })
      .expect(201);
    await db.withTenant({ tenantId: co.tenant.id }, async () => {
      await db.tx
        .updateTable('attendance_days')
        .set({ status: 'present', worked_minutes: 540 })
        .where('company_id', '=', co.companyId)
        .where('status', '=', 'absent')
        .execute();
      await db.tx
        .updateTable('attendance_days')
        .set({ status: 'absent', worked_minutes: 0 })
        .where('employee_id', '=', co.rafi.employeeId)
        .where('work_date', '=', '2026-09-15')
        .execute();
    });
    const runId = (
      await co.hr.api
        .post(`${c}/payroll-runs`, { runType: 'regular', period: '2026-09' })
        .expect(201)
    ).body.id;
    await co.hr.api.post(`/payroll-runs/${runId}/calculate`).expect(200);
    for (const f of (await co.hr.api.get(`/payroll-runs/${runId}`).expect(200))
      .body.flags)
      await co.hr.api
        .post(`/payroll-flags/${f.id}/clear`, { reason: 'Paid in cash' })
        .expect(200);
    const submitted = (
      await co.hr.api.post(`/payroll-runs/${runId}/submit`).expect(200)
    ).body;
    await co.accounts.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    await co.md.api
      .post(`/approvals/requests/${submitted.approvalRequestId}/approve`, {})
      .expect(200);
    const file = (
      await co.accounts.api
        .post(`/payroll-runs/${runId}/disbursement-files`, { channel: 'cash' })
        .expect(201)
    ).body;
    await co.accounts.api
      .post(`/disbursement-files/${file.id}/settle`)
      .expect(200);

    // the SMS gateways are down for the first try
    failSms = 1;
    sent = [];
    await dispatchAll();

    const payslips = sent.filter((s) => s.eventType === 'payroll.disbursed');
    const rafiUser = (
      await co.owner.get(`/users/${co.rafi.userId}`).expect(200)
    ).body;
    const email = payslips.find(
      (s) => s.channel === 'email' && s.to === rafiUser.email,
    )!;
    expect(email.text).toMatch(/29,000\.00|২৯,০০০\.০০/);
    expect(email.attachment!.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(email.attachment!.toString('latin1')).toContain('/Encrypt');

    // the SMS failed; the worker sends the event again and only the SMS goes out
    expect(payslips.filter((s) => s.channel === 'sms')).toHaveLength(0);
    expect(
      await requeueUndelivered(worker, { baseDelayMinutes: 0 }),
    ).toBeGreaterThanOrEqual(1);
    await dispatchAll();
    const after = sent.filter((s) => s.eventType === 'payroll.disbursed');
    const sms = after.filter((s) => s.channel === 'sms');
    expect(sms).toEqual([expect.objectContaining({ to: '+8801712345678' })]);
    expect(after.filter((s) => s.to === rafiUser.email)).toHaveLength(1);
    expect(after.filter((s) => s.channel === 'email')).toHaveLength(6);

    const log = (
      await co.owner.get('/notifications/deliveries?status=sent').expect(200)
    ).body;
    expect(
      log.find(
        (d: { channel: string; attempts: number }) => d.channel === 'sms',
      ),
    ).toMatchObject({ attempts: 2, provider: 'sms-primary' });
  });

  it('acceptance: replaying the payroll event sends no second payslip', async () => {
    const before = sent.length;
    await replayEverything();
    expect(sent.length).toBe(before);
  });
});

describe('attendance digest', () => {
  it('each Dept Head gets the absent and late list of their department', async () => {
    await db.withTenant({ tenantId: co.tenant.id }, () =>
      new OutboxService(db).add({
        type: 'attendance.daily_closed',
        entityId: `${co.companyId}:2026-09-15`,
        payload: { companyId: co.companyId, date: '2026-09-15' },
      }),
    );
    sent = [];
    await dispatchAll();
    const tanvir = (
      await co.owner.get(`/users/${co.salesHead.userId}`).expect(200)
    ).body;
    const digest = sent.find(
      (s) => s.eventType === 'attendance.daily_closed' && s.to === tanvir.email,
    )!;
    expect(digest.text).toContain('Mahmudul Hasan Rafi');
    // the Finance head's department had nobody absent
    const sujit = (
      await co.owner.get(`/users/${co.accounts.userId}`).expect(200)
    ).body;
    const fin = sent.find(
      (s) => s.eventType === 'attendance.daily_closed' && s.to === sujit.email,
    )!;
    expect(fin.text).not.toContain('Rafi');
  });
});

describe('the callback token', () => {
  it('is required, cannot be forged, and only opens its own event', async () => {
    const http = request(app.getHttpServer());
    const events = await worker.kysely
      .selectFrom('outbox_events')
      .select(['id'])
      .where('tenant_id', '=', co.tenant.id)
      .where('type', '=', 'approval.pending')
      .execute();
    const other = await worker.kysely
      .selectFrom('outbox_events')
      .select(['id'])
      .where('tenant_id', '=', co.tenant.id)
      .where('type', '=', 'payroll.disbursed')
      .executeTakeFirstOrThrow();
    const token = signCallbackToken(SECRET, co.tenant.id, events[0].id);

    await http.post(`/notifications/events/${events[0].id}/claim`).expect(401);
    await http
      .post(`/notifications/events/${events[0].id}/claim`)
      .set('Authorization', `EventToken ${token.slice(0, -2)}00`)
      .expect(401);
    await http
      .post(`/notifications/events/${events[0].id}/claim`)
      .set(
        'Authorization',
        `EventToken ${signCallbackToken('wrong-secret', co.tenant.id, events[0].id)}`,
      )
      .expect(401);
    // a token for one event cannot claim another event
    await http
      .post(`/notifications/events/${other.id}/claim`)
      .set('Authorization', `EventToken ${token}`)
      .expect(403);
    // ... nor report or download another event's message
    const payslipMessage = await db.withTenant({ tenantId: co.tenant.id }, () =>
      db.tx
        .selectFrom('notifications')
        .select('id')
        .where('event_id', '=', other.id)
        .where('channel', '=', 'email')
        .executeTakeFirstOrThrow(),
    );
    await http
      .get(`/notifications/${payslipMessage.id}/attachment`)
      .set('Authorization', `EventToken ${token}`)
      .expect(403);
    await http
      .post(`/notifications/${payslipMessage.id}/result`)
      .set('Authorization', `EventToken ${token}`)
      .send({ status: 'sent', provider: 'x' })
      .expect(403);
    // and a user's login cannot use the relay routes
    await co.hr.api
      .post(`/notifications/events/${events[0].id}/claim`)
      .expect(401);
  });
});
