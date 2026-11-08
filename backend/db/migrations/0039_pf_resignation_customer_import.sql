-- =============================================================================
-- 0039  Completing what was built (2026-10-30, the owner's list before go-live)
--
--   pf_transactions        the PF ledger beyond contributions: interest credited for a year,
--                          withdrawals from the member's own part, the final settlement
--                          and the employer part forfeited (not vested)
--   resignation_requests   an employee resigns from the app; on approval (Dept Head, HR)
--                          the separation (notice, clearances, final settlement) starts
--   customer import        the migration tool takes the customer master (entity 'customers')
-- =============================================================================

CREATE TABLE pf_transactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  employee_id     uuid NOT NULL,
  --   interest     credited for a fiscal year (both parts, in proportion)
  --   withdrawal   paid out of the member's own part
  --   settlement   paid out on leaving (own part and the vested employer part)
  --   forfeit      the employer part not vested on leaving (back to the company)
  kind            text NOT NULL CHECK (kind IN ('interest', 'withdrawal', 'settlement', 'forfeit')),
  txn_date        date NOT NULL,
  -- signed: interest adds, the others take out
  employee_part   numeric(14,2) NOT NULL,
  employer_part   numeric(14,2) NOT NULL,
  fiscal_year     text,                                -- interest: the year it is for
  rate_percent    numeric(6,3),                        -- interest: the rate declared
  note            text,
  --   in_approval  the payment voucher waits for the checker (withdrawal, settlement)
  --   posted       in the member's ledger
  --   cancelled    the voucher was rejected or withdrawn
  state           text NOT NULL DEFAULT 'posted' CHECK (state IN ('in_approval', 'posted', 'cancelled')),
  voucher_id      uuid REFERENCES vouchers (id),
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  CHECK ((kind = 'interest') = (fiscal_year IS NOT NULL)),
  CHECK (kind = 'interest' OR (employee_part <= 0 AND employer_part <= 0))
);
-- interest once per member and year; one live final settlement per member
CREATE UNIQUE INDEX pf_interest_once ON pf_transactions (tenant_id, employee_id, fiscal_year) WHERE kind = 'interest';
CREATE UNIQUE INDEX pf_settlement_once ON pf_transactions (tenant_id, employee_id) WHERE kind = 'settlement' AND state <> 'cancelled';
CREATE INDEX pf_transactions_employee ON pf_transactions (tenant_id, employee_id, txn_date);
SELECT app_secure_tenant_table('pf_transactions', 'SELECT, INSERT');
GRANT UPDATE (state, voucher_id) ON pf_transactions TO erp_app;

CREATE TABLE resignation_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  employee_id          uuid NOT NULL,
  notice_date          date NOT NULL,                  -- the day it was handed in
  last_working_day     date NOT NULL CHECK (last_working_day >= notice_date),
  reason               text NOT NULL,
  --   in_approval -> accepted (the separation is recorded) | rejected | withdrawn
  state                text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'accepted', 'rejected', 'withdrawn')),
  approval_request_id  uuid,
  separation_id        uuid REFERENCES separations (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE UNIQUE INDEX resignation_requests_live ON resignation_requests (tenant_id, employee_id) WHERE state = 'in_approval';
CREATE TRIGGER touch BEFORE UPDATE ON resignation_requests FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('resignation_requests', 'SELECT, INSERT, UPDATE');

-- customer import
ALTER TABLE import_batches DROP CONSTRAINT import_batches_entity_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_entity_check
  CHECK (entity IN ('employees', 'salaries', 'leave_balances', 'ytd_openings', 'loans', 'bank_accounts', 'customers'));

CREATE OR REPLACE FUNCTION import_remove_record(p_table text, p_id uuid) RETURNS void
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

  ELSIF p_table = 'customers' THEN
    SELECT label INTO in_use FROM (
      SELECT 'leads' AS label WHERE EXISTS (SELECT 1 FROM leads WHERE customer_id = p_id)
      UNION ALL SELECT 'activities' WHERE EXISTS (SELECT 1 FROM crm_activities WHERE customer_id = p_id)
      UNION ALL SELECT 'opportunities' WHERE EXISTS (SELECT 1 FROM opportunities WHERE customer_id = p_id)
      UNION ALL SELECT 'quotations' WHERE EXISTS (SELECT 1 FROM sales_quotations WHERE customer_id = p_id)
      UNION ALL SELECT 'invoices' WHERE EXISTS (SELECT 1 FROM receivable_items WHERE customer_id = p_id)
      UNION ALL SELECT 'receipts' WHERE EXISTS (SELECT 1 FROM customer_receipts WHERE customer_id = p_id)
    ) used LIMIT 1;
    IF in_use IS NOT NULL THEN
      RAISE EXCEPTION 'customer % is already used (%)', p_id, in_use USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM crm_contact_keys WHERE customer_id = p_id;
    DELETE FROM customer_contacts WHERE customer_id = p_id;
    DELETE FROM customers WHERE id = p_id;

  ELSE
    RAISE EXCEPTION 'import rollback does not handle table %', p_table USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION import_remove_record(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION import_remove_record(text, uuid) TO erp_app;
