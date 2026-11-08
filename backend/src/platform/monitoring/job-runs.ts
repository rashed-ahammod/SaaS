/**
 * Each background job's last run, kept in system_job_runs so monitoring can
 * alert on a job that stopped succeeding (guide §22: "job failures"). Written
 * with the worker role; a failure to record never stops the job itself.
 */
import { sql } from 'kysely';
import type { DatabaseService } from '../db/database.service.js';

export class JobRuns {
  constructor(
    private readonly db: DatabaseService,
    private readonly log: (message: string) => void = () => undefined,
  ) {}

  async record(
    job: string,
    outcome: 'started' | 'ok' | 'failed',
    info: { error?: string; details?: object } = {},
  ): Promise<void> {
    const now = new Date();
    try {
      // make sure the job has a row, then record this run on it
      await this.db.kysely
        .insertInto('system_job_runs')
        .values({ job })
        .onConflict((oc) => oc.column('job').doNothing())
        .execute();
      const update = this.db.kysely
        .updateTable('system_job_runs')
        .where('job', '=', job);
      if (outcome === 'started')
        await update.set({ last_started: now }).execute();
      else if (outcome === 'ok')
        await update
          .set({
            last_finished: now,
            last_ok: now,
            last_error: null,
            failures: 0,
            details: JSON.stringify(info.details ?? {}),
          })
          .execute();
      else
        await update
          .set({
            last_finished: now,
            last_error: (info.error ?? '').slice(0, 500),
            failures: sql<number>`failures + 1`,
          })
          .execute();
    } catch (err) {
      this.log(
        `monitoring: could not record ${job}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
