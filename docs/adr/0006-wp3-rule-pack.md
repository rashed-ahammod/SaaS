# ADR 0006 — WP3: the compliance rule pack

- **Status:** accepted · 2026-10-14

## Context

Guide §5 rule 12: statutory values are never hardcoded. Spec §7: Bangladeshi labour law was
amended in 2025–2026, many values are still "Verify", and a value marked "Verify" must not be
used for a live customer.

## Decision

1. **Central, versioned packs.** A pack (e.g. `BD-LABOUR 2026.1`) is published once for all
   customers:
   - `rule_packs`: the pack versions;
   - `rule_values`: one row per value, with `effective_from`/`effective_to`, type, unit, Bangla
     and English descriptions, source, and status;
   - `rule_value_history`: who published, verified or unverified each value.

   These three tables have **no `tenant_id`**, a documented exception to guide §5 rule 2. They
   hold platform reference data that no tenant owns. The API role (`erp_app`) has `SELECT` only.
2. **Tenants accept a version from a date.** `tenant_rule_packs` (with RLS) records it. For any
   date, the latest acceptance on or before that date decides which pack answers. A company can
   therefore move to `2027.1` from 1 July without changing how past months are calculated.
3. **Values are effective-dated inside a pack.** The 2025 amendment is represented as two
   periods. For example, maternity leave is 112 days until 10 Apr 2026 and 120 days from then.
   Back-dated payroll and leave calculations therefore use the law that applied at the time.
4. **Published means permanent.** A trigger blocks changing or deleting a value, even by the
   table owner. Only the verification status can change. A correction is a new pack version.
5. **Verification is a named act, not data.** A pack file can never mark values verified.
   The compliance owner runs `npm run rules -- verify ... --by "<name>" --source <official URL>`,
   and a URL to the official source is required. `unverify` takes a value back with a reason.
   Everything is kept in the history.
6. **The production rule.** `RulesService.get()` refuses a `verify` value when
   `NODE_ENV=production`, returning 422 `RULE_NOT_VERIFIED` and naming the rule.
   Development and tests may use it, so building payroll and leave does not wait for legal
   sign-off.
7. **Operator tooling, not an API.** There is no platform-operator login yet. Publishing and
   verification are done with `scripts/rules.ts` as `erp_owner`, from reviewed files in
   `rule-packs/`. A platform-admin UI can call the same functions in `rule-pack-admin.ts` later.

## Seeded content

`rule-packs/bd-labour-2026.1.json` contains 24 values from spec §7, **all `verify`**:
- leave: casual, sick, earned, maternity;
- festival holidays;
- working hours and the overtime rate;
- festival bonus;
- resignation benefit;
- PF threshold;
- lay-off eligibility;
- gratuity;
- WPPF;
- FY 2026-27 salary tax slabs.

The 2025-amendment values take **10 April 2026** as their effective date (the reported date of
the Act). This must be confirmed: the Ordinance may have applied earlier. The tax slabs are
**development placeholders** taken from budget summaries. The compliance owner must replace
them with the Finance Act and NBR figures, including the thresholds for women, senior and
disabled taxpayers, exemptions and rebates, in a new pack version before verifying.

## Consequences

- WP5 (leave) and WP6 (payroll) read every statutory number through `RulesService`.
- Going live needs a verified pack. `GET /rules?date=` shows `usableInProduction` for a quick check.
