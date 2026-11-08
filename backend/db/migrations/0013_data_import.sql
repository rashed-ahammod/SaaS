-- =============================================================================
-- 0013  Data migration (spec §10, guide §17)
--
--   import_batches     one uploaded file (Excel / CSV) for one entity
--   import_rows        its rows in staging, with row-level errors; after commit,
--                      the record each row created (for rollback)
--   migration_signoffs the customer's signed reconciliation report (go-live)
--
-- Flow: upload -> validated (errors per row; fix the file or skip rows)
--       -> dry run -> committed (one transaction) -> rolled back | signed off.
-- Opening values become normal records (leave ledger "opening", YTD openings,
-- salaries, loans, approved bank accounts), so later logic treats them the same.
-- =============================================================================

CREATE TABLE import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id       uuid NOT NULL,
  entity           text NOT NULL CHECK (entity IN ('employees', 'salaries', 'leave_balances', 'ytd_openings', 'loans', 'bank_accounts')),
  file_name        text NOT NULL,
  file_sha256      text NOT NULL,
  -- go-live date: balances are "as at the day before"; cut-over is a month start (spec §10)
  cut_over_date    date NOT NULL CHECK (extract(day FROM cut_over_date) = 1),
  state            text NOT NULL DEFAULT 'validated'
                   CHECK (state IN ('validated', 'committed', 'rolled_back', 'signed_off', 'discarded')),
  total_rows       integer NOT NULL DEFAULT 0,
  valid_rows       integer NOT NULL DEFAULT 0,
  error_rows       integer NOT NULL DEFAULT 0,
  skipped_rows     integer NOT NULL DEFAULT 0,
  committed_at     timestamptz,
  committed_by     uuid,
  rolled_back_at   timestamptz,
  rolled_back_by   uuid,
  rollback_reason  text,
  signoff_id       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (state <> 'rolled_back' OR rollback_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE INDEX import_batches_company ON import_batches (tenant_id, company_id, created_at DESC);
CREATE TRIGGER touch BEFORE UPDATE ON import_batches FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('import_batches', 'SELECT, INSERT, UPDATE');


CREATE TABLE import_rows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  batch_id        uuid NOT NULL,
  row_no          integer NOT NULL,                  -- spreadsheet row number (header = 1)
  data            jsonb NOT NULL,                    -- cells as text, by column name
  status          text NOT NULL CHECK (status IN ('valid', 'error', 'skipped', 'committed', 'rolled_back')),
  errors          jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ "column": "nid", "message": "..." }]
  skip_reason     text,
  created_record  jsonb,                             -- { "table": "employees", "id": "..." }
  UNIQUE (tenant_id, batch_id, row_no),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batches (tenant_id, id)
);
SELECT app_secure_tenant_table('import_rows', 'SELECT, INSERT, UPDATE');


CREATE TABLE migration_signoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id    uuid NOT NULL,
  cut_over_date date NOT NULL,
  report        jsonb NOT NULL,                      -- the reconciliation report exactly as signed
  report_sha256 text NOT NULL,
  note          text NOT NULL,                       -- e.g. "Checked against the September register"
  signed_by     uuid NOT NULL DEFAULT app_current_user_id(),
  signed_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
SELECT app_secure_tenant_table('migration_signoffs', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON migration_signoffs FOR EACH ROW EXECUTE FUNCTION app_reject_change();


-- Provident fund year to date (reconciliation: "YTD tax and PF totals")
ALTER TABLE payroll_ytd_openings ADD COLUMN pf_employee numeric(14,2) NOT NULL DEFAULT 0 CHECK (pf_employee >= 0);
ALTER TABLE payroll_ytd_openings ADD COLUMN pf_employer numeric(14,2) NOT NULL DEFAULT 0 CHECK (pf_employer >= 0);


-- ---------------------------------------------------------------------------
-- Rollback of a committed, not yet signed-off batch.
--
-- The app role cannot delete these records (history is never deleted). This
-- owner function removes ONE record, and only one that a committed import row
-- created, and only while nothing else uses it. Anything else raises an error,
-- so a rollback is all-or-nothing.
-- ---------------------------------------------------------------------------

-- the leave ledger is append-only, except for this rollback (owner + flag set below)
CREATE FUNCTION leave_ledger_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_user = 'erp_owner' AND current_setting('app.import_rollback', true) = 'on' AND OLD.kind = 'opening' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER append_only ON leave_ledger;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON leave_ledger FOR EACH ROW EXECUTE FUNCTION leave_ledger_guard();

CREATE FUNCTION import_remove_record(p_table text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  in_use text;
BEGIN
  -- only a record created by a committed import row of this tenant (RLS applies here too)
  IF NOT EXISTS (
    SELECT 1 FROM import_rows r JOIN import_batches b ON b.id = r.batch_id
     WHERE r.status = 'committed' AND b.state = 'committed'
       AND r.created_record ->> 'table' = p_table AND r.created_record ->> 'id' = p_id::text
  ) THEN
    RAISE EXCEPTION 'record %/% was not created by a committed import', p_table, p_id USING ERRCODE = 'check_violation';
  END IF;

  IF p_table = 'employees' THEN
    SELECT label INTO in_use FROM (
      SELECT 'salaries' AS label WHERE EXISTS (SELECT 1 FROM employee_salaries WHERE employee_id = p_id)
      UNION ALL SELECT 'leave ledger' WHERE EXISTS (SELECT 1 FROM leave_ledger WHERE employee_id = p_id)
      UNION ALL SELECT 'leave requests' WHERE EXISTS (SELECT 1 FROM leave_requests WHERE employee_id = p_id)
      UNION ALL SELECT 'attendance' WHERE EXISTS (SELECT 1 FROM attendance_days WHERE employee_id = p_id)
      UNION ALL SELECT 'payroll' WHERE EXISTS (SELECT 1 FROM payroll_run_employees WHERE employee_id = p_id)
      UNION ALL SELECT 'YTD openings' WHERE EXISTS (SELECT 1 FROM payroll_ytd_openings WHERE employee_id = p_id)
      UNION ALL SELECT 'loans' WHERE EXISTS (SELECT 1 FROM loans WHERE employee_id = p_id)
      UNION ALL SELECT 'bank accounts' WHERE EXISTS (SELECT 1 FROM employee_bank_accounts WHERE employee_id = p_id)
      UNION ALL SELECT 'documents' WHERE EXISTS (SELECT 1 FROM employee_documents WHERE employee_id = p_id)
      UNION ALL SELECT 'login' WHERE EXISTS (SELECT 1 FROM users WHERE employee_id = p_id)
      UNION ALL SELECT 'reports to them' WHERE EXISTS (SELECT 1 FROM employee_assignments WHERE line_manager_id = p_id OR functional_manager_id = p_id)
      UNION ALL SELECT 'department head' WHERE EXISTS (SELECT 1 FROM departments WHERE head_employee_id = p_id)
    ) used LIMIT 1;
    IF in_use IS NOT NULL THEN
      RAISE EXCEPTION 'employee % is already used (%): roll back the later import batches first', p_id, in_use USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM onboarding_checklists WHERE employee_id = p_id;
    DELETE FROM employee_assignments WHERE employee_id = p_id;
    DELETE FROM employee_job_events WHERE employee_id = p_id;
    DELETE FROM employees WHERE id = p_id;

  ELSIF p_table = 'employee_salaries' THEN
    DELETE FROM employee_salaries WHERE id = p_id;

  ELSIF p_table = 'payroll_ytd_openings' THEN
    DELETE FROM payroll_ytd_openings WHERE id = p_id;

  ELSIF p_table = 'loans' THEN
    IF EXISTS (SELECT 1 FROM loan_recoveries WHERE loan_id = p_id) THEN
      RAISE EXCEPTION 'loan % has recoveries already', p_id USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM loans WHERE id = p_id;

  ELSIF p_table = 'employee_bank_accounts' THEN
    IF EXISTS (SELECT 1 FROM payments WHERE bank_account_id = p_id) THEN
      RAISE EXCEPTION 'bank account % is used by payments already', p_id USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM employee_bank_accounts WHERE id = p_id;

  ELSIF p_table = 'leave_ledger' THEN
    PERFORM set_config('app.import_rollback', 'on', true);
    DELETE FROM leave_ledger WHERE id = p_id AND kind = 'opening';
    PERFORM set_config('app.import_rollback', 'off', true);

  ELSE
    RAISE EXCEPTION 'import rollback does not handle table %', p_table USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION import_remove_record(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_remove_record(text, uuid) TO erp_app;
