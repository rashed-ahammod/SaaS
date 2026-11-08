# n8n: ERP notifications (WP10) and bank statements (WP20)

n8n carries the ERP's messages to the outside world: e-mail and SMS. It **does not decide**
anything (spec §9: the core owns every decision). The ERP core decides:

- who gets which message;
- in which language (Bangla or English);
- with which text and link;
- that each message is sent **once**.

n8n checks the signature, collects the messages, sends them, and reports back.

```
ERP worker (outbox) ──signed webhook──► n8n  "ERP notifications"
     X-Signature, X-Timestamp,            1. check HMAC signature + timestamp (≤ 5 min)
     X-Event-Id, X-Callback-Token         2. POST /notifications/events/<id>/claim   (EventToken)
                                          3. e-mail: e-mail API (payslip PDF attached)
                                             SMS: primary gateway, on error the fallback gateway
                                          4. POST /notifications/<message id>/result  (sent / failed)
```

| Event | Messages |
| --- | --- |
| `approval.pending` | The approver: in-app + e-mail. On a reminder (24 working hours): also SMS. |
| `approval.sla_breached` | The new approver: in-app + e-mail + SMS. The late approver: in-app + e-mail. |
| `payroll.disbursed` | Every paid employee: in-app, e-mail with the password-protected payslip PDF, and a "salary paid" SMS. |
| `attendance.daily_closed` | Every Dept Head: in-app + e-mail listing who was absent, late, on half day or missing a punch in their department. |
| `leave.approved` / `leave.rejected` | The employee: in-app. |

Every other event is answered with "nothing to send".

## Why replays never send twice (WP10 acceptance)

- **Messages are stored once.** The core stores each message once: event × kind × recipient ×
  channel is unique in the database.
- **Only unsent messages are handed out.** `claim` hands out only messages **not yet sent**, and
  marks them "sending".
- **Every kind of replay is safe:** a repeated webhook, a dispatcher retry, an admin replay, or a
  re-run in n8n gets an empty list for messages already sent.
- **Failures come back on their own.** A failed message (both SMS gateways down), or one stuck in
  "sending" for 10 minutes, is handed out again by the next delivery of its event. The ERP worker
  sends such events again by itself: 1, 2, 4, 8 minutes, up to 5 attempts.

The workflow answers the webhook at once, so the dispatcher never waits for a long payroll
mailing. The callback token (`X-Callback-Token`, 7 days) is the only credential n8n needs for
the ERP. It is valid for **that one event only**, so n8n holds no tenant secrets.

## Bank statements (WP20)

The second workflow, **ERP bank statements**, brings statement files into bank reconciliation.

```
bank host-to-host / SFTP or e-mail fetcher ──signed POST──► n8n "ERP bank statements"
   { bankAccountId, fileName, content (CSV) }              1. check HMAC signature + timestamp (≤ 5 min)
   X-Signature, X-Timestamp (feed secret)                  2. POST /bank-accounts/<id>/statements/n8n
                                                              (ServiceKey with bank.import only)
```

- **What n8n holds:** a service key that can do nothing but import statements. Create it as
  the workspace owner: `POST /service-keys` with `{ "permissions": ["bank.import"], "companyId": ... }`.
  Put its `authorizationHeader` in `n8n/.env` as `ERP_BANK_IMPORT_KEY`, then run `npm run import`.
- **What the ERP decides:** it reads the file in the bank's layout. It refuses a file it
  cannot read, or one whose balances do not add up. The same file sent twice is refused too.
  Lines already imported from an overlapping file are skipped. The rules then match what is
  certain.
- **The bank layouts are illustrative** until the pilot's banks are confirmed (see ADR 0023).
- **Try it:** `npm run push-statement -- <bank account id> ../backend/samples/bank/dbbl-sample-26-27-oct-2026.csv`.

## Run it locally

```bash
cd n8n
npm install                      # n8n 2.x, needs Node.js 24
cp .env.example .env             # optional: gateway URLs / keys (defaults use the mocks)
npm run import                   # credentials (secret from ../backend/.env) + workflow, published
npm run mocks                    # stand-in SMS gateways + e-mail API on :5680  (GET /messages)
npm start                        # n8n on http://localhost:5678
```

Then point the ERP at n8n and run the API and the worker:

```
# backend/.env
OUTBOX_WEBHOOK_BASE_URL=http://127.0.0.1:5678/webhook/6f1c2b9e-3d4a-4f5b-9c7d-8e0f1a2b3c4d/erp
OUTBOX_WEBHOOK_SECRET=<same as before; npm run import copies it into n8n>
PUBLIC_APP_URL=http://localhost:3001      # links in messages open the employee app
```

The id in the URL is the webhook id of the workflow's trigger. n8n puts it in front of webhook
paths that contain a parameter (`erp/:eventType`).

**Try it:**

- **Primary gateway down:** `curl -X POST localhost:5680/control -d '{"primaryDown":true}'`, and
  SMS go through the fallback gateway.
- **Replay:** set events back to `pending` (admin replay), and `GET localhost:5680/messages` shows
  no new messages.

## Production

- **How to run n8n:** in Docker (guide §2), with its own database. Do not expose it to the
  internet: only the ERP worker calls its webhook.
- **Gateways:** replace the mock URLs with the real gateways, and adjust the request bodies of
  the nodes "SMS primary gateway", "SMS fallback gateway", "Send e-mail" and "Send e-mail with
  PDF". The API keys live in n8n credentials (E-mail API, SMS gateway primary and fallback),
  never in the workflow.
- **No code or shell nodes:** `NODES_EXCLUDE` blocks code, function, command, SSH and file nodes
  (guide §15, spec §11).
- **Workflow changes are reviewed like code:** export with
  `n8n export:workflow --id=erpNotifications01 --output=workflows/erp-notifications.json`, review,
  commit, then `npm run import` on the server.
- **Licence:** n8n is used internally for prebuilt workflows only (guide §1, Sustainable Use
  License).
