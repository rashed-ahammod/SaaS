/**
 * Sends pending outbox events to n8n (guide §15 "Dispatcher worker").
 *
 * Each round:
 *   1. lock a batch of due events (FOR UPDATE SKIP LOCKED, so several workers can run);
 *   2. POST each one to  <webhookBaseUrl>/<event.type>  with a signature;
 *   3. success -> 'sent'; failure -> retry later with exponential back-off;
 *      after maxAttempts -> 'dead' (System Admin can replay it).
 *
 * Receivers must de-duplicate on the event id (X-Event-Id): an event can be
 * delivered twice if the worker stops after sending but before saving 'sent'.
 *
 * Runs as erp_worker (all tenants, outbox table only).
 */
import { sql } from 'kysely';
import type { DatabaseService } from '../db/database.service.js';
import type { OutboxEvent } from '../db/schema.js';
import { signCallbackToken } from './callback-token.js';
import { signWebhook } from './webhook-signature.js';

export interface DispatcherOptions {
  webhookBaseUrl: string;
  webhookSecret: string;
  maxAttempts: number;
  batchSize: number;
  /** First retry delay; doubles each attempt, capped at one hour. */
  baseRetryDelayMs?: number;
  requestTimeoutMs?: number;
}

export interface DispatchSummary {
  sent: number;
  retried: number;
  dead: number;
}

export class OutboxDispatcher {
  constructor(
    private readonly workerDb: DatabaseService,
    private readonly options: DispatcherOptions,
  ) {}

  /** Process one batch. Returns what happened (for logs and tests). */
  async dispatchBatch(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { sent: 0, retried: 0, dead: 0 };

    await this.workerDb.kysely.transaction().execute(async (tx) => {
      // lock due events so another worker skips them
      const events = await tx
        .selectFrom('outbox_events')
        .selectAll()
        .where('status', '=', 'pending')
        .where('next_attempt_at', '<=', sql<Date>`now()`)
        .orderBy('seq')
        .limit(this.options.batchSize)
        .forUpdate()
        .skipLocked()
        .execute();

      for (const event of events) {
        const error = await this.send(event);

        if (!error) {
          await tx
            .updateTable('outbox_events')
            .set({ status: 'sent', sent_at: new Date(), last_error: null })
            .where('id', '=', event.id)
            .execute();
          summary.sent++;
          continue;
        }

        const attempts = event.attempts + 1;
        const isDead = attempts >= this.options.maxAttempts;
        await tx
          .updateTable('outbox_events')
          .set({
            attempts,
            status: isDead ? 'dead' : 'pending',
            next_attempt_at: new Date(Date.now() + this.retryDelayMs(attempts)),
            last_error: error.slice(0, 1000),
          })
          .where('id', '=', event.id)
          .execute();
        if (isDead) summary.dead++;
        else summary.retried++;
      }
    });

    return summary;
  }

  /** POST one event. Returns an error message, or undefined on success (HTTP 2xx). */
  private async send(event: OutboxEvent): Promise<string | undefined> {
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      tenantId: event.tenant_id,
      entityId: event.entity_id,
      occurredAt: event.created_at.toISOString(),
      payload: event.payload,
    });
    const timestamp = Math.floor(Date.now() / 1000);

    try {
      const res = await fetch(
        `${this.options.webhookBaseUrl.replace(/\/$/, '')}/${event.type}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Id': event.id,
            'X-Timestamp': String(timestamp),
            'X-Signature': signWebhook(
              this.options.webhookSecret,
              timestamp,
              body,
            ),
            // lets n8n call back for this event only (fetch messages, report results); see callback-token.ts
            'X-Callback-Token': signCallbackToken(
              this.options.webhookSecret,
              event.tenant_id,
              event.id,
            ),
          },
          body,
          signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 10_000),
        },
      );
      return res.ok ? undefined : `HTTP ${res.status}`;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  private retryDelayMs(attempts: number): number {
    const base = this.options.baseRetryDelayMs ?? 30_000;
    return Math.min(base * 2 ** (attempts - 1), 60 * 60 * 1000);
  }
}
