/**
 * Worker job (WP10): send an event to n8n again while some of its e-mail / SMS
 * messages are undelivered:
 *
 *   failed    both gateways refused; retried after 1, 2, 4, 8 ... minutes, up to 5 attempts
 *   sending   n8n took it but never reported (stopped half way); retried after 10 minutes
 *
 * claim() then hands out only those messages, so nothing already sent goes twice.
 * Runs as erp_worker (outbox + read access to notifications, all tenants).
 */
import { sql } from 'kysely';
import type { DatabaseService } from '../../platform/db/database.service.js';

export const MAX_DELIVERY_ATTEMPTS = 5;

export async function requeueUndelivered(
  workerDb: DatabaseService,
  o: { baseDelayMinutes?: number; stuckMinutes?: number } = {},
): Promise<number> {
  const base = o.baseDelayMinutes ?? 1;
  const stuck = o.stuckMinutes ?? 10;
  const result = await sql`
    UPDATE outbox_events e
       SET status = 'pending', next_attempt_at = now(), last_error = 'undelivered notifications'
     WHERE e.status IN ('sent', 'dead')
       AND EXISTS (
         SELECT 1 FROM notifications n
          WHERE n.tenant_id = e.tenant_id AND n.event_id = e.id AND n.channel <> 'in_app'
            AND (
              (n.status = 'failed' AND n.attempts < ${MAX_DELIVERY_ATTEMPTS}
                AND n.claimed_at < now() - make_interval(mins => ${base}::int * power(2, n.attempts - 1)::int))
              OR (n.status = 'sending' AND n.claimed_at < now() - make_interval(mins => ${stuck}::int))
            )
       )`.execute(workerDb.kysely);
  return Number(result.numAffectedRows ?? 0);
}
