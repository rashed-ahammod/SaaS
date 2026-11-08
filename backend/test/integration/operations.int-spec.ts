/**
 * WP12 operations: readiness, metrics for alerts, background-job records and
 * the retention of personal data.
 */
import type { INestApplication } from '@nestjs/common';
import { sql } from 'kysely';
import request from 'supertest';
import { AccessGrants } from '../../src/modules/identity/access/access-grants.js';
import { JobRuns } from '../../src/platform/monitoring/job-runs.js';
import { retentionCutoffs } from '../../src/platform/retention.js';
import { startApp } from './api-client.js';
import { createBdCompany, type BdCompany } from './bd-company.js';
import { appDb, workerDb } from './helpers.js';

const TOKEN = 'test-metrics-token-0123456789abcdef';
process.env.METRICS_TOKEN = TOKEN;

const db = appDb();
const worker = workerDb();
let app: INestApplication;
let co: BdCompany;
let other: BdCompany;

const DAY = 24 * 60 * 60 * 1000;
const asTenant = <T>(c: BdCompany, work: () => Promise<T>) =>
  db.withTenant({ tenantId: c.tenant.id, access: AccessGrants.system() }, work);
const punch = (c: BdCompany, daysAgo: number) =>
  asTenant(c, () =>
    db.tx
      .insertInto('attendance_punches')
      .values({
        employee_id: c.rafi.employeeId,
        punched_at: new Date(Date.now() - daysAgo * DAY),
        source: 'mobile',
        device_ref: `phone-${daysAgo}`,
        latitude: 23.7925,
        longitude: 90.4078,
        distance_m: 12,
      })
      .returning('id')
      .executeTakeFirstOrThrow(),
  );
const punchRow = (c: BdCompany, id: string) =>
  asTenant(c, () =>
    db.tx
      .selectFrom('attendance_punches')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow(),
  );

beforeAll(async () => {
  app = await startApp();
  co = await createBdCompany(app, db);
  other = await createBdCompany(app, db);
}, 180_000);

afterAll(async () => {
  await app.close();
  await db.close();
  await worker.close();
});

describe('readiness and metrics', () => {
  it('readiness: database reachable and every migration applied', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ready', database: 'ok' });
    expect(res.body.migrations).toBeGreaterThanOrEqual(17);
  });

  it('metrics only with the monitoring token', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(401);
    await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer wrong-token-0123456789abcdef-xx')
      .expect(401);
    await co.owner.get('/metrics').expect(401);
  });

  it('metrics carry the numbers the alerts need, and no tenant data', async () => {
    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', `Bearer ${TOKEN}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    for (const line of [
      'erp_up 1',
      'erp_outbox_events{status="dead"}',
      'erp_outbox_oldest_pending_seconds',
      'erp_notifications_failed',
      'erp_ai_failures_last_hour',
      'erp_audit_chain_broken_tenants',
      'erp_http_request_duration_seconds_count',
    ]) {
      expect(res.text).toContain(line);
    }
    expect(res.text).toMatch(/erp_http_requests_total\{status="2xx"\} \d+/);
    const name = (await co.owner.get(`/companies/${co.companyId}`).expect(200))
      .body.legalName;
    expect(res.text).not.toContain(name);
    expect(res.text).not.toContain(co.tenant.id);
  });

  it('a background job that keeps failing shows up for alerting; a success resets it', async () => {
    const runs = new JobRuns(worker);
    const job = `test-job-${Date.now()}`;
    await runs.record(job, 'started');
    await runs.record(job, 'failed', { error: 'database timeout' });
    await runs.record(job, 'failed', { error: 'database timeout' });
    const metrics = async () =>
      (
        await request(app.getHttpServer())
          .get('/metrics')
          .set('Authorization', `Bearer ${TOKEN}`)
          .expect(200)
      ).text;
    expect(await metrics()).toContain(
      `erp_job_consecutive_failures{job="${job}"} 2`,
    );
    await runs.record(job, 'ok', { details: { processed: 3 } });
    expect(await metrics()).toContain(
      `erp_job_consecutive_failures{job="${job}"} 0`,
    );
    expect(await metrics()).toMatch(
      new RegExp(
        `erp_job_last_success_timestamp_seconds\\{job="${job}"\\} [1-9]\\d+`,
      ),
    );
  });
});

describe('retention of personal data (spec §11)', () => {
  it('clears the location of old phone punches only; the punch time stays; other companies are untouched', async () => {
    const old = await punch(co, 200);
    const recent = await punch(co, 10);
    const otherOld = await punch(other, 200);
    const cut = retentionCutoffs(new Date());

    const result = await asTenant(
      co,
      async () =>
        (
          await sql<{
            r: Record<string, number>;
          }>`SELECT retention_apply(${cut.location}, ${cut.aiTexts}, ${cut.staging}) AS r`.execute(
            db.tx,
          )
        ).rows[0].r,
    );
    expect(result.punchLocations).toBe(1);

    expect(await punchRow(co, old.id)).toMatchObject({
      latitude: null,
      longitude: null,
      distance_m: null,
      source: 'mobile',
    });
    expect((await punchRow(co, old.id)).punched_at.getTime()).toBeLessThan(
      Date.now() - 199 * DAY,
    );
    expect(await punchRow(co, recent.id)).toMatchObject({
      latitude: 23.7925,
      distance_m: 12,
    });
    expect(await punchRow(other, otherOld.id)).toMatchObject({
      latitude: 23.7925,
    });
  });

  it('refuses periods shorter than the minimum, and punches stay append-only otherwise', async () => {
    const now = new Date();
    await expect(
      asTenant(co, () =>
        sql`SELECT retention_apply(${now}, ${now}, ${now})`.execute(db.tx),
      ),
    ).rejects.toThrow(/shorter than the minimum/);
    const p = await punch(co, 300);
    await expect(
      asTenant(co, () =>
        db.tx
          .updateTable('attendance_punches')
          .set({ latitude: null, longitude: null, distance_m: null })
          .where('id', '=', p.id)
          .execute(),
      ),
    ).rejects.toThrow();
    await expect(
      asTenant(co, () =>
        db.tx.deleteFrom('attendance_punches').where('id', '=', p.id).execute(),
      ),
    ).rejects.toThrow();
  });
});
