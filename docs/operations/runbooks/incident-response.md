# Incident response

## First 15 minutes

1. **Take the incident:** acknowledge the alert, open the incident log, and write the time.
2. **Check what users see:**
   - `GET https://<api>/health` and `/health/ready`;
   - sign in to the employee app;
   - the Grafana or Prometheus 5xx rate and p95 latency.
3. **Is it isolation, money or data protection?** That means anything that could:
   - show one company's data to another;
   - move money wrongly;
   - expose NID, TIN, bank or salary data.

   If so, go to [Suspected tampering or data leak](#suspected-tampering-or-data-leak) **now**.
4. **Tell the tenants** if users are affected for more than 15 minutes (templates below).

## The API is down or failing (`ApiDown`, `HighErrorRate`, `SlowApi`)

| Check | Look for |
| --- | --- |
| API logs (`HttpExceptionFilter` lines) | The same error repeated: a bad release (roll back the code, see [deploy for free](deploy-free.md)) or the database |
| `GET /health/ready` says migrations missing | A release started before `npm run db:migrate` finished: run it |
| Database | Connections at the limit (the API pool is 20 per instance), locks, disk full, a failover in progress |
| Only some tenants | One tenant's very large job (a payroll run, an import). These run inside the request, so wait or ask the tenant's HR to retry later |
| `SlowApi` with AI traffic | AI calls do not hold database connections (`@ShortTransactions`). If AI is slow, the answer is "not answering" after `AI_TIMEOUT_MS`, never a hang |

The app degrades on its own:

- **AI down:** the screens work, and only the assistant answers "not answering".
- **n8n down:** events wait in the outbox and are delivered later.
- **SMS gateway down:** the fallback gateway is used.

## Suspected tampering or data leak

Triggers:

- `AuditChainBroken`;
- a tenant reports seeing another company's data;
- a payment the payroll did not approve;
- a leaked secret.

1. **Escalate at once** to the founder (incident lead) and keep a second person on the call.
2. **Preserve evidence. Do not "fix" first:**
   - take a backup now (`npm run backup`);
   - save the API and worker logs for the period;
   - for the audit chain, record the tenant and `brokenAtSeq` from the worker log
     (`ALERT: audit chain broken ...`).
3. **Contain:**
   - **Leaked secret:** rotate it.
     - `JWT_SECRET`: everyone signs in again.
     - `OUTBOX_WEBHOOK_SECRET`: update n8n credentials (`npm run import` in `n8n/`).
     - Service keys: revoke with `POST /service-keys/:id/revoke`.
     - `METRICS_TOKEN` and database passwords: rotate.
   - **Suspected cross-tenant access:** put the API in maintenance mode until the cause is
     understood. Isolation is the product's first promise (spec §11), so it outranks uptime.
   - **Unauthorised payment:** Accounts cancels the bank file
     (`POST /disbursement-files/:id/cancel`, which needs Admin approval) and calls the bank.
4. **Investigate with the audit log:** `GET /audit-log` as that tenant's Admin or auditor, or
   with the worker role across tenants. Entries are hash-chained, so a break shows where.
5. **Notify** the affected tenants in writing within 72 hours. Follow counsel's advice on
   Bangladesh's data protection law in force (spec §11).
6. **Review:** write the post-incident review (below) within 5 working days.

## Messages to tenants

Send them by e-mail to each tenant's Admin, plus the status page if there is one. Keep them
short and say what users should do.

**Bangla:**

> বিষয়: মাই অফিস / ইআরপি — সাময়িক সমস্যা
> {সময়} থেকে ইআরপি-তে {সমস্যা: লগইন / বেতন বিবরণী / হাজিরা} ব্যবহারে সমস্যা হচ্ছে। আমরা কাজ করছি; আপনার তথ্য নিরাপদ আছে। এর মধ্যে হাজিরা মেশিনে পাঞ্চ যথারীতি রেকর্ড হচ্ছে। পরবর্তী আপডেট {সময়}-এ দেব।

**English:**

> Subject: My Office / ERP — temporary problem
> Since {time}, {login / payslips / attendance} in the ERP is not working properly. We are on
> it, and your data is safe. Punches on the office device are still recorded. Next update at
> {time}.

## Post-incident review

The review uses these headings:

- **What happened:** the timeline in Dhaka time, from the incident log.
- **Impact:** tenants, users, data and money.
- **Root cause:** the cause, not a person. Reviews are blameless.
- **What worked**, and **what did not**.
- **Actions:** each with an owner and a date. Add a test or an alert so it cannot happen
  silently again.

File it next to the drills in `docs/operations/` and go through it with the team.
