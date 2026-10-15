# ADR 0012 — WP9: employee self-service PWA

- **Status:** accepted · 2026-10-15
- **Open:** the acceptance (pilot employees completing the usability tasks on their own phones)
  happens at the pilot, following `docs/usability-test-wp9.md`. The scripted rehearsal of those
  tasks passes.

## 1. Where and what

The app lives in `Frontend/web`. It is Next.js 16 (App Router) with Tailwind CSS 4, installable
as a PWA. npm package names cannot contain capital letters, so it cannot sit directly in
`Frontend`. The guide's `apps/web` plan allows the PWA to be a route group of the web app, and
the later admin and manager web app can join it here.

The app covers the WP9 scope:

- punch in and out;
- leave: apply, status and balances;
- payslips (with PDF);
- editing one's own contact details;
- an approvals inbox for managers.

It also shows the month's attendance, and lets privileged roles set up two-step verification.

The pages are **client components** that call the API. There is no server rendering of
personal data, and Cache Components are turned off. This keeps personal data out of any server
cache, and the pages small and simple.

## 2. Backend-for-frontend: the token never reaches JavaScript

Instead of the browser calling the API with a bearer token kept in localStorage, which is open
to XSS theft, the app's own route handlers stand in between:

- `POST /api/session` logs in through the API. The access token is stored in an **httpOnly,
  SameSite=Strict** cookie (Secure in production), lasting the token's 30 minutes. The page only
  learns "signed in".
- `/api/erp/*` forwards the request to the API with `Authorization: Bearer <cookie>`. It passes
  through only an allow-list of headers: content-type, idempotency-key, x-otp-code, x-language,
  accept-language, and the client IP and user-agent for the audit log. Responses, including
  PDFs, stream back unchanged. A 401 from the API also deletes the cookie.
- **CSRF:** every call must carry `x-erp-client: pwa`. A cross-site form cannot add a custom
  header without a CORS preflight, which this app never allows. SameSite=Strict adds a second
  layer.
- `proxy.ts` (Next 16's renamed middleware) sends requests without a session cookie to `/login`
  before any page renders.

All permission checks stay in the API (guide §5 rule 8). The app only hides screens: for
example, Approvals is shown to users who have a role besides `employee`.

## 3. Language

Text is defined in `lib/i18n.tsx` (Bangla and English). Typing guarantees that every English key
has a Bangla text.

- **Formatting:** amounts use lakh grouping, with Bangla digits in Bangla; dates and times use
  Asia/Dhaka (`lib/format.ts`).
- **Fonts:** Noto Sans Bengali is served from `/fonts`, in two `unicode-range` parts, with no
  third-party font service.
- **Default and memory:** the default language is the account's saved preference on first use,
  then the choice made on the phone.
- **Server messages:** the API previously took the language only from the token (the saved
  preference). It now honours **`X-Language: bn|en`** first, so server messages follow the
  language chosen in the app. The change is in `AuthGuard` and `HttpExceptionFilter`, and is
  tested in `http.int-spec`.

## 4. Punching from the phone

- **The phone's install id:** a random id kept in the browser (`lib/device.ts`). Registering
  sends it, and HR approves it (one active phone per person). Clearing the browser data means
  registering again.
- **A punch** sends the install id and the phone's position (`navigator.geolocation`). The API
  checks the device, the branch geo-fence and the time. The server's time is the punch time.
- **Office computer:** the "punch from office computer" button works only when the employee's
  attendance profile allows web punch.
- **Demo data:** the seed now also gives the Chattogram branch a geo-fence (Agrabad), because
  Rafi was transferred there.

## 5. PWA and offline

- `app/manifest.ts` and the icons make the app installable ("Add to Home screen").
- `public/sw.js` handles caching:
  - app files: cache first;
  - pages: network first, with the cached copy or `/offline` as fallback;
  - `/api`: **never cached**, so personal data and actions always go to the network.
- An online/offline banner tells the user when they are offline.
- There is **no offline punch queue**. A punch's legal time is the server's time, so a queued
  punch would be wrong. Offline device punches remain the biometric agent's job (WP4).

## 6. Tests

- **Unit (Vitest):** formatting, translations, header forwarding and cookie options.
- **End to end (Playwright on a Pixel 7 profile, Dhaka time zone, Agrabad location):** the
  usability tasks against the running API and demo data:
  - sign in (Bangla);
  - register a phone, HR approves it, punch;
  - apply for leave, then cancel it;
  - payslips;
  - edit contact details and switch language;
  - the manager's inbox, where reject needs a comment;
  - the offline banner;
  - being sent to login when signed out.
- **Rate limit:** the API allows 10 logins per minute, so a setup step signs in each user once
  and reuses the session.

## 7. Not included (later work packages)

- Push notifications (WP10, n8n).
- Payslip e-mail delivery (WP10).
- Uploading a medical certificate when applying for leave. The API supports it; the app does
  not show an upload yet.
- Attendance correction and overtime requests from the phone.
- The admin and HR web screens.
