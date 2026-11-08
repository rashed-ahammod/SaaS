/**
 * What the monitoring system needs to raise the guide §22 / spec §11 alerts:
 *
 *   ready()        database reachable and every migration file applied (deploy check)
 *   prometheus()   numbers only, across all tenants (read with the worker role):
 *                    API requests and latency, outbox backlog and dead letters,
 *                    undelivered e-mail / SMS, AI failures, each background job's
 *                    last success and failures in a row, audit-chain breaks
 *
 * Nothing here returns tenant data: no names, ids or amounts.
 */
import { readdirSync } from 'node:fs';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService, WORKER_DB } from '../db/database.service.js';
import { httpMetrics } from './http-metrics.js';

@Injectable()
export class MonitoringService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(WORKER_DB) private readonly workerDb: DatabaseService,
  ) {}

  async ready() {
    try {
      const { rows } = await sql<{
        n: number;
      }>`SELECT count(*)::int AS n FROM schema_migrations`.execute(
        this.db.kysely,
      );
      const files = readdirSync('db/migrations').filter((f) =>
        f.endsWith('.sql'),
      ).length;
      if (rows[0].n < files)
        throw new Error(`${files - rows[0].n} migration(s) not applied`);
      return { status: 'ready', database: 'ok', migrations: rows[0].n };
    } catch (err) {
      throw new ServiceUnavailableException(
        `not ready: ${(err as Error).message}`,
      );
    }
  }

  async prometheus(): Promise<string> {
    const out: string[] = ['# TYPE erp_up gauge', 'erp_up 1'];
    out.push(...httpMetrics.lines());
    const k = this.workerDb.kysely;

    // outbox: backlog, dead letters (spec §11 "a growing dead-letter list")
    const outbox = await sql<{
      status: string;
      n: number;
      oldest: number | null;
    }>`
      SELECT status, count(*)::int AS n,
             extract(epoch FROM now() - min(created_at) FILTER (WHERE status = 'pending'))::float8 AS oldest
        FROM outbox_events WHERE status <> 'sent' GROUP BY status`.execute(k);
    out.push('# TYPE erp_outbox_events gauge');
    for (const status of ['pending', 'dead'])
      out.push(
        `erp_outbox_events{status="${status}"} ${outbox.rows.find((r) => r.status === status)?.n ?? 0}`,
      );
    out.push('# TYPE erp_outbox_oldest_pending_seconds gauge');
    out.push(
      `erp_outbox_oldest_pending_seconds ${Math.round(outbox.rows.find((r) => r.status === 'pending')?.oldest ?? 0)}`,
    );

    // e-mail / SMS that did not go out
    const undelivered = await sql<{
      n: number;
    }>`SELECT count(*)::int AS n FROM notifications WHERE channel <> 'in_app' AND status = 'failed'`.execute(
      k,
    );
    out.push(
      '# TYPE erp_notifications_failed gauge',
      `erp_notifications_failed ${undelivered.rows[0].n}`,
    );

    // AI in the last hour
    const ai = await sql<{ calls: number; failed: number }>`
      SELECT count(*)::int AS calls, count(*) FILTER (WHERE status IN ('timeout', 'error'))::int AS failed
        FROM ai_interactions WHERE created_at > now() - interval '1 hour'`.execute(
      k,
    );
    out.push(
      '# TYPE erp_ai_calls_last_hour gauge',
      `erp_ai_calls_last_hour ${ai.rows[0].calls}`,
    );
    out.push(
      '# TYPE erp_ai_failures_last_hour gauge',
      `erp_ai_failures_last_hour ${ai.rows[0].failed}`,
    );

    // background jobs
    const jobs = await k
      .selectFrom('system_job_runs')
      .selectAll()
      .orderBy('job')
      .execute();
    out.push('# TYPE erp_job_last_success_timestamp_seconds gauge');
    for (const j of jobs)
      out.push(
        `erp_job_last_success_timestamp_seconds{job="${j.job}"} ${j.last_ok ? Math.floor(j.last_ok.getTime() / 1000) : 0}`,
      );
    out.push('# TYPE erp_job_consecutive_failures gauge');
    for (const j of jobs)
      out.push(`erp_job_consecutive_failures{job="${j.job}"} ${j.failures}`);

    // audit chain (nightly verification, spec §11 "tamper-evident")
    const audit = jobs.find((j) => j.job === 'audit-verify');
    const broken =
      (audit?.details as { brokenTenants?: number } | undefined)
        ?.brokenTenants ?? 0;
    out.push(
      '# TYPE erp_audit_chain_broken_tenants gauge',
      `erp_audit_chain_broken_tenants ${broken}`,
    );

    // the process
    const mem = process.memoryUsage();
    out.push(
      '# TYPE erp_process_resident_memory_bytes gauge',
      `erp_process_resident_memory_bytes ${mem.rss}`,
    );
    out.push(
      '# TYPE erp_process_uptime_seconds gauge',
      `erp_process_uptime_seconds ${Math.round(process.uptime())}`,
    );
    return out.join('\n') + '\n';
  }
}
