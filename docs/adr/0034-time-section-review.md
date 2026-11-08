# ADR 0034 — The Time section: attendance, leave and the approval a person has to understand

- **Status:** accepted · 2026-11-04
- **Why now:** the second group in the screen-by-screen review of the HR & Admin portal
  (**Time**: attendance, leave, approvals), asking the same question of every feature — *is it good,
  and is it needed?* ADR 0033 did People; the answers fell into the same three kinds, plus one new
  kind: a screen that had the facts and threw them away.
- **Covered by:**
  - `backend/test/integration/attendance.int-spec.ts` — the phone register across its three states,
    revoking an approved phone and the punch that is then refused, the employee id on the day list,
    and the monthly CSV (its columns, the BOM, the audit entry, a Dept Head's narrower file, and
    Accounts refused);
  - `backend/test/integration/leave.int-spec.ts` — the calendar company-wide (and a Dept Head still
    seeing only their own people, an employee refused, neither narrowing given → 400), and HR
    cancelling leave that has already started where the employee cannot, with the reversal in the
    ledger;
  - `backend/test/integration/approvals.int-spec.ts` — a request naming its requester, approvers and
    history actors (and `execute` having no actor), and the company-wide list with its filters,
    refused to HR and to an employee;
  - `backend/test/integration/route-permissions.int-spec.ts` — the three new routes declare who may
    call them;
  - the e2e block "Time: the work HR, a Dept Head and an Admin actually do" in
    `Frontend/web/e2e/portal.spec.ts`.

## 1. A phone that could be approved and never stopped

`GET /attendance/devices` has always taken `status=pending|active|revoked`, and
`POST /attendance/devices/:id/revoke` has always worked on any phone. The Phones tab asked for
`?status=pending` and nothing else, and put the Revoke button only on that queue. So:

- nobody could see **which phones may currently punch** — the register did not exist as a screen;
- an **approved phone could never be taken back**. A resigned employee's phone kept punching, inside
  the geo-fence or not, until somebody thought to `curl`.

A phone that punches attendance is a key to the payroll, so this is the attendance twin of ADR
0033's "nothing in the product ever set `disabled` on a login". The tab is now the register: the
three states are all reachable, the live ones show when they were approved, and any phone that is
not already stopped can be stopped — with a reason, which the audit log keeps and the employee never
sees.

## 2. The one leave power that exists only for HR, with no button

`LeaveRequestsService.cancel` has this line:

```ts
if (!isHr && request.from_date <= today) throw new ForbiddenException(MSG.LEAVE_CANNOT_CANCEL);
```

Leave that has already started can be cancelled **only by HR** — the person came back early, or was
called back for an audit — and the days taken are written back as a `reversal`, so the ledger still
says what happened. The portal had no cancel button anywhere, so the one case the rule was written
for could not be done, and the balance stayed wrong for good. It is now on the employee's leave
panel, with the reason the reversal note carries.

## 3. The screen that had the facts and printed none of them

`GET /approvals/requests/:id` returns `chainName`, `steps` (the whole configured chain) and
`approvers` (each person, their step, their status, when they acted, their deadline, and **why they
were assigned** — `line_manager`, `dept_head`, `role:hr`). The decision screen displayed the
snapshot and the history and nothing else. An approver could not see who had to agree after them,
who was holding a request up, or why it had come to them.

And what it did display, it displayed as data:

```
Leave Type Id  3f9a1c7e-…     From  2026-11-08     Half Day  null     submitted
```

`label(k)` was a camelCase-to-Title-Case transform, English only; objects were dropped silently;
dates and amounts came through raw; `history[].action` was the database's own verb. This is the one
screen in the product where a person must understand what they are agreeing to.

Now: the chain is drawn step by step with the step in progress marked ("This step is yours" /
"Waiting for Tanvir Hossain"), each person named with why they are there and what they did;
`lib/approval-text.ts` gives every snapshot field its sentence in both languages, formats the value
by what it is (date, month, taka, yes/no, list) and drops the ids and nulls, falling back to a
tidied-up key for a field nobody has named yet — because hiding it would hide what is being
approved; the history reads as sentences with the actors' names, through a new
`UserDirectory.namesOf`.

Also here: the withdraw reason moved out of `window.prompt` into a dialog, the same defect ADR 0033
fixed on Users.

## 4. New API work

- **`GET /approvals/requests?companyId=&requestType=&state=&open=&overdue=`** — every request of the
  company. `approvals.view_all` was granted to Admin and Auditor and honoured by `assertCanSee`, but
  no endpoint ever served it, so the permission could only open a request whose id you already knew:
  *"which approvals are stuck?"*, the one question an Admin is asked about approvals, had no answer.
  `overdue` means the current step has passed its escalation time.
- **`GET /attendance/summary.csv?companyId=&period=`** — the month's attendance sheet. Payroll
  verification compares it against the run and a labour inspection asks for the register; neither
  could be done from a screen. Same access scope as the summary (a Dept Head exports their own
  department), capped, and audited (`attendance.exported`) because personal data left the system.
- **`GET /leave/team-calendar?companyId=`** — `departmentId` is now optional. HR asking "who is off
  next week" had to click through every department in turn; a Dept Head asking the same question
  still sees only their own people, through `scopeFilter`.
- Smaller: `/attendance/days` now returns `employeeId` (the list could not link to the person whose
  day needed fixing), and the inbox and request detail now carry an `overdue` flag computed from the
  **server's** clock — the browser's clock has no business deciding whether a business deadline has
  passed, and `react-hooks/purity` rightly refuses `Date.now()` in a render.

## 5. Dead ends made into routes

The Day and Month lists are where HR *notices* a problem, and `DayRequests` on the employee's
attendance tab is where a correction can actually be asked for. The two were not connected: a row
was not clickable and `?tab=` did not exist. Rows now open the person on their attendance tab, the
Day list can be narrowed to a department (`DaysQueryDto` always accepted `departmentId`), and
`Table` grew a `rowTitle` so a clickable row can say where it goes instead of only changing colour.

## 6. A bug found by driving the screens: corrections were dead five months a year

Asking for an attendance correction returned a 500 on **4 November 2026**, and the two usability
tasks for it (9 and 10) failed with it. The monthly limit counted like this:

```ts
const month = date.slice(0, 7);
… .where('work_date', '>=', `${month}-01`).where('work_date', '<=', `${month}-31`)
```

Postgres accepts `2026-10-31` and refuses `2026-11-31` — *date/time field value out of range* —
so in **April, June, September, November and February** nobody could request a correction at all,
while the feature worked perfectly for the other seven months. The tests that cover it had only ever
run with the clock in October.

`monthRange` (already written, privately, inside `attendance.service.ts`) now lives in
`platform/dates/business-date.ts` beside `daysInMonth`, and the limit counts to the month's real last
day. `business-date.spec.ts` pins it for a 30-day month, February, a leap February and December, and
the integration suite now asks for a correction in September so the case cannot regress.

The lesson for the remaining groups: a date-arithmetic bug of this shape is invisible for most of the
year, and a fixed-clock test suite will happily agree with it.

## 7. What the review decided *not* to build

- **Bulk approve in the inbox.** Each decision is a judgement with the approver's name on it; a
  "select all" button is how an approval chain becomes a rubber stamp.
- **A company-wide leave balance report.** Year-end planning would use it, but the year-end run
  already prints what it carried, lapsed and encashed, and one person's balance is on their own tab.
  Worth building when a pilot asks.
- **Editing a punch directly.** Corrections go through an approval on purpose (spec §5), and a
  screen that writes a punch without one would quietly undo that.
- **A second attendance export for the register's full day-by-day grid.** The monthly totals are
  what payroll and an inspection ask for first; the per-day grid is a bigger design question.
