# ADR 0007 — WP4: attendance, holiday calendars, service keys

- **Status:** accepted · 2026-10-14
- **Open decision:** the first biometric device brand (guide §27). Everything except the
  device-specific adapter in the office sync agent is built. The agent speaks to the API through
  the documented batch endpoint below.

## 1. Raw punches, computed days

- `attendance_punches` is **append-only**: a trigger blocks UPDATE and DELETE. A unique index on
  (employee, time, source, device) drops duplicates, so an agent may resend safely. The
  sources are `device`, `mobile`, `web`, and `correction` (an approved correction adds punches;
  nothing is edited).
- `attendance_days` is **derived** by a pure function (`day-status.ts`, unit-tested). Statuses:
  present, late, half_day, absent, on_leave, holiday, weekend, missing_punch.
  - A punch counts for a day if it falls within 4 h before the shift start to 6 h after the
    shift end. This handles night shifts that end the next morning.
  - **Late** means the first punch came after start + grace; the late minutes count from the
    shift start.
  - **Half-day** means fewer worked minutes than the shift's `half_day_minutes`.
  - **Overtime** counts only for OT-eligible grades: time after the shift end, or all time on a
    weekend or holiday. It becomes payable (`ot_approved_minutes`) only after Dept Head
    approval, and never more than was worked.
- Shift = the employee's assignment on that date, else the company default. An active override
  (e.g. Ramadan hours, for the whole company or one branch) replaces the times.
- Days are recomputed on every punch or upload, approved correction, holiday change, shift
  assignment or override, by HR's recompute, and by the worker's hourly "close yesterday"
  job. That job announces `attendance.daily_closed` once per company and day.

## 2. Locked months and adjustments

`POST /attendance/locks` computes the month one last time, then sets `locked = true`. Locked
days are never rewritten. If a recompute (holiday moved, late upload, correction approved)
would now give a different result, an `attendance_adjustments` row stores the before and after
values. Payroll (WP6) applies it in the next period and fills `payroll_period`.

## 3. Holiday calendars are their own module

`calendar` owns `holiday_calendars` and `holidays` and answers "is this a working day at this
branch?" for **both** attendance and the approval SLA. Holidays now count as non-working time
in SLA deadlines, as promised in ADR 0005.

When a holiday is added, moved or removed, its listeners run in the same transaction.
Attendance registers one and recomputes the affected dates for every employee of the branches
using that calendar. Branches choose a calendar (`branches.holiday_calendar_id`), and a
foreign key keeps the calendar in the same company.

## 4. Mobile and web punch

- **The server clock is the punch time.** The phone's clock is never trusted.
- **The phone must be registered and approved by HR.** Each employee has one active phone,
  and each phone belongs to one employee, so nobody can punch for a colleague on the same phone.
- **Geo-fence check.** The distance (haversine) from the branch geo-fence centre must be within
  `radius + 50 m` to allow for GPS error. The rejection reports the distance. A branch without
  a geo-fence cannot be used for mobile punch.
- **Web punch** is allowed only when the employee's attendance profile says so ("approved
  remote staff", spec §6.2).
- Selfie capture (spec §6.2: optional) and biometric/selfie consent records (§11) are not built.
  They come with the PWA (WP9).

## 5. Service keys (machines)

`service_keys` hold a SHA-256 of a 256-bit random secret, which is shown once. Each key carries
a list of permissions and optionally one company. `ServiceKeyGuard` reads
`Authorization: ServiceKey <id>.<secret>`; the security-definer function
`auth_find_service_key()` resolves the tenant. The request then runs with **only** the key's
permissions. `attendance.ingest` is a machine-only permission that no human role has.
Creating and revoking keys need `integrations.manage` and a step-up code. The route-permission
test accepts `ServiceKeyGuard` as a guard.

**Agent contract** (`POST /attendance/device-batches`, idempotent): `{ deviceSerial, branchId,
deviceTime, punches[{ deviceUserId, punchedAt }] }`. The response reports how many punches were
inserted, how many were duplicates, any unknown device users, and the clock drift, with a
warning above 5 minutes. Old punches simply update old days, which is how an agent catches up
after an outage. Device user numbers map to employees through `attendance_profiles`.

## 6. Smaller decisions

- **Late penalty** ("N lates = 1 day", spec §6.2) is calculated in the monthly summary only when
  the company setting is on. It is **off by default** until legal review (guide §1). Payroll
  decides later whether the day comes from leave or pay.
- **Correction limit** per employee per month is a company setting (default 3), counting
  pending and approved requests. Corrections for future dates are refused.
- **Leave** feeds attendance through `AttendanceComputeService.setLeaveSource()`. WP5 plugs
  in there.
- **Performance** is fine for pilots (one employee-day at a time). Batch computation for
  1,000+ employees is part of the WP12 load test (guide §21).
