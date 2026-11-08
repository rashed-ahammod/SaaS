# Penetration test: scope and rules of engagement

For the external testing firm. Guide §20 requires an external penetration test before the
first pilot company runs payroll in the system, and its findings fixed.

## 1. The system

A multi-tenant HR and payroll SaaS for Bangladeshi companies. Each customer company is a
**tenant**. The most important property is that **no tenant can ever read or change another
tenant's data**. After that come payroll integrity (no unauthorised payment, salary or
bank-account change) and the confidentiality of personal data (NID, TIN, bank accounts,
salaries).

| Component | What it is | In scope |
| --- | --- | --- |
| ERP API | NestJS (Node.js 24), REST + JSON, `https://<staging-api>` | **Yes**, main target |
| Employee app | Next.js PWA; a backend-for-frontend holds the login token in an httpOnly cookie and proxies `/api/erp/*` | **Yes** |
| PostgreSQL 18 | Row-level security per tenant; separate roles for the API, the worker and backups | Through the API only (no direct database access) |
| n8n | Internal notification workflow; only reachable from the ERP worker | Network reachability only (it must **not** be reachable) |
| AI assistant | Calls an outside model; read-only tools; prompt-injection defences | **Yes** (see §4) |

## 2. Environment and accounts

- **Environment:** staging, production-like, with **synthetic data only**. Never test against
  production or real customer data.
- **Tenants:** we create two, `pentest-a` and `pentest-b`, each with these logins:
  - Admin;
  - System Admin;
  - HR;
  - Accounts;
  - Department Head;
  - two Employees.
- **2FA:** privileged roles must use 2FA, and we enrol the testers' authenticator apps.
- **Machine credentials:** we also provide one service key (`attendance.ingest`) for tenant A.
- **API reference:** the Postman collection `backend/postman/ERP-API.postman_collection.json`
  (258 requests) and the route list in `backend/README.md`.

## 3. What we most want tested

1. **Cross-tenant access:** reading, changing or creating anything in tenant B while signed
   in to tenant A. Try every id-bearing route, list filter, export, PDF, file download, AI
   question and webhook callback.
2. **Privilege escalation inside a tenant:**
   - an Employee reaching HR or payroll routes;
   - a Department Head seeing salaries;
   - Admin seeing salaries without a grant;
   - approving one's own request;
   - granting oneself a role;
   - bypassing step-up (`X-OTP-Code`) on bank-account changes, disbursement files and role
     grants.
3. **Payroll and money integrity:**
   - paying an employee twice for a period;
   - generating a second bank file without the cancel approval;
   - redirecting a salary to another account;
   - changing an approved run;
   - tampering with the audit log, or making its hash chain verify after a change.
4. **Authentication and sessions:**
   - login brute force, lockout and rate limits;
   - 2FA bypass;
   - token reuse after logout;
   - session fixation;
   - cookie flags;
   - CSRF on the employee app (header `x-erp-client: pwa`).
5. **Machine endpoints:**
   - service keys (`/attendance/device-batches`);
   - the n8n event callback token (`Authorization: EventToken`, scoped to one event);
   - outbox webhook signatures.
6. **Data protection:**
   - NID, TIN and account numbers visible to users without the grant;
   - masking in responses, logs, AI prompts and spreadsheets;
   - consent bypass for phone location and biometric enrolment.
7. **Uploads:** data-migration and payroll-register spreadsheets (XLSX/CSV formula injection,
   zip bombs, oversized files) and employee documents.
8. **The usual web and API classes:** injection, SSRF, path traversal, mass assignment
   (unknown fields are refused), IDOR, and security headers.

## 4. AI assistant

The tenant's policy documents and tool results are treated as data, not instructions, and the
assistant's tools are read-only. Please try to:

- make it reveal another employee's or another tenant's data;
- make it act (for example, apply for leave);
- make it leak masked numbers.

Do this through questions and through a planted policy document; tenant A's HR may upload one.
Each question costs real money, so please limit this to about 300 questions.

## 5. Out of scope

- Denial-of-service and load testing.
- Social engineering.
- Physical access.
- The cloud provider's own infrastructure.
- Third-party SaaS (SMS and e-mail gateways, the AI provider).

## 6. Rules

- **Window:** to be agreed. Testing runs from fixed IP addresses, which we allow-list.
- **Critical findings** (any cross-tenant access or any unauthorised money movement): report
  them the same day to the security contact.
- **Report:** each finding with severity (CVSS 3.1), reproduction steps, affected route and a
  suggested fix.
- **Retest:** we fix and you retest. **The pilot does not start until no critical or high
  finding is open.**

## 7. What has already been tested internally

| Area | Internal test |
| --- | --- |
| Isolation | Automated tests on every build: a sweep of every route with another tenant's real ids, forced RLS on every tenant table, the permission matrix per role, and every route declaring who may call it. |
| Authentication and abuse | 2FA and step-up, lockout. |
| Duplicate protection | Idempotency, duplicate payments. |
| Integrity | Audit chain verification. |
| Data protection | Masking before AI calls. |
| Consent and retention | Consent enforcement, retention. |

See `docs/security/checklist.md` for the evidence. These are not a substitute for this test.
