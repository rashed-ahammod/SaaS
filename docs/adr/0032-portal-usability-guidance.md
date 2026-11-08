# ADR 0032 — Making the HR & Admin portal explain itself

- **Status:** accepted · 2026-11-04
- **Why now:** the portal had grown to about fifty screens. Everything worked, but a new HR
  officer or Admin opening it was given a flat list of nouns — "Monthly items", "Gate 1",
  "Opening balances" — with nothing saying what a screen is for, what order the work goes in,
  or what to do first. No migration; no API behaviour changed except one new read route.
- **Covered by:**
  - `backend/test/integration/portal-home.int-spec.ts` (6 tests);
  - the e2e block "finding your way around (Farzana)" in `Frontend/web/e2e/portal.spec.ts`.

## 1. One registry behind menu, search, breadcrumb and guide

`Frontend/web/src/lib/portal-guide.ts` is now the single list of portal screens: id, href,
label key, the permissions that open it, an icon, how many guide steps it has, and which
screens the work continues on. The sidebar, the screen search, the breadcrumb and the
per-screen guide all read that list, so a screen cannot appear in one and be missing from
another. Adding a screen means adding one entry plus its text.

The guide text lives in `Frontend/web/src/lib/portal-text/guide.ts`, Bangla and English, with
TypeScript checking that Bangla has every English key (as the other portal text files do):

- `g.<id>.purpose` — one sentence: what this screen is for.
- `g.<id>.s1…s4` — the steps that work takes, in order, including the rule that is easy to get
  wrong (payroll only uses locked months; a posted voucher is reversed, never edited; a
  returned request goes back to the requester instead of ending).

## 2. What the user now sees

- **A guide on every screen** (`components/portal/guide.tsx`, rendered once by the shell, so no
  screen has to remember it): the purpose line is always visible; "How it works" and "Where to
  next" open on demand, and whether they are open is remembered per person, not per screen, so
  someone who knows the system folds them away once.
- **A breadcrumb** (group › screen) above it, since a detail screen three levels down used to
  give no clue where it sat.
- **Screen search, Ctrl + K** (`components/portal/screen-search.tsx`): matches the screen's name
  *and* its purpose, in either language, so "old register" finds Gate 1 and "বেতন" finds payroll.
- **A menu that can be scanned**: one line icon per screen, group hints, and groups that fold
  away. Groups start expanded, so nothing a user knew where to find has moved.
- **The portal on a phone**: the sidebar was `hidden md:flex`, which left no navigation at all
  below 768 px. The same menu is now a drawer behind ☰.
- **Empty lists that say what to do next** (`<EmptyState/>`), starting with the employee list:
  "No employees yet — add the first person, or bring the old list in from Data migration",
  with the action beside it, instead of "Nothing here yet."

## 3. The dashboard answers questions in the order people ask them

`GET /companies/:companyId/portal/overview` (new module `backend/src/modules/portal`) returns,
in one call, what the home screen used to assemble from six:

- **`setup`** — the steps a company must finish before payroll can run (branches, departments,
  designations, grades, shifts, holidays, leave types, employees, salary structures, a salary
  for every employee, logins, the first run, Gate 1), each with whether it is done, how many
  records exist, and the screen that finishes it.
- **`attention`** — what waits for *this* user now: their approval inbox, phones waiting to be
  approved, salary-account changes, pending leave, probations ending within 30 days, last
  month's attendance still unlocked, payroll runs not yet paid. Counts of zero are left out.

Both are filtered by the caller's own permissions, so HR, Accounts and an Admin of the same
company get different lists — a step or a count the user cannot act on is never shown. The
route is `@AnyAuthenticated()` because the service, not the route, decides what each user may
see; a user with no back-office permission gets empty lists.

The screen then shows, in order: what is waiting → setup progress → common tasks for this
user's role → the few numbers worth a glance (headcount, latest run, Gate 1), which is what the
old dashboard showed on its own.

## 4. The one rule this bends

`PortalService` reads tables owned by org, employees, attendance, leave, payroll, approvals and
parallel-run. ADR 0005 says a module owns its tables. This is the second documented exception
after `AccessService`, on these terms: it only **counts** rows, read-only, never writes, and
never interprets a row beyond "does one exist". Anything that needs more than a count belongs
on the owning module's screen, which every item here links to.
