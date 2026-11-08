# My Office (আমার অফিস): employee app (PWA) and HR & Admin portal

A Next.js 16 app for employees and line managers, built for the phone. It runs in Bangla or
English.

| Screen | What it does |
| --- | --- |
| **Home** | Today's attendance, leave balances, latest payslip, approvals waiting |
| **Attendance** | Punch from a registered phone inside the office geo-fence (after agreeing to the location notice) (or from an office computer, when allowed); the month's days |
| **Leave** | Balances, apply (with a day count and team warning before sending), status, cancel |
| **Payslips** | List, details, PDF in Bangla or English, optionally password-protected |
| **Approvals** | Managers only: inbox, details, approve, return or reject (a comment is required to return or reject) |
| **Notifications** (bell, top right) | In-app messages from the ERP: approvals waiting, salary paid, leave decisions, the morning attendance list (WP10) |
| **Assistant** (home card, when AI is on) | Questions about company policy and your own leave, attendance and pay, in Bangla or English; answers name their source; 👍 / 👎 feedback. Read-only, hidden when AI is off (WP11) |
| **Me** | Profile, edit contact details, consents (biometric device, phone location, photo: read the notice, agree or withdraw, WP12), language, two-step verification for privileged roles, sign out |

## HR & Admin portal (`/portal`, WP13)

The same app has a desktop portal for HR, Accounts and Admin. It shares the login, and each
user sees the screens their roles allow (`permissions` from `/auth/me`; the API still checks
every request). The screens:

- **Dashboard.**
- **People:** employees (hire, onboarding, job changes, salary, bank, leave, attendance and
  consent, payslips), organization, and users & roles.
- **Time:** attendance (day, month and lock, phones, shifts, holidays), leave, and the
  approvals inbox.
- **Payroll:** runs (calculate, flags with AI explanations, employees with calculation trace,
  submit, bank files), monthly items, payroll setup, and Gate 1 parallel payroll.
- **Finance (Phase 2):** books (setup, nightly checks), vouchers (maker-checker, reversal),
  chart of accounts (posting accounts, closing months), financial reports (trial balance,
  P&L per department, balance sheet, general ledger, aged payables), vendors (bank account,
  statement, tax certificate), vendor bills (VAT and tax at source, payment), and VAT & tax at
  source (deposit by challan, certificates, rates); expense claims (to pay, receipts, cash
  advances, the advances sub-ledger, categories). See `docs/adr/0017` to `docs/adr/0019`.
- **Administration:** data migration, AI, audit log, and integrations.

High-risk actions ask for a 2FA code in a dialog and retry with the same idempotency key.
Text is in `src/lib/portal-text` (Bangla and English). See `docs/adr/0016`.

Demo: sign in as `farzana.akter@demo.test` (HR), `sujit.das@demo.test` (Accounts) or
`anisur.rahman@demo.test` (Admin) and open http://localhost:3001/portal. For finance,
`sujit.das@demo.test` prepares and `admin@demo.test` (also an Accounts user) approves.

## How it talks to the API

```
phone browser ──► this app (Next.js, :3001) ──► ERP API (backend, :3000)
                  /api/session  login / logout / who am I
                  /api/erp/*    pass-through, adds "Authorization: Bearer <token>"
```

- **The token stays on the server side of this app.** After login it is kept in an `httpOnly`,
  `SameSite=Strict` cookie. JavaScript in the page never sees it, and the browser never calls
  the API directly.
- **CSRF protection:** the app's own pages send the header `x-erp-client: pwa`. Requests without
  it are refused.
- **Duplicate protection:** every write gets a fresh `Idempotency-Key`, so a double tap does
  nothing twice.
- **Language:** the app sends `X-Language: bn|en`, so server messages match the language
  chosen in the app.
- **Offline:** the service worker (`public/sw.js`) caches only app files, never personal data.
  Without a network, the app shows an offline banner or the offline page. Punching always needs
  the internet, because the server's clock is the punch time.

## Public enquiry form (`/enquiry/<form>`)

A page for customers, with no sign-in. The company shares the link on its Facebook page, on
WhatsApp, or as a QR code on the shop counter. Each enquiry becomes a lead in the CRM, and it goes
to the territory's salesperson the same way an n8n lead does.

```
customer ──► /enquiry/demo?ref=facebook-page ──► /api/enquiry/demo ──► POST /companies/:id/leads/capture
             (no sign-in)                         (adds the service key)   (duplicate check, owner by territory)
```

- **Setting it up:**
  1. Create a service key with the permission `crm.capture` for the company. Use the portal
     (Users & roles → Service keys) or `POST /service-keys`.
  2. Put the key in `.env.local`, all on one line:

     ```bash
     ENQUIRY_FORMS={"demo":{"companyId":"<uuid>","serviceKey":"ServiceKey <id>.<secret>","nameEn":"Demo Trading Ltd","nameBn":"ডেমো ট্রেডিং লিমিটেড"}}
     ```

     Each key of `ENQUIRY_FORMS` is a form's link name. Without the setting, every
     `/enquiry/...` link shows "not found".
- **`?ref=`:** says where the link was shared. It is saved on the lead as its campaign, for
  example `Enquiry form (ref: facebook-page)`.
- **The key stays on the server.** The page gets only the company's name.
- **Duplicates:** one opened form makes one lead, even if Send is pressed twice. A phone number
  or e-mail the CRM already knows adds an "enquired again" note to that lead or customer. The
  visitor sees the same thanks either way.
- **Spam:** three checks drop a send quietly, and the visitor still sees the thanks:
  - a hidden field that people never fill;
  - at least 3 seconds on the page;
  - at most 5 sends per IP address per form in 10 minutes. The count is kept in this server's
    memory, so several servers need a shared store.

  Before a public pilot, add a captcha and serve the page over HTTPS.

## Run it

```bash
cp .env.example .env.local         # BACKEND_URL=http://localhost:3000
npm install
npm run dev                        # http://localhost:3001  (API must be running: cd ../../backend && npm run start:dev)
```

**Production:** run `npm run build && npm run start`, and serve the app over **HTTPS**. HTTPS is
needed for the secure session cookie, for phone location, and for "Add to Home screen".

**Testing on phones over the office Wi-Fi without HTTPS:** add `SESSION_COOKIE_SECURE=false` to
`.env.local`. Location may still be refused by the phone's browser on plain `http`.

**Demo logins** (password `Demo-Pass-123`, company code `demo`):

- `rafi@demo.test`: employee in Chattogram. The geo-fence is Agrabad, 22.3245, 91.8123.
- `tanvir.hossain@demo.test`: Department Head, with approvals.
- `farzana.akter@demo.test`: HR. HR must set up two-step verification only when
  `SECURITY_MFA_ENFORCED=true`.

## Tests

```bash
npm test             # unit: formatting (lakh, Bangla digits, Dhaka time), translations, API pass-through
npm run typecheck
npm run lint
npm run e2e          # usability tasks on a phone (Pixel 7) + the HR & Admin portal and finance screens on a desktop browser
                     # + the public enquiry form, signed out (skipped without a "demo" form in ENQUIRY_FORMS)
```

`npm run e2e` needs the API and the built app running, with the demo data (`npm run db:seed` in
`backend`). The assistant task needs the API with `AI_PROVIDER=fake` (or `anthropic`); it is skipped when AI is off. It changes the demo data: it registers and approves a test phone for Rafi, which
replaces his demo phone, punches, saves his emergency contact, and applies for and cancels a
leave request.

The tasks are the ones pilot employees do in the usability test:
[docs/usability-test-wp9.md](../../docs/usability-test-wp9.md).

## Code map

```
src/
  app/
    login/              sign in (+ 2FA code)
    (app)/              signed-in screens: home, attendance, leave, payslips, approvals, profile, assistant, claims (WP16)
    (portal)/portal/    HR & Admin portal (WP13): dashboard, employees, organization, users, attendance, leave,
                        approvals, payroll (runs, items, setup), gate-1, migration, ai, audit, integrations;
                        finance (books, vouchers, accounts, reports), vendors, bills, tax (Phase 2)
    api/session/        login / logout / current user (sets the httpOnly cookie)
    api/erp/[...path]/  pass-through to the ERP API
    manifest.ts         PWA manifest            offline/  page shown when offline
  proxy.ts              no session cookie -> /login
  lib/
    api.ts              api.get / api.post / useApi (Idempotency-Key, X-Language, 401 -> login)
    i18n.tsx            Bangla / English text          format.ts  money, dates, Bangla digits
    session.tsx         who is signed in               device.ts  phone install id, location
    server/             server-side only: API URL, cookie, header forwarding
  components/           ui.tsx (buttons, cards, fields), app-shell.tsx (bottom navigation),
                        portal/ (shell, context, kit, employee tabs, run payments, finance line editors)
public/                 sw.js (service worker), icons/, fonts/ (Noto Sans Bengali, OFL licence)
e2e/                    Playwright usability tasks
```
