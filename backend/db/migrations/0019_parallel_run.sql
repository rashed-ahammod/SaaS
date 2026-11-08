-- =============================================================================
-- 0019  Parallel payroll comparison (spec §12 Gate 1; WP12)
--
-- Gate 1: each pilot runs two parallel payrolls that match its current payroll.
-- HR uploads the old system's payroll register for a period; the ERP compares it
-- with its own run, employee by employee. Every difference must be explained;
-- Accounts accepts the comparison (maker-checker). Two accepted months = Gate 1.
--
--   parallel_run_comparisons   one upload compared with one ERP run
--   parallel_run_lines         one employee: legacy figures, ERP figures, differences
-- =============================================================================

CREATE TABLE parallel_run_comparisons (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  run_id              uuid NOT NULL,
  period              text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- the run as it was compared: a recalculation afterwards makes this comparison outdated
  run_calculated_at   timestamptz NOT NULL,
  file_name           text NOT NULL,
  file_sha256         text NOT NULL,
  tolerance           numeric(10,2) NOT NULL DEFAULT 0,   -- Tk per figure (e.g. 1.00 for whole-taka rounding)
  employees           integer NOT NULL,
  matched             integer NOT NULL,
  different           integer NOT NULL,
  missing_in_erp      integer NOT NULL,
  missing_in_legacy   integer NOT NULL,
  totals              jsonb NOT NULL,                     -- {"legacy": {...}, "erp": {...}} per figure
  --   open      differences not all explained, or not accepted yet
  --   accepted  every difference explained, accepted by Accounts (a second person)
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted')),
  accepted_by         uuid,
  accepted_at         timestamptz,
  acceptance_note     text,
  created_by          uuid DEFAULT app_current_user_id(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'open' OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK (accepted_by IS NULL OR accepted_by IS DISTINCT FROM created_by),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id)
);
CREATE INDEX parallel_run_comparisons_company ON parallel_run_comparisons (tenant_id, company_id, period);
SELECT app_secure_tenant_table('parallel_run_comparisons', 'SELECT, INSERT, UPDATE');


CREATE TABLE parallel_run_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  comparison_id   uuid NOT NULL REFERENCES parallel_run_comparisons (id),
  employee_code   text NOT NULL,
  employee_id     uuid,
  outcome         text NOT NULL CHECK (outcome IN ('match', 'different', 'missing_in_erp', 'missing_in_legacy')),
  legacy          jsonb,                 -- figures from the old register
  erp             jsonb,                 -- figures from the ERP run
  differences     jsonb NOT NULL DEFAULT '{}',   -- figure -> ERP minus legacy
  explanation     text,                  -- why it differs (required before acceptance)
  explained_by    uuid,
  explained_at    timestamptz,
  UNIQUE (comparison_id, employee_code)
);
SELECT app_secure_tenant_table('parallel_run_lines', 'SELECT, INSERT, UPDATE');
