# Gate 1: parallel payroll for a pilot company

Spec §12: a pilot pays salaries from the ERP only after it has run **two parallel payrolls
that match its current payroll**. During those two months, the old system still pays; the
ERP calculates the same months and the results are compared, employee by employee.

## Before the first parallel month

1. **Pilot data:** migrated and reconciled, with the reconciliation signed (WP8,
   `POST /companies/:id/migration/sign-off`).
2. **Rule pack** accepted, salary structures and salaries loaded, and payroll settings checked
   with the pilot's Accounts.
3. **Attendance** recorded in the ERP for the whole month:
   - the device agent, or phone punches;
   - consent recorded: signed biometric forms entered by HR, and location consent in the app;
   - the month locked.
4. **Agree the tolerance** with the pilot's Accounts. Use `0.00`, or `1.00` if the old system
   rounds to whole taka.

## Each parallel month

Everything below is done in the HR & Admin portal: **Payroll runs** and **Parallel payroll (Gate 1)**. The API routes are listed for reference.

1. **HR runs the payroll in the ERP:** create the regular run for the month, calculate it, and
   clear or fix the flags. Do **not** generate a bank file.
2. **HR exports the old system's payroll register** for the same month. It needs one row per
   employee with these columns (`GET /parallel-comparisons/template`):
   - `employee_code`, `gross` and `net` (required);
   - `total_deductions`, `tax` and `pf_employee` where the old system has them.
3. **HR uploads it:** `POST /payroll-runs/:runId/parallel-comparisons` (file + tolerance).
4. **For every employee who is not a match, HR finds the cause and writes it down:**
   `POST /parallel-comparisons/:id/lines/:employeeCode/explain`. Typical causes:
   - **The ERP is right:** the old system missed something, such as an unpaid day, tax, or a
     leaver. Record it and tell the pilot.
   - **The old system is right:** an ERP setup or input error. **Fix it and recalculate.** The
     comparison becomes "outdated", so upload the register again.
   - **A known difference:** for example, rounding beyond the tolerance. Record it.
   - **Missing on one side:** for example, a joiner or a leaver. Check the employee's dates.
5. **Accounts reviews and accepts** with `POST /parallel-comparisons/:id/accept`. It must be a
   different person from the uploader, and every difference must be explained.
6. **Check the status:** `GET /companies/:id/gate-1`.

**Gate 1 is passed** when two different months are accepted and still up to date
(`gate1Passed: true`). Then the pilot's Admin and our founder agree, in writing, the first
month the ERP pays (WP7 disbursement). Keep the two comparisons: they are the evidence.

## If a month cannot be matched

Do not accept a month with an explanation you do not believe. Fix the cause and run the month
again. Escalate a difference in the payroll engine itself as a defect: it needs a new payroll
acceptance case (`backend/test/payroll-cases`, signed by the pilot's accountant) before the
fix. Gate 1 may need a third month. That is the point of the gate.
