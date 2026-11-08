-- =============================================================================
-- 0010  Leave (spec §6.3, guide §7.6, §11)
--
-- Balances are never stored: a balance is the SUM of the ledger up to a date.
-- An approved request writes "taken" (negative) entries; a cancellation writes
-- "reversal" (positive) entries. Nothing is edited.
-- =============================================================================

-- Company leave policy (settings, one row per company).
CREATE TABLE leave_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  -- leave year: calendar year by default (guide §1); "07-01" = July-June
  leave_year_start      text NOT NULL DEFAULT '01-01' CHECK (leave_year_start ~ '^(0[1-9]|1[0-2])-01$'),
  -- weekend/holiday between two leave days counts as leave (spec §6.3)
  sandwich_rule         boolean NOT NULL DEFAULT false,
  -- warn the approver when more than this share of a department is off on a day
  team_absence_warn_pct integer NOT NULL DEFAULT 30 CHECK (team_absence_warn_pct BETWEEN 1 AND 100),
  -- how far back an employee may apply (HR may go further)
  max_backdated_days    integer NOT NULL DEFAULT 7 CHECK (max_backdated_days BETWEEN 0 AND 90),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON leave_policies FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('leave_policies', 'SELECT, INSERT, UPDATE');


CREATE TABLE leave_types (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id               uuid NOT NULL,
  code                     text NOT NULL CHECK (code ~ '^[A-Z0-9]{1,10}$'),
  name_en                  text NOT NULL,
  name_bn                  text,
  paid                     boolean NOT NULL DEFAULT true,
  -- how the balance grows:
  --   annual_grant     full entitlement at the start of each leave year (prorated for joiners)
  --   monthly          entitlement / 12 after each completed month
  --   per_worked_days  1 day per N days worked (attendance), e.g. earned leave
  --   none             no balance (maternity: limit per request; leave without pay)
  accrual_method           text NOT NULL CHECK (accrual_method IN ('annual_grant', 'monthly', 'per_worked_days', 'none')),
  -- entitlement: a fixed number, or a rule pack key (statutory values are never hardcoded)
  entitlement_days         numeric(6,2) CHECK (entitlement_days >= 0),
  entitlement_rule_key     text,
  -- for accrual "none": most days per request (number or rule key, e.g. maternity 120)
  max_days_per_request     numeric(6,2),
  max_days_rule_key        text,
  -- weekends and holidays inside the range count (maternity: calendar days)
  counts_non_working_days  boolean NOT NULL DEFAULT false,
  allow_half_day           boolean NOT NULL DEFAULT false,
  -- a supporting document is needed when the request is longer than this (e.g. sick > 2 days)
  document_required_over_days numeric(6,2),
  -- year end: lapse, or carry up to the cap (the rest is encashed if encashable, else lapses)
  year_end_action          text NOT NULL DEFAULT 'lapse' CHECK (year_end_action IN ('lapse', 'carry')),
  carry_cap_days           numeric(6,2) CHECK (carry_cap_days >= 0),
  encashable               boolean NOT NULL DEFAULT false,
  -- {"gender": "female", "minServiceMonths": 6, "minServiceRuleKey": "...", "allowDuringProbation": false}
  eligibility              jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(eligibility) = 'object'),
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid DEFAULT app_current_user_id(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  CHECK (accrual_method = 'none' OR entitlement_days IS NOT NULL OR entitlement_rule_key IS NOT NULL),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON leave_types FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('leave_types', 'SELECT, INSERT, UPDATE');


CREATE TABLE leave_ledger (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id   uuid NOT NULL,
  leave_type_id uuid NOT NULL,
  entry_date    date NOT NULL,
  kind          text NOT NULL CHECK (kind IN ('opening', 'accrual', 'taken', 'reversal', 'lapse', 'carry_in', 'encash', 'adjustment')),
  days          numeric(6,2) NOT NULL CHECK (days <> 0),   -- signed: + adds to the balance, - uses it
  leave_year    text NOT NULL,                             -- e.g. "2026" or "2026-27"
  -- jobs use a period key so running them twice writes nothing new, e.g. "grant:2026", "month:2026-10", "year_end:2026"
  period_key    text,
  source_type   text,                                      -- e.g. leave_request
  source_id     uuid,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT app_current_user_id(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, leave_type_id) REFERENCES leave_types (tenant_id, id)
);
CREATE INDEX leave_ledger_balance ON leave_ledger (tenant_id, employee_id, leave_type_id, entry_date);
CREATE UNIQUE INDEX leave_ledger_job_once ON leave_ledger (tenant_id, employee_id, leave_type_id, kind, period_key) WHERE period_key IS NOT NULL;
SELECT app_secure_tenant_table('leave_ledger', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON leave_ledger FOR EACH ROW EXECUTE FUNCTION app_reject_change();


CREATE TABLE leave_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  company_id          uuid NOT NULL,
  leave_type_id       uuid NOT NULL,
  from_date           date NOT NULL,
  to_date             date NOT NULL,
  half_day            text CHECK (half_day IN ('first_half', 'second_half')),
  days_counted        numeric(6,2) NOT NULL CHECK (days_counted > 0),
  reason              text,
  document_id         uuid,                                -- supporting document (employee_documents)
  state               text NOT NULL DEFAULT 'pending'
                      CHECK (state IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
  approval_request_id uuid,
  decided_at          timestamptz,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CHECK (to_date >= from_date),
  CHECK (half_day IS NULL OR from_date = to_date),
  CHECK (state <> 'cancelled' OR cancel_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, leave_type_id) REFERENCES leave_types (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES employee_documents (tenant_id, id),
  -- no two open requests of one employee on the same day (spec §6.3 "overlap check")
  CONSTRAINT leave_requests_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, employee_id WITH =, daterange(from_date, to_date, '[]') WITH &&
  ) WHERE (state IN ('pending', 'approved'))
);
CREATE INDEX leave_requests_dates ON leave_requests (tenant_id, company_id, from_date, to_date) WHERE state IN ('pending', 'approved');
CREATE TRIGGER touch BEFORE UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('leave_requests', 'SELECT, INSERT, UPDATE');


-- Unused leave paid out at year end, waiting for payroll (WP6 creates the payroll variable).
CREATE TABLE leave_encashments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id    uuid NOT NULL,
  leave_type_id  uuid NOT NULL,
  leave_year     text NOT NULL,
  days           numeric(6,2) NOT NULL CHECK (days > 0),
  status         text NOT NULL DEFAULT 'pending_payroll' CHECK (status IN ('pending_payroll', 'in_payroll', 'paid')),
  payroll_period text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, leave_type_id, leave_year),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, leave_type_id) REFERENCES leave_types (tenant_id, id)
);
SELECT app_secure_tenant_table('leave_encashments', 'SELECT, INSERT, UPDATE');
