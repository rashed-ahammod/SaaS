# Background jobs

One worker process (`node dist/worker.js`) runs these jobs. Each run is recorded in
`system_job_runs`, which feeds the alerts `BackgroundJobFailing` (3 failures in a row) and
`BackgroundJobStale` (no success for too long).

| Job | Every | What it does | If it stops |
| --- | --- | --- | --- |
| `outbox` | 2 s | Sends business events to n8n (signed) | Notifications wait; nothing is lost |
| `notification-retry` | 1 min | Resends events whose e-mail / SMS failed | Failed messages stay failed |
| `approval-sla` | 1 min | Reminders after 24 working hours, escalation after 48 | Approvals sit without nudges |
| `notifications` | 1 min | In-app messages for new events | The bell shows nothing new |
| `attendance-close-day` | 1 h | Computes yesterday for every tenant | Attendance days stay "missing punch" |
| `leave-accruals` | 6 h | Leave accrual and year end | Balances lag (catches up when it runs) |
| `idempotency-cleanup` | 1 h | Removes old idempotency keys | The table grows |
| `audit-verify` | 24 h | Recomputes every tenant's audit hash chain | Tampering is found later |
| `retention` | 24 h | Clears old punch locations, AI texts, finished import staging | Personal data is kept longer than promised |
| `backup` | daily (cron) | See [backup and restore](backup-and-restore.md) | |

**See the state** (worker role):

```sql
SELECT job, last_ok, failures, last_error FROM system_job_runs ORDER BY job;
```

## `BackgroundJobFailing` / `BackgroundJobStale`

1. **Is the worker running?** One process only. If it is down, restart it. Every job is safe
   to run again: they are idempotent and catch up.
2. **Read `last_error`.** Usual causes:
   - **The database** (connections, locks). Check it first.
   - **`leave-accruals` failing for one tenant:** the log says "tenant ... skipped". This is
     usually a rule value still marked `verify`, which is refused in production. The
     compliance owner verifies it (`npm run rules`).
   - **`audit-verify`:** this is never "just a job". See `AuditChainBroken` in
     [incident response](incident-response.md).
3. **After the fix,** the next run sets `failures` back to 0.

## Outbox dead letters

An event that failed 10 times is marked `dead` (`OutboxDeadLetters`). `OutboxBacklog` means
events are waiting more than 30 minutes, usually because n8n is down.

1. **Is n8n up?** Check it on the private network:
   `curl http://<n8n>:5678/healthz`. Is `OUTBOX_WEBHOOK_BASE_URL` right? It must include the
   webhook id prefix (ADR 0013).
2. **See the dead events and their last error** (Admin / System Admin):
   `GET /integrations/outbox?status=dead`.
3. **After the cause is fixed, replay them:** `POST /integrations/outbox/:eventId/replay`.
   Replays never send a message twice, because the core hands each message out only once
   (ADR 0013).

## E-mail and SMS

`MessagesNotDelivered`: more than 20 messages failed at every gateway.

1. **Delivery log:** `GET /notifications/deliveries?status=failed` shows the provider, the
   provider's message id, attempts and the error.
2. **Both SMS gateways down:** the messages are retried by `notification-retry`. Tell the
   pilots that SMS are delayed; in-app messages and e-mail still work.
3. **Wrong credentials or account balance at the gateway:** fix it in n8n credentials. The
   ERP holds no gateway secrets.

## AI provider

`AiFailing`: more than 20% of AI calls time out or fail.

1. **The app keeps working.** Users get "the assistant is not answering", and the screens are
   unaffected.
2. **Check the provider's status page** and the errors:
   `GET /ai/interactions?status=error&limit=20` (Admin).
3. **If it lasts,** set `AI_PROVIDER=off` and restart the API, so AI disappears from the app
   cleanly. Switch it back afterwards. Changing the model needs a new release-gate run:
   `npm run ai:eval`.
