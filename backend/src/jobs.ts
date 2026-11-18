/**
 * The ERP's scheduled background jobs, as one function.
 *
 * Two processes can run them:
 *   - worker.ts   a process of its own:  npm run start:worker  (the normal way)
 *   - main.ts     inside the API process, when RUN_JOBS_IN_API=true. For a host
 *                 whose free plan offers one web service only, where a worker of
 *                 its own would cost money. ONE API instance only: two instances
 *                 would run every job twice.
 *
 * The job list, its intervals and what each one guarantees are documented in
 * worker.ts, which stays the entry point. Every run is recorded in
 * system_job_runs (last success, failures in a row), which GET /metrics turns
 * into alerts (WP12).
 */

import type { INestApplicationContext } from '@nestjs/common';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { ApprovalSlaService } from './modules/approvals/approval-sla.service.js';
import {
  AttendanceService,
  yesterdayInDhaka,
} from './modules/attendance/attendance.service.js';
import { AccessGrants } from './modules/identity/access/access-grants.js';
import { LedgerReportsService } from './modules/ledger/ledger-reports.service.js';
import { LeaveLedgerService } from './modules/leave/leave-ledger.service.js';
import { requeueUndelivered } from './modules/notifications/notification-retry.js';
import { AssetsService } from './modules/assets/assets.service.js';
import { BankService } from './modules/bank/bank.service.js';
import { ComplianceService } from './modules/vat/compliance.service.js';
import { ReceiptsService } from './modules/sales/receipts.service.js';
import { TicketSlaService } from './modules/support/ticket-sla.service.js';
import { DocumentsService } from './modules/employees/documents.service.js';
import { ApplicantsService } from './modules/recruitment/applicants.service.js';
import { OffersService } from './modules/recruitment/offers.service.js';
import { BudgetsService } from './modules/budgets/budgets.service.js';
import { LifecycleService } from './modules/employees/lifecycle.service.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { AuditChainVerifier } from './platform/audit/audit-chain-verifier.js';
import { DatabaseService, WORKER_DB } from './platform/db/database.service.js';
import { OutboxDispatcher } from './platform/outbox/outbox-dispatcher.js';
import { JobRuns } from './platform/monitoring/job-runs.js';
import { retentionCutoffs } from './platform/retention.js';

const log = (msg: string) =>
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);

let jobRuns: JobRuns | undefined;

/** Run `job` every `ms`, never two at once, never crashing the process. The job may return details for monitoring. */
function every(ms: number, name: string, job: () => Promise<void | object>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    await jobRuns?.record(name, 'started');
    try {
      const details = await job();
      await jobRuns?.record(name, 'ok', { details: details ?? {} });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`${name} failed: ${message}`);
      await jobRuns?.record(name, 'failed', { error: message });
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, ms);
}


/**
 * Start every scheduled job on an open Nest application (the API process, or the
 * worker process). Returns the timers so the caller can stop them on shutdown.
 */
export async function startJobs(
  app: INestApplicationContext,
): Promise<NodeJS.Timeout[]> {
  const config = app.get<AppConfig>(APP_CONFIG);
  const workerDb = app.get<DatabaseService>(WORKER_DB);
  jobRuns = new JobRuns(workerDb, (m) => log(m));
  const timers: NodeJS.Timeout[] = [];

  // outbox
  const { webhookBaseUrl, webhookSecret } = config.outbox;
  if (webhookBaseUrl && webhookSecret) {
    const dispatcher = new OutboxDispatcher(workerDb, {
      ...config.outbox,
      webhookBaseUrl,
      webhookSecret,
    });
    timers.push(
      every(config.outbox.pollIntervalMs, 'outbox', async () => {
        const r = await dispatcher.dispatchBatch();
        if (r.sent || r.retried || r.dead)
          log(`outbox: sent ${r.sent}, retry ${r.retried}, dead ${r.dead}`);
        if (r.dead)
          log(
            'ALERT: outbox events moved to dead-letter; see GET /integrations/outbox',
          );
      }),
    );
    // e-mail / SMS that failed or got stuck in n8n: send the event again (only those messages go out)
    timers.push(
      every(60 * 1000, 'notification-retry', async () => {
        const n = await requeueUndelivered(workerDb);
        if (n)
          log(
            `notifications: ${n} event(s) sent again for undelivered messages`,
          );
      }),
    );
  } else {
    log(
      'outbox: OUTBOX_WEBHOOK_BASE_URL / OUTBOX_WEBHOOK_SECRET not set; events stay pending',
    );
  }

  // approval SLA
  const sla = app.get(ApprovalSlaService, { strict: false });
  timers.push(
    every(60 * 1000, 'approval-sla', async () => {
      const r = await sla.processDue();
      if (r.reminded || r.escalated)
        log(
          `approvals: ${r.reminded} reminder(s), ${r.escalated} escalation(s)`,
        );
    }),
  );

  // attendance: close yesterday for every tenant (each in its own transaction)
  const attendance = app.get(AttendanceService, { strict: false });
  const appDb = app.get(DatabaseService);
  timers.push(
    every(60 * 60 * 1000, 'attendance-close-day', async () => {
      const date = yesterdayInDhaka();
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let days = 0;
      for (const { id } of rows) {
        days += await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          () => attendance.closeDay(date),
        );
      }
      log(
        `attendance: closed ${date} (${days} employee-days in ${rows.length} tenant(s))`,
      );
    }),
  );

  // leave: accruals and year end for every tenant
  const leave = app.get(LeaveLedgerService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'leave-accruals', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let entries = 0;
      for (const { id } of rows) {
        try {
          entries += (
            await appDb.withTenant(
              { tenantId: id, access: AccessGrants.system() },
              () => leave.runScheduled(),
            )
          ).entries;
        } catch (err) {
          // e.g. a rule pack value not verified yet (refused in production)
          log(
            `leave: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      log(`leave: ${entries} accrual entries`);
    }),
  );

  // probation: remind the Dept Head 15 days before a probation ends (once per end date)
  const lifecycle = app.get(LifecycleService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'probation-reminders', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let sent = 0;
      for (const { id } of rows)
        sent += await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          () => lifecycle.remindProbationsDue(),
        );
      if (sent) log(`probation: ${sent} reminder(s)`);
      return { reminders: sent };
    }),
  );

  // assets: last month's depreciation, once per company (a closed month is skipped)
  const assetsService = app.get(AssetsService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'depreciation', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let runs = 0;
      for (const { id } of rows) {
        try {
          runs += await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => assetsService.runScheduled(),
          );
        } catch (err) {
          log(
            `depreciation: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (runs) log(`depreciation: ${runs} run(s)`);
      return { runs };
    }),
  );

  // bank: match statement lines to ledger lines posted since the import (e.g. a recorded bank charge)
  const bankService = app.get(BankService, { strict: false });
  timers.push(
    every(60 * 60 * 1000, 'bank-auto-match', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let matched = 0;
      for (const { id } of rows) {
        try {
          matched += await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => bankService.runScheduled(),
          );
        } catch (err) {
          log(
            `bank-auto-match: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (matched) log(`bank-auto-match: ${matched} match(es)`);
      return { matched };
    }),
  );

  // compliance calendar: returns and deposits falling due (reminders go out through notifications -> n8n)
  const compliance = app.get(ComplianceService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'compliance-reminders', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let reminders = 0;
      for (const { id } of rows) {
        try {
          reminders += await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => compliance.remind(),
          );
        } catch (err) {
          log(
            `compliance-reminders: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (reminders) log(`compliance-reminders: ${reminders} reminder(s)`);
      return { reminders };
    }),
  );

  // collections (WP27): overdue invoices get a reminder at 1, 7, 15 and 30 days late, each stage once
  const receipts = app.get(ReceiptsService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'collection-reminders', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let reminders = 0;
      for (const { id } of rows) {
        try {
          reminders += await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => receipts.remind(),
          );
        } catch (err) {
          log(
            `collection-reminders: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (reminders) log(`collection-reminders: ${reminders} reminder(s)`);
      return { reminders };
    }),
  );

  // support (WP28): tickets past their first-response or resolution deadline are reported
  // once each, from the SLA clock in working hours
  const ticketSla = app.get(TicketSlaService, { strict: false });
  timers.push(
    every(5 * 60 * 1000, 'ticket-sla', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      const total = { firstResponse: 0, resolution: 0 };
      for (const { id } of rows) {
        try {
          const r = await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => ticketSla.processDue(),
          );
          total.firstResponse += r.firstResponse;
          total.resolution += r.resolution;
        } catch (err) {
          log(
            `ticket-sla: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (total.firstResponse || total.resolution)
        log(
          `ticket-sla: ${total.firstResponse} response breach(es), ${total.resolution} resolution breach(es)`,
        );
      return total;
    }),
  );

  // budgets: 80 % / 100 % alerts for the current fiscal year (once per line and level)
  const budgets = app.get(BudgetsService, { strict: false });
  timers.push(
    every(60 * 60 * 1000, 'budget-alerts', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let raised = 0;
      for (const { id } of rows)
        raised += await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          () => budgets.raiseAlerts(),
        );
      if (raised) log(`budgets: ${raised} alert(s)`);
      return { alerts: raised };
    }),
  );

  // notifications: in-app messages for new events, even when n8n is not configured
  const notifications = app.get(NotificationsService, { strict: false });
  timers.push(
    every(60 * 1000, 'notifications', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let planned = 0;
      for (const { id } of rows) {
        try {
          planned += await appDb.withTenant(
            { tenantId: id, access: AccessGrants.system() },
            () => notifications.planRecent(),
          );
        } catch (err) {
          log(
            `notifications: tenant ${id} skipped: ${err instanceof Error ? err.message : err}`,
          );
        }
      }
      if (planned) log(`notifications: ${planned} event(s) planned`);
    }),
  );

  // idempotency cleanup (the worker's RLS policy only exposes keys older than 7 days)
  timers.push(
    every(60 * 60 * 1000, 'idempotency-cleanup', async () => {
      const r = await workerDb.kysely
        .deleteFrom('idempotency_keys')
        .where('created_at', '<', sql<Date>`now() - interval '7 days'`)
        .executeTakeFirst();
      if (r.numDeletedRows > 0n)
        log(`idempotency: removed ${r.numDeletedRows} old keys`);
    }),
  );

  // audit chain verification
  const verifier = new AuditChainVerifier(workerDb);
  timers.push(
    every(24 * 60 * 60 * 1000, 'audit-verify', async () => {
      const results = await verifier.verifyAll();
      for (const r of results.filter((x) => !x.ok)) {
        log(
          `ALERT: audit chain broken for tenant ${r.tenantId} at seq ${r.brokenAtSeq}`,
        );
      }
      log(`audit: verified ${results.length} tenant chain(s)`);
      return {
        tenants: results.length,
        brokenTenants: results.filter((x) => !x.ok).length,
      };
    }),
  );

  // documents (WP31): an employee document that runs out, at 30 days, 7 days and expired;
  // each stage once per document
  const documents = app.get(DocumentsService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'document-expiry', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let sent = 0;
      for (const { id } of rows)
        sent += await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          () => documents.remindExpiringDocuments(),
        );
      if (sent) log(`document-expiry: ${sent} alert(s)`);
      return { alerts: sent };
    }),
  );

  // recruitment (WP29): offers nobody answered by their validity date can no longer be
  // accepted, and they stop cluttering HR's list
  const offersService = app.get(OffersService, { strict: false });
  timers.push(
    every(6 * 60 * 60 * 1000, 'offer-expiry', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      let expired = 0;
      for (const { id } of rows)
        expired += await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          () => offersService.expireOverdue(),
        );
      if (expired) log(`offers: ${expired} expired`);
      return { expired };
    }),
  );

  // retention: personal data past its period, tenant by tenant (the database enforces minimum periods)
  const applicantsService = app.get(ApplicantsService, { strict: false });
  timers.push(
    every(24 * 60 * 60 * 1000, 'retention', async () => {
      const cut = retentionCutoffs(new Date());
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      const total = {
        punchLocations: 0,
        aiTexts: 0,
        stagedRows: 0,
        applicants: 0,
        cvFiles: 0,
      };
      for (const { id } of rows) {
        const r = await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          async () => {
            // the CV files first: clearing the rows loses the keys that find them
            const files = await applicantsService.clearExpired();
            const cleared = (
              await sql<{
                r: {
                  punchLocations: number;
                  aiTexts: number;
                  stagedRows: number;
                  applicants: number;
                };
              }>`SELECT retention_apply(${cut.location}, ${cut.aiTexts}, ${cut.staging}, ${cut.applicants}) AS r`.execute(
                appDb.tx,
              )
            ).rows[0].r;
            return { ...cleared, cvFiles: files.files };
          },
        );
        total.punchLocations += r.punchLocations;
        total.aiTexts += r.aiTexts;
        total.stagedRows += r.stagedRows;
        total.applicants += r.applicants;
        total.cvFiles += r.cvFiles;
      }
      if (
        total.punchLocations ||
        total.aiTexts ||
        total.stagedRows ||
        total.applicants
      )
        log(`retention: cleared ${JSON.stringify(total)}`);
      return total;
    }),
  );

  // ledger: the books balance and nothing waits to be posted (company by company)
  const ledger = app.get(LedgerReportsService, { strict: false });
  timers.push(
    every(24 * 60 * 60 * 1000, 'ledger-checks', async () => {
      const { rows } = await sql<{
        id: string;
      }>`SELECT worker_active_tenant_ids() AS id`.execute(workerDb.kysely);
      const total = { companies: 0, problems: 0 };
      for (const { id } of rows) {
        await appDb.withTenant(
          { tenantId: id, access: AccessGrants.system() },
          async () => {
            const companies = await appDb.tx
              .selectFrom('accounts')
              .select('company_id')
              .distinct()
              .execute();
            for (const { company_id } of companies) {
              const r = await ledger.checks(company_id, { skipAccess: true });
              total.companies += 1;
              total.problems += r.problems.length;
              for (const p of r.problems)
                log(
                  `ALERT: ledger ${p.check} in company ${company_id} (tenant ${id}): ${p.detail}`,
                );
            }
          },
        );
      }
      log(
        `ledger: checked ${total.companies} company book(s), ${total.problems} problem(s)`,
      );
      return total;
    }),
  );

  return timers;
}
