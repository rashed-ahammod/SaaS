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

## Update 2026-10-17: role-by-role check, gaps closed

A check of attendance for every role, comparing the spec (§4, §6.2) with what each role can do
on screen, found these gaps. The backend rules were complete; most gaps were missing screens.

1. **Employee: correction request.** Each day in the app's attendance list can be fixed: the
   employee asks for a correction (in and/or out time, reason). "My corrections and overtime"
   shows each request's status.
2. **Employee and HR: overtime claim.** Shown on a day where more overtime was worked than
   approved. The Dept Head approves it in the inbox. The approval label for request type
   `overtime` was also missing and has been added.
3. **Dept Head: month view (permission bug).** The month summary, the after-lock adjustments and
   the locks list checked `attendance.view` at company scope, so a Dept Head got 403. A
   department-scoped grant now works, and the summary and adjustments are filtered to the
   departments in scope. Covered in `attendance.int-spec.ts`.
4. **HR: holidays.** A holiday can be changed (moved, e.g. Eid after moon sighting) or removed
   with a reason. Affected unlocked days are recalculated, and locked days become adjustments.
5. **HR: shifts per employee and temporary hours.**
   - A shift can be assigned to an employee from a date (employee → Attendance & consent tab).
   - Temporary hours for a date range and branch, e.g. Ramadan, are added on the Shifts tab.
6. **HR: shift edit.** Name, hours, grace, half-day threshold, default and active.
7. **HR: one employee's month, and changes after the lock.**
   - The employee page shows the month day by day; HR can file a correction or overtime claim
     on the employee's behalf.
   - The Month tab lists the changes made after the lock, and which payroll took each one.
8. **Admin: company attendance rules.** The Organization page (Company tab) now edits:
   - corrections allowed per employee per month;
   - the late penalty, with the number of late days that count as one deducted day. Keep it
     off until legal review.

The overtime "more than was worked" error now uses a translated message
(`ATTENDANCE_OVERTIME_TOO_MUCH`) with details.

**Geo-fence follow-up (same day):**
- Branches can now be edited in the portal (Organization → Branches → Edit): name, address, weekly
  holidays, and the geo-fence. You can switch it off, enter latitude, longitude and radius, or
  press "Use my current location" while standing in the office.
- When a phone punch is outside the area, the message now says how far away the phone is, from
  which branch, and the allowed distance, for example "You are 245 km from Chattogram Office
  (allowed within 200 m)". The API returns `details.branch` with the distance.

**Still open (low priority):**
- Admin cannot see the list of phones waiting for approval; this needs `attendance.manage`.
- An optional selfie with a mobile punch is not built; only the consent for it exists.

## Update 2026-10-17: phone punch misuse review (migration 0024)

**Finding.** The geo-fence is checked on the server, but the location comes from the phone.
A browser app (PWA) cannot detect fake GPS or mock locations, and cannot use Play Integrity.
Someone can also send a hand-made request with office coordinates. So a phone punch is
evidence, not proof. The office biometric device remains the reliable source; phone punches
suit field staff and are reviewed.

**Implemented:**
1. **GPS accuracy.** The app sends `accuracy` (required).
   - A reading worse than 100 m is refused ("step near a window"): `ATTENDANCE_WEAK_GPS`.
   - The allowance outside the fence follows the reported accuracy, at most 50 m: a punch is
     accepted when `distance ≤ radius + min(accuracy, 50)`. It used to be a flat +50 m.
   - Accuracy is stored with the punch.
2. **Evidence on punches.** Phone and web punches now store the IP and the browser (user
   agent).
3. **Refused attempts are recorded.** Every refused phone punch (outside the area, weak GPS,
   unknown phone, no geo-fence) goes into `punch_attempts`, which is append-only. It is
   written in its own short transaction, so it is kept although the request fails.
4. **Retention.** Coordinates, accuracy, IP and browser on punches and attempts are blanked
   after the location retention period (`retention_apply`); the times stay.
5. **Punch review.** `GET /attendance/punch-review?companyId&from&to` and the portal tab
   Attendance → Punch review show four rules. They are reasons to look, not proof.
   - **Same coordinates** to the last decimal on two or more days.
   - **Impossible travel:** over 120 km/h and at least 1 km between two locations of a person
     within 2 hours, counting refused attempts.
   - **Three or more refused attempts** in the period.
   - **One IP, several employees** within 10 minutes. This is normal on office Wi-Fi.

   HR and Admin see the whole company; a Dept Head sees their department.
6. **Geo-fence guardrails (portal).** Warnings appear for a radius over 300 m and for a point
   outside Bangladesh (latitude and longitude swapped). An "Open in Google Maps" link shows
   the centre. Saving a doubtful fence needs "I checked the location on the map". Fence
   changes are already in the tamper-evident audit log (`branch.updated`).

**Not done, and why:**
- **Mock-location detection and Play Integrity** need a native Android app; rooted phones can
  still hide a mock location.
- **Device-bound signed punches and a selfie at punch:** optional, if misuse is actually
  seen.
- **Office IP allowlist for web punches:** optional.
