-- =============================================================================
-- 0046  Commissions, the sales assistant and Gate 3 (Phase 3 WP31; spec §6.4
--       "Sales targets per user and department feed commission into payroll", §8 feature 3
--       (sales assistant), §12 Gate 3)
--
--   commission_rules     how commission is earned: on what (invoiced or collected sales),
--                        at what rate, and whether the rate changes with target attainment
--   commission_runs      one run per company x month: what it computed and whether it was
--                        posted to payroll (as payroll variables on the COMMISSION head)
--   commission_lines     one line per salesperson per run, with the figures it came from, so
--                        a disagreement can be settled from the source documents
--
-- Guarantees the database keeps:
--   - one run per company per month (a cancelled run may be followed by another);
--   - one line per salesperson per run;
--   - a posted run always says when it was posted, and its lines carry the payroll variable
--     they became, so commission can never be posted to payroll twice;
--   - a rule's rate and target bands are checked (0-100%, bands in order).
-- =============================================================================

CREATE TABLE commission_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name              text NOT NULL,
  -- invoiced: the salesperson's invoices of the month (spec §6.8 step 5)
  -- collected: the money actually received against their invoices (step 6)
  basis             text NOT NULL DEFAULT 'collected' CHECK (basis IN ('invoiced', 'collected')),
  -- the base rate, in percent of the basis amount
  rate_percent      numeric(6,3) NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  -- optional: no commission until this much of the month's target is reached
  min_attainment    numeric(6,2) NOT NULL DEFAULT 0 CHECK (min_attainment >= 0 AND min_attainment <= 500),
  -- optional: a higher rate once the target is beaten
  bonus_attainment  numeric(6,2) CHECK (bonus_attainment > 0 AND bonus_attainment <= 500),
  bonus_rate_percent numeric(6,3) CHECK (bonus_rate_percent >= 0 AND bonus_rate_percent <= 100),
  -- a credit note or a reversed receipt lowers the basis of the month it falls in
  clawback          boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  note              text,
  created_by        uuid DEFAULT app_current_user_id(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code),
  CONSTRAINT bonus_pair CHECK (
    (bonus_attainment IS NULL) = (bonus_rate_percent IS NULL)
  ),
  CONSTRAINT bonus_above_minimum CHECK (
    bonus_attainment IS NULL OR bonus_attainment >= min_attainment
  )
);
CREATE TRIGGER touch BEFORE UPDATE ON commission_rules FOR EACH ROW EXECUTE FUNCTION app_touch_row();
-- one active rule per company: commission is one scheme, not a pile of overlapping ones
CREATE UNIQUE INDEX commission_rules_active ON commission_rules (tenant_id, company_id) WHERE is_active;
SELECT app_secure_tenant_table('commission_rules', 'SELECT, INSERT, UPDATE');

CREATE TABLE commission_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  period          text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  rule_id         uuid NOT NULL REFERENCES commission_rules (id),
  state           text NOT NULL DEFAULT 'calculated' CHECK (state IN ('calculated', 'posted', 'cancelled')),
  total           numeric(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  -- a snapshot of the rule as it was when the run was calculated
  rule_snapshot   jsonb NOT NULL DEFAULT '{}',
  posted_at       timestamptz,
  posted_by       uuid REFERENCES users (id),
  cancel_reason   text,
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT posted_recorded CHECK ((state = 'posted') = (posted_at IS NOT NULL)),
  CONSTRAINT cancel_recorded CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON commission_runs FOR EACH ROW EXECUTE FUNCTION app_touch_row();
-- one live run per company per month
CREATE UNIQUE INDEX commission_runs_live ON commission_runs (tenant_id, company_id, period)
  WHERE state IN ('calculated', 'posted');
SELECT app_secure_tenant_table('commission_runs', 'SELECT, INSERT, UPDATE');

CREATE TABLE commission_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  run_id          uuid NOT NULL REFERENCES commission_runs (id),
  user_id         uuid NOT NULL REFERENCES users (id),
  employee_id     uuid REFERENCES employees (id),
  -- what it was computed from
  basis_amount    numeric(16,2) NOT NULL CHECK (basis_amount >= 0),
  target_amount   numeric(16,2),
  attainment      numeric(8,2),
  rate_percent    numeric(6,3) NOT NULL,
  amount          numeric(16,2) NOT NULL CHECK (amount >= 0),
  -- the documents behind basis_amount, so the figure can be argued with
  detail          jsonb NOT NULL DEFAULT '{}',
  -- the payroll variable this line became when the run was posted
  payroll_variable_id uuid REFERENCES payroll_variables (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, user_id)
);
CREATE INDEX commission_lines_run ON commission_lines (tenant_id, run_id);
-- one payroll variable per line: commission cannot reach payroll twice
CREATE UNIQUE INDEX commission_lines_variable ON commission_lines (tenant_id, payroll_variable_id)
  WHERE payroll_variable_id IS NOT NULL;
SELECT app_secure_tenant_table('commission_lines', 'SELECT, INSERT, UPDATE');

-- --------------------------------------------------------- the sales assistant

-- AI feature switch for the tenant (WP11 pattern)
ALTER TABLE ai_settings ADD COLUMN sales_assist_enabled boolean NOT NULL DEFAULT true;
GRANT INSERT (sales_assist_enabled) ON ai_settings TO erp_app;
GRANT UPDATE (sales_assist_enabled) ON ai_settings TO erp_app;

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening', 'review_draft', 'sales_assist'));
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_feature_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening', 'review_draft', 'sales_assist'));
