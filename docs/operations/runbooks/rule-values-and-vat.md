# Replacing the placeholder rule values, VAT rates and calendar

Every labour and tax value in this system was entered from law-firm summaries, not from the
authority, and every one of them is marked **"verify"**. This runbook turns them into values a
pilot can be paid from: who confirms what, how it is recorded, and how it is proved.

**Who does what**

| Person | Work |
| --- | --- |
| Compliance owner (founder) | Owns the list below; gets each value confirmed; keeps the evidence |
| Labour counsel | The Labour Act and Rules values: leave, hours, overtime, bonus, gratuity, benefits |
| Payroll accountant (the pilot's, or a chartered accountant) | The tax values, and the **signed acceptance cases** |
| VAT practitioner (Mushak) | VAT rates, the form's note numbers, the deposit and return dates |
| Operator (platform team) | Runs the `rules` commands; makes the code changes in Part B and C |

---

## 0. What the system does with an unverified value

In production, a value that is not verified is **refused**: the calculation stops with
`RULE_NOT_VERIFIED` (HTTP 422) and the API logs `Refused unverified rule <key> ...`
(`backend/src/modules/rules/rules.service.ts`). Nobody is paid from a placeholder.

Two consequences:

- **Expect payroll to refuse to run on a fresh production tenant.** That is the guard working, not
  a fault. The fix is Part A, not a code change.
- **The guard covers rule-pack values only.** VAT rates, the Mushak note numbers and the
  compliance calendar's due dates are company data and code, with no such protection - a wrong
  value there is used silently. That makes **Part B the sharper risk**, even though Part A is the
  longer job.

Outside production (your machine, a demo) unverified values are allowed, so the demo works.

---

## Part A - the 25 rule-pack values

### A1. Print the worksheet

```bash
cd backend
npm run rules -- list BD-LABOUR@2026.1
npm run rules -- list BD-LABOUR@2026.2
npm run rules -- list BD-LABOUR@2026.3
```

Each row shows the key, the value, the dates it applies between, and its status. Values carry
their own history: the same key appears in several versions with different effective dates (the
2025 labour amendments are dated **10 April 2026** in the packs, and that date is itself a
placeholder - see `notes` in `rule-packs/bd-labour-2026.2.json`).

### A2. The values, and what to confirm

**Salary tax** - Finance Act and NBR orders for the income year

| Key | In the system now | Confirm |
| --- | --- | --- |
| `tax.salary.slabs` | 0% to 375,000 / 10% to 675,000 / 15% to 1,075,000 / 20% to 1,575,000 / 25% to 3,575,000 / 30% above | The boundaries and rates for the income year, **and** the separate thresholds for women, senior citizens, disabled taxpayers and gazetted freedom fighters (not modelled yet - see C2) |
| `tax.salary.exemption_divisor` | 3 (one third of salary income) | The fraction, and what it applies to |
| `tax.salary.exemption_cap` | 450,000 BDT per year | |
| `tax.salary.minimum_tax` | 5,000 BDT | The amount, and which area or taxpayer it applies to |

**Tax deducted at source from vendors** - Income Tax Act 2023

| Key | In the system now | Confirm |
| --- | --- | --- |
| `tax.tds.vendor_categories` | SUPPLY 1-5% by amount, PROFESSIONAL 10%, RENT 5%, and the rest - each carrying `"PLACEHOLDER, verify"` in its own `section` field | Every category: the section, the rate or slab, and the VDS share of VAT |
| `tax.tds.no_tin_surcharge_percent` | 50% added to the rate | |

**Leave** - Labour Act and Rules

| Key | Now | Key | Now |
| --- | --- | --- | --- |
| `leave.casual.days_per_year` | 10 | `leave.maternity.days` | 120 (from 10 Apr 2026; 112 before) |
| `leave.casual.carry_forward` | false | `leave.maternity.min_service_months` | 6 |
| `leave.sick.days_per_year` | 14 | `leave.maternity.daily_pay_divisor` | 26 |
| `leave.earned.worked_days_per_leave_day` | 18 | | |

**Hours and overtime**: `work.hours.daily_max` 8, `work.hours.weekly_max` 48,
`overtime.rate_multiplier` 2.

**Bonus, gratuity and benefits**: `bonus.festival.per_year` 2,
`bonus.festival.cap_months_of_basic` 1, `bonus.festival.min_service_months` 12,
`gratuity.wage_days_per_completed_year` 30,
`benefit.resignation.wage_days_per_year` 7 days (1-3 years) / 15 (3-10) / 30 (10+),
`layoff.compensation.min_service_months` 3, `holidays.festival.days_per_year` 13.

**Funds**: `pf.mandatory_min_permanent_employees` 100, `wppf.percent_of_net_profit` 5.

For each one the confirmer answers three things: **the number**, **the date it applies from**, and
**the source** (gazette, SRO, Act section). The third is what gets recorded.

### A3. Correct a value

A published pack version is immutable: publishing it again does nothing. Corrections go in a **new
version**. Copy the newest file, raise the version, change only what the confirmer corrected, and
publish:

```bash
cp rule-packs/bd-labour-2026.3.json rule-packs/bd-labour-2026.4.json
# edit: "version": "2026.4", the corrected values, and the notes
npm run rules -- publish rule-packs/bd-labour-2026.4.json --by "Platform team"
```

### A4. Record the confirmation

One command per value, naming the person and the source. This is the audit trail a regulator or an
auditor will ask for, so write the real name and a durable link:

```bash
npm run rules -- verify BD-LABOUR@2026.4 tax.salary.slabs \
  --from 2026-07-01 \
  --by "Md. Rafiqul Islam FCA, <firm>" \
  --source "https://nbr.gov.bd/<circular>" \
  --note "Sixth Schedule, Finance Act 2026"
```

If something later turns out to be wrong, or is stayed by a court:

```bash
npm run rules -- unverify BD-LABOUR@2026.4 leave.maternity.days \
  --from 2026-04-10 --by "<name>" --reason "Section stayed by the High Court"
```

The value stops being usable in production again at once.

### A5. Let the tenant use the pack

Each workspace accepts a pack version from a date (the demo does this with 2026.1, 2026.2 and
2026.3). Until a tenant accepts it nothing changes for them, so a correction can be rolled out one
pilot at a time.

---

## Part B - VAT, the form and the calendar (no guard: do these first)

1. **Item rates.** `backend/src/modules/vat/mushak.ts` -> `DEFAULT_ITEMS` is the starting set
   (standard 15%, trading stage 5%, office rent 15%, consultancy, and so on). It is a **starting
   point per company**: the real rates are entered per VAT item per fiscal year, in the portal
   under **Finance -> VAT**, or `POST /companies/:id/vat-items/defaults` and then edited. Rates are
   held per **national fiscal year (July-June)**, so a Budget change is next year's rate, never an
   edit of the year that has been filed.
2. **Mushak 9.1 note numbers** - the field numbers printed on the return preview, in `mushak.ts`.
   A code change.
3. **VAT deducted at source in the net tax** - how VDS withheld by customers is set against the
   month's tax. Confirm the treatment with the practitioner; a code change in `mushak.ts`.
4. **Every due date** - `backend/src/modules/vat/compliance-rules.ts`:
   - VAT return and VDS deposit: the **15th** of the next month;
   - TDS and salary tax deposits: the **14th**;
   - the half-yearly withholding return, the company tax return (15 January of the second year),
     and the trade licence (30 September).

   All placeholders, all a code change. Get them confirmed together and change them once.

---

## Part C - proving the values, not just entering them

### C1. Signed acceptance cases

`backend/test/payroll-cases/*.yaml` are **illustrative**. Replace them with cases the accountant
has worked out and signed: a normal month, a joiner, a leaver with final settlement, a month with
overtime, a bonus month, a maternity month, an arrears month. They run in CI, so once they are in,
any change that would alter someone's pay fails the build.

### C2. Decisions still open (ADR 0009 section 7)

Three are **not value entry - they need development**:

- the **investment rebate** is not modelled;
- the **separate thresholds** for women, senior, disabled and freedom-fighter taxpayers are not
  modelled;
- the statutory **resignation and termination benefits** are not separate lines in the final
  settlement (gratuity is).

The rest are bases to confirm, each a setting or a rule value: maternity pay is gross / 26 per day
(gross or basic?), leave encashment gross / 30 (basis and divisor?), overtime basic / 208 x 2
(basis and hours?), notice not served gross / 30. Already decided, and worth re-confirming with the
accountant: arrears are taxed in the year they are paid, half days are not deducted, and future
bonuses are not projected in monthly tax.

### C3. Gate 1 - the proof

Values that pass review still have to match reality. Run
[Gate 1](gate-1-parallel-payroll.md): the pilot's old system keeps paying while the ERP calculates
the same months; every employee is compared, differences are explained, and a second person accepts
each month. **Three accepted months** is the bar for paying from the ERP.

---

## Order of work

1. **Part B first.** It is the shortest, and it is the one with no safety net.
2. Print the Part A worksheet and split it: counsel takes the labour values, the accountant the tax.
3. Publish `2026.4` with the corrections; `verify` each value with its source and signatory.
4. Have the tenant accept the new version.
5. Replace the acceptance cases with signed figures (C1); decide the open bases (C2).
6. Run Gate 1 for three months (C3).

## Done when

- [ ] `npm run rules -- list` shows **no** value still at `verify` for the keys the pilot uses
- [ ] Every verified value names a real person and a durable source
- [ ] The pilot's VAT items carry rates confirmed by its Mushak practitioner, for this fiscal year
- [ ] The calendar's due dates are confirmed, in code, with a test
- [ ] `test/payroll-cases/*.yaml` hold the accountant's signed figures, and CI is green
- [ ] Three parallel months accepted (Gate 1)

## If payroll refuses in production

The log says `Refused unverified rule <key> (<pack>) for <date>` and the API answers 422
`RULE_NOT_VERIFIED` with the key and the date in `details`. That value has not been confirmed for
that date: it is Part A, not an incident. Do **not** work around it by switching the guard off, or
by marking values verified without a source. That guard is the one control standing between a
placeholder and somebody's salary.
