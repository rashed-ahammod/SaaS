-- =============================================================================
-- 0011  Payroll (spec §6.4, guide §7.7, §12)
--
-- Setup:      payroll_settings, salary_heads, salary_structures, employee_salaries,
--             payroll_ytd_openings, payroll_variables, loans, loan_recoveries
-- Runs:       payroll_runs -> payroll_run_employees (stored engine input + totals)
--                          -> payroll_lines (with explanation trace)
--                          -> payroll_flags (each cleared with a reason)
--
-- The engine (src/payroll-engine) is pure: everything it used is stored on
-- payroll_run_employees.input, so any past run can be re-calculated and compared.
-- Lines of a run can change only while the run is draft/calculated; after
-- submission they are frozen (trigger below). Corrections go to a later run.
-- =============================================================================

-- Last working day: set when an employee resigns / is separated (final settlement).
ALTER TABLE employees ADD COLUMN last_working_day date;
ALTER TABLE employees ADD CONSTRAINT employees_last_working_day CHECK (last_working_day IS NULL OR last_working_day >= join_date);


-- Company payroll settings (one row per company; defaults are common Bangladeshi practice).
CREATE TABLE payroll_settings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id               uuid NOT NULL,
  -- every line is rounded with this rule: to the paisa (0.01) or to the taka (1)
  rounding_increment       numeric(4,2) NOT NULL DEFAULT 0.01 CHECK (rounding_increment IN (0.01, 1)),
  rounding_mode            text NOT NULL DEFAULT 'HALF_UP' CHECK (rounding_mode IN ('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP')),
  -- per-day rate for unpaid days: gross / days in month, / 30, or / 26
  unpaid_day_basis         text NOT NULL DEFAULT 'calendar' CHECK (unpaid_day_basis IN ('calendar', 'fixed30', 'fixed26')),
  -- hourly OT rate = BASIC / this (208 = 26 days x 8 hours)
  ot_hours_basis           integer NOT NULL DEFAULT 208 CHECK (ot_hours_basis BETWEEN 100 AND 400),
  ot_monthly_limit_hours   integer NOT NULL DEFAULT 60 CHECK (ot_monthly_limit_hours BETWEEN 0 AND 300),
  pf_employee_percent      numeric(5,2) NOT NULL DEFAULT 0 CHECK (pf_employee_percent BETWEEN 0 AND 50),
  pf_employer_percent      numeric(5,2) NOT NULL DEFAULT 0 CHECK (pf_employer_percent BETWEEN 0 AND 50),
  gratuity_provision       boolean NOT NULL DEFAULT false,
  net_change_flag_percent  integer NOT NULL DEFAULT 20 CHECK (net_change_flag_percent BETWEEN 1 AND 100),
  -- leave encashment per day = gross / this
  encashment_divisor       integer NOT NULL DEFAULT 30 CHECK (encashment_divisor BETWEEN 20 AND 31),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON payroll_settings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('payroll_settings', 'SELECT, INSERT, UPDATE');


-- Salary heads of a company (BASIC, HOUSE_RENT ...). System heads produced by the
-- engine (TAX, OVERTIME, PF_EMPLOYEE ...) are built in and not stored here.
CREATE TABLE salary_heads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name_en     text NOT NULL,
  name_bn     text,
  kind        text NOT NULL CHECK (kind IN ('earning', 'deduction')),
  taxable     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 100,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT app_current_user_id(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CHECK (kind = 'earning' OR taxable = false),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON salary_heads FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('salary_heads', 'SELECT, INSERT, UPDATE');


-- How gross is split into heads, e.g. [{"head":"BASIC","of":"GROSS","percent":"60"}, ...].
-- A structure in use is never edited: create a new one (the old payslips stay explainable).
CREATE TABLE salary_structures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{1,30}$'),
  name        text NOT NULL,
  rules       jsonb NOT NULL CHECK (jsonb_typeof(rules) = 'array' AND jsonb_array_length(rules) > 0),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT app_current_user_id(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON salary_structures FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('salary_structures', 'SELECT, INSERT, UPDATE');


-- Salary history. A row applies from effective_from until the next active row.
-- Never edited: a mistake is cancelled with a reason and a new row is added.
-- A row dated before an already-paid month creates arrears in the next run.
CREATE TABLE employee_salaries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  employee_id    uuid NOT NULL,
  effective_from date NOT NULL,
  gross          numeric(14,2) NOT NULL CHECK (gross > 0),
  structure_id   uuid NOT NULL,
  reason         text NOT NULL,                     -- joining, increment, promotion, correction ...
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_reason text,
  cancelled_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT app_current_user_id(),
  CHECK (status = 'active' OR cancelled_reason IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, structure_id) REFERENCES salary_structures (tenant_id, company_id, id)
);
CREATE UNIQUE INDEX employee_salaries_one_per_date ON employee_salaries (tenant_id, employee_id, effective_from) WHERE status = 'active';
SELECT app_secure_tenant_table('employee_salaries', 'SELECT, INSERT, UPDATE');


-- Tax year-to-date figures not produced by this system's runs:
--   opening         the company's own payroll before go-live (data migration)
--   prior_employer  a joiner's income and tax at the previous employer this fiscal year
CREATE TABLE payroll_ytd_openings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id     uuid NOT NULL,
  fiscal_year     text NOT NULL CHECK (fiscal_year ~ '^[0-9]{4}-[0-9]{2}$'),   -- 2026-27
  kind            text NOT NULL CHECK (kind IN ('opening', 'prior_employer')),
  taxable_income  numeric(14,2) NOT NULL CHECK (taxable_income >= 0),
  tax_withheld    numeric(14,2) NOT NULL CHECK (tax_withheld >= 0),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT app_current_user_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_id, fiscal_year, kind),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON payroll_ytd_openings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('payroll_ytd_openings', 'SELECT, INSERT, UPDATE');


-- Manual items for one month: commission, other deduction, a one-off allowance ...
CREATE TABLE payroll_variables (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  employee_id  uuid NOT NULL,
  period       text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  head_code    text NOT NULL,
  amount       numeric(14,2) NOT NULL CHECK (amount > 0),
  note         text,
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  run_id       uuid,                                   -- the approved run that paid it
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app_current_user_id(),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, head_code) REFERENCES salary_heads (tenant_id, company_id, code)
);
CREATE INDEX payroll_variables_period ON payroll_variables (tenant_id, company_id, period) WHERE status = 'open';
SELECT app_secure_tenant_table('payroll_variables', 'SELECT, INSERT, UPDATE');


-- Salary advances / loans, recovered by monthly installments (approval type salary_advance).
CREATE TABLE loans (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  employee_id         uuid NOT NULL,
  principal           numeric(14,2) NOT NULL CHECK (principal > 0),
  installment         numeric(14,2) NOT NULL CHECK (installment > 0),
  first_period        text NOT NULL CHECK (first_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- first recovery month
  reason              text NOT NULL,
  state               text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'approved', 'rejected', 'cancelled', 'closed')),
  approval_request_id uuid,
  approved_at         timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CHECK (installment <= principal),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON loans FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('loans', 'SELECT, INSERT, UPDATE');


-- ---------------------------------------------------------------------------
-- Runs
-- ---------------------------------------------------------------------------
CREATE TABLE payroll_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  period              text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  run_type            text NOT NULL CHECK (run_type IN ('regular', 'bonus', 'final_settlement')),
  -- draft -> calculated -> in_approval -> verified (Accounts) -> approved (Admin); cancelled any time before approval
  state               text NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft', 'calculated', 'in_approval', 'verified', 'approved', 'cancelled')),
  -- bonus runs
  bonus_name          text,                          -- e.g. "Eid-ul-Adha 2026"
  bonus_date          date,
  -- final settlement runs: the one employee and the facts HR entered
  employee_id         uuid,
  settlement          jsonb,                         -- {"noticeShortfallDays": 30, "encashmentDays": "10"}
  engine_version      text,
  input_hash          text,                          -- hash of all employees' inputs
  headcount           integer NOT NULL DEFAULT 0,
  total_gross         numeric(16,2) NOT NULL DEFAULT 0,
  total_deductions    numeric(16,2) NOT NULL DEFAULT 0,
  total_net           numeric(16,2) NOT NULL DEFAULT 0,
  total_employer_cost numeric(16,2) NOT NULL DEFAULT 0,
  total_tax           numeric(16,2) NOT NULL DEFAULT 0,
  approval_request_id uuid,
  calculated_at       timestamptz,
  calculated_by       uuid,
  approved_at         timestamptz,
  cancelled_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CHECK (state <> 'cancelled' OR cancelled_reason IS NOT NULL),
  CHECK (run_type <> 'bonus' OR (bonus_name IS NOT NULL AND bonus_date IS NOT NULL)),
  CHECK (run_type <> 'final_settlement' OR employee_id IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
-- one live regular run per company and month; one live bonus run per bonus; one final settlement per employee
CREATE UNIQUE INDEX payroll_runs_one_regular ON payroll_runs (tenant_id, company_id, period) WHERE run_type = 'regular' AND state <> 'cancelled';
CREATE UNIQUE INDEX payroll_runs_one_bonus ON payroll_runs (tenant_id, company_id, bonus_name) WHERE run_type = 'bonus' AND state <> 'cancelled';
CREATE UNIQUE INDEX payroll_runs_one_settlement ON payroll_runs (tenant_id, employee_id) WHERE run_type = 'final_settlement' AND state <> 'cancelled';
CREATE TRIGGER touch BEFORE UPDATE ON payroll_runs FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('payroll_runs', 'SELECT, INSERT, UPDATE');


-- One employee in a run: the exact engine input and the totals it produced.
CREATE TABLE payroll_run_employees (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  run_id          uuid NOT NULL,
  employee_id     uuid NOT NULL,
  input           jsonb NOT NULL,
  input_hash      text NOT NULL,
  engine_version  text NOT NULL,
  gross           numeric(14,2) NOT NULL,
  deductions      numeric(14,2) NOT NULL,
  net             numeric(14,2) NOT NULL,
  employer_cost   numeric(14,2) NOT NULL,
  taxable_income  numeric(14,2) NOT NULL,
  tax             numeric(14,2) NOT NULL,
  projection      jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, run_id, employee_id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('payroll_run_employees', 'SELECT, INSERT, DELETE');


CREATE TABLE payroll_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  run_id       uuid NOT NULL,
  employee_id  uuid NOT NULL,
  line_no      integer NOT NULL,
  head_code    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('earning', 'deduction', 'employer_cost')),
  amount       numeric(14,2) NOT NULL,
  taxable      boolean NOT NULL,
  for_period   text,                                -- arrears: the month they belong to
  explanation  jsonb NOT NULL,
  UNIQUE (tenant_id, run_id, employee_id, line_no),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX payroll_lines_employee ON payroll_lines (tenant_id, employee_id, run_id);
SELECT app_secure_tenant_table('payroll_lines', 'SELECT, INSERT, DELETE');


CREATE TABLE payroll_flags (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  run_id        uuid NOT NULL,
  employee_id   uuid NOT NULL,
  code          text NOT NULL,
  message       text NOT NULL,
  cleared_at    timestamptz,
  cleared_by    uuid,
  clear_reason  text,
  CHECK (cleared_at IS NULL OR (cleared_by IS NOT NULL AND clear_reason IS NOT NULL)),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX payroll_flags_run ON payroll_flags (tenant_id, run_id);
SELECT app_secure_tenant_table('payroll_flags', 'SELECT, INSERT, UPDATE, DELETE');


-- Installments recovered by approved runs (append-only). Outstanding = principal - SUM(amount).
CREATE TABLE loan_recoveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  loan_id    uuid NOT NULL,
  run_id     uuid NOT NULL,
  period     text NOT NULL,
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, loan_id, run_id),
  FOREIGN KEY (tenant_id, loan_id) REFERENCES loans (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id)
);
SELECT app_secure_tenant_table('loan_recoveries', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON loan_recoveries FOR EACH ROW EXECUTE FUNCTION app_reject_change();


-- ---------------------------------------------------------------------------
-- Results are frozen once a run leaves draft/calculated (guide §12.4: "After
-- approved the run is locked; corrections go into a later run").
-- ---------------------------------------------------------------------------
CREATE FUNCTION payroll_reject_frozen_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  run_state text;
BEGIN
  SELECT state INTO run_state FROM payroll_runs WHERE id = COALESCE(OLD.run_id, NEW.run_id);
  IF run_state NOT IN ('draft', 'calculated') THEN
    RAISE EXCEPTION 'payroll run is % and can no longer change', run_state USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER frozen BEFORE INSERT OR DELETE ON payroll_run_employees FOR EACH ROW EXECUTE FUNCTION payroll_reject_frozen_change();
CREATE TRIGGER frozen BEFORE INSERT OR DELETE ON payroll_lines FOR EACH ROW EXECUTE FUNCTION payroll_reject_frozen_change();
CREATE TRIGGER frozen BEFORE INSERT OR DELETE ON payroll_flags FOR EACH ROW EXECUTE FUNCTION payroll_reject_frozen_change();
