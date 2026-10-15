# My Office (আমার অফিস): employee self-service app (PWA)

A Next.js 16 app for employees and line managers, built for the phone. It runs in Bangla or
English.

| Screen | What it does |
| --- | --- |
| **Home** | Today's attendance, leave balances, latest payslip, approvals waiting |
| **Attendance** | Punch from a registered phone inside the office geo-fence (or from an office computer, when allowed); the month's days |
| **Leave** | Balances, apply (with a day count and team warning before sending), status, cancel |
| **Payslips** | List, details, PDF in Bangla or English, optionally password-protected |
| **Approvals** | Managers only: inbox, details, approve, return or reject (a comment is required to return or reject) |
| **Notifications** (bell, top right) | In-app messages from the ERP: approvals waiting, salary paid, leave decisions, the morning attendance list (WP10) |
| **Me** | Profile, edit contact details, language, two-step verification for privileged roles, sign out |

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
npm run e2e          # usability tasks on a phone-sized browser (Playwright, Pixel 7, Dhaka time zone)
```

`npm run e2e` needs the API and the built app running, with the demo data (`npm run db:seed` in
`backend`). It changes the demo data: it registers and approves a test phone for Rafi, which
replaces his demo phone, punches, saves his emergency contact, and applies for and cancels a
leave request.

The tasks are the ones pilot employees do in the usability test:
[docs/usability-test-wp9.md](../../docs/usability-test-wp9.md).

## Code map

```
src/
  app/
    login/              sign in (+ 2FA code)
    (app)/              signed-in screens: home, attendance, leave, payslips, approvals, profile
    api/session/        login / logout / current user (sets the httpOnly cookie)
    api/erp/[...path]/  pass-through to the ERP API
    manifest.ts         PWA manifest            offline/  page shown when offline
  proxy.ts              no session cookie -> /login
  lib/
    api.ts              api.get / api.post / useApi (Idempotency-Key, X-Language, 401 -> login)
    i18n.tsx            Bangla / English text          format.ts  money, dates, Bangla digits
    session.tsx         who is signed in               device.ts  phone install id, location
    server/             server-side only: API URL, cookie, header forwarding
  components/           ui.tsx (buttons, cards, fields), app-shell.tsx (bottom navigation)
public/                 sw.js (service worker), icons/, fonts/ (Noto Sans Bengali, OFL licence)
e2e/                    Playwright usability tasks
```
