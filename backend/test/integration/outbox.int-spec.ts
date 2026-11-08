/**
 * Outbox (guide §15): events are saved with the business transaction and
 * delivered to a webhook with a valid signature; failures retry, then go dead.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OutboxDispatcher } from '../../src/platform/outbox/outbox-dispatcher.js';
import { OutboxService } from '../../src/platform/outbox/outbox.service.js';
import { verifyWebhookSignature } from '../../src/platform/outbox/webhook-signature.js';
import { appDb, createTenant, type TestTenant, workerDb } from './helpers.js';

const SECRET = 'outbox-test-secret';
const db = appDb();
const worker = workerDb();
const outbox = new OutboxService(db);

interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}
let received: Received[] = [];
let respondWith = 200;
let server: Server;
let baseUrl: string;
let tenant: TestTenant;

beforeAll(async () => {
  // a fake n8n
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url ?? '', headers: req.headers, body });
      res.statusCode = respondWith;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;

  // events left by earlier test runs are not part of this test
  await worker.kysely
    .updateTable('outbox_events')
    .set({ status: 'sent' })
    .where('status', '=', 'pending')
    .execute();
  tenant = await createTenant(db, 'outbox');
});

afterAll(async () => {
  server.close();
  await Promise.all([db.close(), worker.close()]);
});

beforeEach(() => {
  received = [];
  respondWith = 200;
});

function dispatcher(maxAttempts = 3) {
  return new OutboxDispatcher(worker, {
    webhookBaseUrl: baseUrl,
    webhookSecret: SECRET,
    maxAttempts,
    batchSize: 50,
    baseRetryDelayMs: 0, // retry immediately in tests
  });
}

async function statusOf(id: string) {
  return worker.kysely
    .selectFrom('outbox_events')
    .select(['status', 'attempts', 'last_error'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}

describe('outbox', () => {
  it('delivers an event with a valid signature', async () => {
    const id = await db.withTenant({ tenantId: tenant.id }, () =>
      outbox.add({
        type: 'leave.approved',
        entityId: 'req-1',
        payload: { employeeId: 'e-1', days: 2 },
      }),
    );

    const summary = await dispatcher().dispatchBatch();
    expect(summary.sent).toBeGreaterThanOrEqual(1);

    const hit = received.find((r) => JSON.parse(r.body).id === id)!;
    expect(hit.path).toBe('/webhook/leave.approved');
    expect(hit.headers['x-event-id']).toBe(id);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestamp: hit.headers['x-timestamp'] as string,
        signature: hit.headers['x-signature'] as string,
        body: hit.body,
      }),
    ).toBe(true);
    expect(JSON.parse(hit.body)).toMatchObject({
      tenantId: tenant.id,
      type: 'leave.approved',
      payload: { days: 2 },
    });
    expect((await statusOf(id)).status).toBe('sent');
  });

  it('writes nothing when the business transaction rolls back', async () => {
    let id = '';
    await expect(
      db.withTenant({ tenantId: tenant.id }, async () => {
        id = await outbox.add({
          type: 'leave.approved',
          payload: { employeeId: 'e-2' },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const row = await worker.kysely
      .selectFrom('outbox_events')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    expect(row).toBeUndefined();
  });

  it('retries failures and moves the event to dead after max attempts', async () => {
    const id = await db.withTenant({ tenantId: tenant.id }, () =>
      outbox.add({ type: 'payroll.approved', payload: { runId: 'r-1' } }),
    );
    respondWith = 500;
    const d = dispatcher(2);

    await d.dispatchBatch();
    expect(await statusOf(id)).toMatchObject({
      status: 'pending',
      attempts: 1,
      last_error: 'HTTP 500',
    });

    await d.dispatchBatch();
    expect(await statusOf(id)).toMatchObject({ status: 'dead', attempts: 2 });

    // System Admin replay puts it back in the queue
    const replayed = await db.withTenant({ tenantId: tenant.id }, () =>
      outbox.replayDead(id),
    );
    expect(replayed).toBe(true);
    respondWith = 200;
    await d.dispatchBatch();
    expect((await statusOf(id)).status).toBe('sent');
  });

  it('refuses salary or identity data in payloads', async () => {
    await expect(
      db.withTenant({ tenantId: tenant.id }, () =>
        outbox.add({
          type: 'payroll.approved',
          payload: { employee: { nid: '123' } },
        }),
      ),
    ).rejects.toThrow(/sensitive field "nid"/);
  });

  it("a tenant cannot see another tenant's events", async () => {
    const other = await createTenant(db, 'outbox-b');
    const id = await db.withTenant({ tenantId: other.id }, () =>
      outbox.add({ type: 'leave.approved', payload: {} }),
    );
    const seen = await db.withTenant({ tenantId: tenant.id }, () =>
      db.tx
        .selectFrom('outbox_events')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst(),
    );
    expect(seen).toBeUndefined();
    // and cannot replay it either
    expect(
      await db.withTenant({ tenantId: tenant.id }, () => outbox.replayDead(id)),
    ).toBe(false);
  });
});
