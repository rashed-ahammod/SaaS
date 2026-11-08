-- =============================================================================
-- 0026  Employee lifecycle (employee audit, 2026-10-21; spec §3, §6.1)
--
--   companies            + notice periods (resignation / termination) and retirement age:
--                          company settings. Defaults are placeholders from the
--                          Bangladesh Labour Act (verify): 60 / 120 days, retire at 60.
--   employees            + confirmed_at (probation confirmed by HR)
--   probation_reviews    one per employee and probation end date: the reminder sent to
--                          the Dept Head, their recommendation, HR's decision
--   separations          resignation, termination, retirement, contract end or end of
--                          probation: notice given vs required, the shortfall, state
--   separation_clearances  IT, Admin (assets), Accounts (advances) and Dept Head
--                          (handover) clear the leaver before the final settlement
-- =============================================================================

ALTER TABLE companies
  ADD COLUMN notice_days_resignation integer NOT NULL DEFAULT 60 CHECK (notice_days_resignation BETWEEN 0 AND 365),
  ADD COLUMN notice_days_termination integer NOT NULL DEFAULT 120 CHECK (notice_days_termination BETWEEN 0 AND 365),
  ADD COLUMN retirement_age integer NOT NULL DEFAULT 60 CHECK (retirement_age BETWEEN 40 AND 80);

ALTER TABLE employees ADD COLUMN confirmed_at timestamptz;

CREATE TABLE probation_reviews (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  probation_end_date  date NOT NULL,
  reminded_at         timestamptz,
  recommendation      text CHECK (recommendation IN ('confirm', 'extend', 'end')),
  recommend_months    integer CHECK (recommend_months BETWEEN 1 AND 12),
  recommend_note      text,
  recommended_by      uuid,
  recommended_at      timestamptz,
  decision            text CHECK (decision IN ('confirm', 'extend', 'end')),
  decision_months     integer CHECK (decision_months BETWEEN 1 AND 12),
  decision_note       text,
  decided_by          uuid,
  decided_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, probation_end_date),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('probation_reviews', 'SELECT, INSERT, UPDATE');

CREATE TABLE separations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id           uuid NOT NULL,
  company_id            uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('resignation', 'termination', 'retirement', 'contract_end', 'probation_end')),
  notice_date           date NOT NULL,
  last_working_day      date NOT NULL CHECK (last_working_day >= notice_date),
  required_notice_days  integer NOT NULL CHECK (required_notice_days >= 0),
  shortfall_days        integer NOT NULL CHECK (shortfall_days >= 0),
  reason                text NOT NULL,
  previous_status       text NOT NULL CHECK (previous_status IN ('probation', 'active')),
  state                 text NOT NULL DEFAULT 'in_notice' CHECK (state IN ('in_notice', 'separated', 'withdrawn')),
  withdrawn_reason      text,
  separated_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid DEFAULT app_current_user_id(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
-- one live separation per employee
CREATE UNIQUE INDEX separations_live ON separations (tenant_id, employee_id) WHERE state = 'in_notice';
SELECT app_secure_tenant_table('separations', 'SELECT, INSERT, UPDATE');

CREATE TABLE separation_clearances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  separation_id  uuid NOT NULL REFERENCES separations (id),
  item           text NOT NULL CHECK (item IN ('it', 'admin_assets', 'accounts_advances', 'dept_handover')),
  cleared_by     uuid,
  cleared_at     timestamptz,
  note           text,
  UNIQUE (separation_id, item)
);
SELECT app_secure_tenant_table('separation_clearances', 'SELECT, INSERT, UPDATE');
