# ADR 0013 — WP10: notifications through n8n

- **Status:** accepted · 2026-10-15
- **Open:** choose the pilot's SMS gateways (primary and fallback) and e-mail provider, then
  adapt the four sending nodes. The current URLs are local mocks.

## 1. Who decides what

Spec §9 says the core owns every decision, and n8n only reacts and talks to the outside world.
In WP10 that means the core decides **everything about a message**:

- which events notify, and whom (the approver, the late approver and the escalation target, every
  paid employee, each Dept Head);
- the language (the user's saved preference);
- the text (Bangla and English templates in `modules/notifications/templates.ts`), the link into
  the employee app, and the channels;
- the payslip attachment.

n8n only transports the messages and reports back. A wrong recipient or wording is therefore
fixed in reviewed TypeScript with tests, not in a workflow canvas, and the one generic workflow
(`n8n/workflows/erp-notifications.json`) serves all event types. The guide's three Phase 1
workflows (approval nudges, payslip delivery, attendance digest) are three kinds of message in
this one workflow.

## 2. Exactly-once messages (WP10 acceptance: replays send nothing twice)

**Storage.** Two tables hold the messages:

- `notification_events`: one row per outbox event already planned.
- `notifications`: one row per message, unique on **(event, kind, recipient, channel)**.
  Planning the same event twice cannot create a second message.

**Claiming.** `POST /notifications/events/:eventId/claim` plans the event if needed, then hands
out only the e-mail and SMS messages that are `queued`, failed with fewer than 5 attempts, or
stuck in `sending` for more than 10 minutes. It marks them `sending` in the same statement. A
replayed webhook, a dispatcher retry, an admin replay, two n8n runs at once, or a manual re-run
in n8n all receive an empty list for messages already sent.

**Reporting.** `POST /notifications/:id/result` records `sent` or `failed`, with the provider and
the provider's message id. A message that is `sent` stays sent.

**Retries.** The workflow answers the webhook as soon as the signature checks out, so a long
payroll mailing never hits the dispatcher's 10-second timeout. The worker job
`requeueUndelivered` sends an event again while it has failed messages (backing off 1, 2, 4,
8 … minutes, up to 5 attempts) or messages stuck in sending. Only those messages go out again.

**In-app messages** (the employee app's bell, `GET /me/notifications`) are delivered by storing
them. The worker plans new events every minute even without n8n, so the in-app inbox works on its
own.

**Testing:**

- `notifications.int-spec` uses the real dispatcher and a fake n8n. It covers approval mail,
  in-app messages, payslip mail with the PDF, an SMS that fails and is retried alone, the
  attendance digest, token checks, and replaying every event twice with nothing sent twice.
- The same was run once with **real n8n 2.43.6**, mock gateways and the dev data:
  - 13 approval and reminder messages, 2 digests, and 14 payslip messages (7 e-mails with
    protected PDFs, Rafi's in Bangla, and 7 SMS);
  - an SMS sent through the fallback gateway while the primary was down;
  - replaying all 58 events three times sent nothing new.

## 3. The event callback token instead of tenant service keys in n8n

Guide §15 says n8n calls the API with a tenant service key. One n8n instance serves every tenant,
so it would have to store every tenant's key and pick the right one per event. Instead:

- **The token.** The dispatcher adds `X-Callback-Token` to each webhook:
  `v1.<tenant>.<event>.<expiry>.<hmac>`. The HMAC key is derived from `OUTBOX_WEBHOOK_SECRET`
  with a fixed label, so the token cannot be confused with a webhook signature. The token is made
  at sending time, never stored, and lasts 7 days.
- **The guard.** `EventTokenGuard` accepts `Authorization: EventToken <token>`. It runs the
  request in that tenant with only the `notifications.relay` permission, which no human role
  has. The service checks that every message touched belongs to the token's event.
- **The effect.** n8n holds no ERP secrets except the webhook HMAC secret. A leaked token reaches
  one event's messages for a few days.

Service keys (`attendance.ingest` and others) remain the way for machines to *change* data.

## 4. SMS gateway with fallback

SMS is for reminders, escalations and "salary paid". It is never the only channel for a
message; spec §10 asks this for critical notices.

- **Fallback:** the workflow tries the primary gateway and, on any error, the fallback gateway.
- **Logging:** the delivery log (`GET /notifications/deliveries`, integrations admin) shows which
  provider sent each message, the provider's message id, attempts and errors.
- **Numbers:** Bangladeshi mobile numbers are normalised to `+8801XXXXXXXXX`.
- **Length:** Bangla SMS texts are kept short (one Unicode part is 70 characters), and the link
  carries the details.

## 5. Reading other modules' facts

The planner reads, read-only, from:

- approval requests (summary and state; a reminder for a request decided meanwhile is dropped);
- users and employees (address, language);
- attendance days;
- payroll results.

Writing goes only to its own tables. The payslip PDF comes from
`PayrollRunsService.payslipPdfForDelivery`, always password-protected.

## 6. Running n8n

- **Local:** `n8n/` holds a pinned local n8n, the reviewed workflow, an import script that loads
  credentials (the HMAC secret from `backend/.env`, encrypted by n8n) and publishes the workflow,
  and the mock gateways.
- **Production:** n8n runs in Docker with its own database, not reachable from the internet.
  `NODES_EXCLUDE` blocks code, function, command, SSH and file nodes (guide §15).
- **Webhook URL:** n8n puts the trigger's webhook id in front of paths that contain a parameter,
  so the outbox base URL is `http://<n8n>/webhook/<webhookId>/erp`.

## 7. Not included

- WhatsApp.
- Push notifications to the PWA. The in-app inbox covers Phase 1.
- Customer-built workflows: Phase 4, after the n8n licence decision.
- Reading SMS delivery receipts (DLR) back from the gateways.
- Per-user channel preferences (opting out of SMS).
