/**
 * Background worker process:  npm run start:worker   (dev: npm run start:worker:dev)
 *
 * Jobs (guide §9, §14, §15):
 *   - outbox dispatcher       every 2 s    sends pending events to n8n
 *   - approval SLA            every minute reminders (24 working h) and escalations (48 working h)
 *   - attendance day close    every hour   computes yesterday (Dhaka) for every tenant; idempotent
 *   - leave accrual/year end  every 6 h    accrues leave and closes a finished leave year; idempotent
 *   - depreciation            every 6 h    last month's depreciation for companies with assets, once (WP19)
 *   - bank auto-match         every hour   statement lines the rules can match to newly posted ledger lines (WP20)
 *   - compliance reminders    every 6 h    the calendar kept up to date; one event per item and stage (7 days, 1 day, overdue) (WP21)
 *   - budget alerts           every hour   a budget line reaching 80 % / 100 %: one event per line and level (WP18)
 *   - probation reminders     every 6 h    Dept Head reminded 15 days before a probation ends; once per end date
 *   - notifications           every minute plans in-app messages for new events (also without n8n),
 *                                          and sends events again whose e-mail / SMS failed or got stuck
 *   - idempotency cleanup     every hour   removes keys older than 7 days
 *   - audit chain verifier    at start and every 24 h; logs an ALERT on any break
 *   - retention               every 24 h   clears personal data past its retention period (WP12)
 *   - ledger checks           every 24 h   books balance, every approved payroll and settled salary
 *                                          file posted; logs an ALERT per problem (WP14)
 *
 * Every run is recorded in system_job_runs (last success, failures in a row), which
 * GET /metrics turns into alerts (WP12).
 *
 * It starts the Nest application context (no HTTP server), so jobs use the same
 * services as the API. Long jobs (payroll runs, imports) move to Redis + BullMQ
 * when they arrive in later work packages.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { startJobs } from './jobs.js';

const log = (msg: string) =>
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const timers = await startJobs(app);

  const shutdown = async () => {
    log('stopping');
    timers.forEach(clearInterval);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  log('started');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
