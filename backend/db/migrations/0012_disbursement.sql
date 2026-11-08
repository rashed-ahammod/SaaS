-- =============================================================================
-- 0012  Disbursement (spec §6.4 steps 8-9, guide §7.7, §13)
--
--   payments            one row per employee per pay type of an approved run.
--                       The amount and the destination never change; only the status moves:
--                         approved -> in_file -> paid
--                                 \-> returned (bank / wallet rejected it) -> reissued
--                       A re-issue is a NEW payment row linked to the returned one.
--   disbursement_files  the bank / wallet / cash file built from approved payments,
--                       with its checksum. Regenerating needs the active file cancelled
--                       with a reason and a second approval.
-- =============================================================================

-- payroll runs gain the final state "disbursed" (every payment paid)
ALTER TABLE payroll_runs DROP CONSTRAINT payroll_runs_state_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_state_check
  CHECK (state IN ('draft', 'calculated', 'in_approval', 'verified', 'approved', 'disbursed', 'cancelled'));
ALTER TABLE payroll_runs ADD COLUMN disbursed_at timestamptz;


CREATE TABLE disbursement_files (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id                 uuid NOT NULL,
  run_id                     uuid NOT NULL,
  -- bank (BEFTN), a wallet provider (bkash, nagad, rocket, upay) or cash
  channel                    text NOT NULL CHECK (channel IN ('bank', 'bkash', 'nagad', 'rocket', 'upay', 'cash')),
  adapter                    text NOT NULL,                     -- file format, e.g. beftn-csv, bkash-bulk
  file_key                   text NOT NULL,                     -- storage key
  file_name                  text NOT NULL,
  content_type               text NOT NULL,
  checksum_sha256            text NOT NULL,
  payment_count              integer NOT NULL CHECK (payment_count > 0),
  total_amount               numeric(16,2) NOT NULL CHECK (total_amount > 0),
  --   active     sent / to be sent to the bank, waiting for the result
  --   settled    the bank paid it (returns may still come in later)
  --   cancelled  withdrawn with a reason and a second approval; its payments are free again
  state                      text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'settled', 'cancelled')),
  cancel_reason              text,
  cancel_approval_request_id uuid,
  cancelled_at               timestamptz,
  settled_at                 timestamptz,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 uuid DEFAULT app_current_user_id(),
  CHECK (state <> 'cancelled' OR cancel_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
-- one active file per run and channel (guide §7.7)
CREATE UNIQUE INDEX one_active_file ON disbursement_files (tenant_id, run_id, channel) WHERE state = 'active';
SELECT app_secure_tenant_table('disbursement_files', 'SELECT, INSERT, UPDATE');


CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  run_id          uuid NOT NULL,
  employee_id     uuid NOT NULL,
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- salary | final_settlement | bonus:<bonus name>
  pay_type        text NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  channel         text NOT NULL CHECK (channel IN ('bank', 'bkash', 'nagad', 'rocket', 'upay', 'cash')),
  -- the approved salary account at the time (null = cash); a later account change does not redirect it
  bank_account_id uuid,
  -- printed in the bank file and matched in return files, e.g. "PAY-2026-09-7F3A91C2"
  reference       text NOT NULL,
  status          text NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'in_file', 'paid', 'returned', 'reissued')),
  file_id         uuid,
  reissue_of      uuid,                                    -- the returned payment this one replaces
  returned_reason text,
  returned_at     timestamptz,
  paid_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT app_current_user_id(),
  CHECK (channel = 'cash' OR bank_account_id IS NOT NULL),
  CHECK (status <> 'returned' OR returned_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reference),
  FOREIGN KEY (tenant_id, run_id) REFERENCES payroll_runs (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, file_id) REFERENCES disbursement_files (tenant_id, id),
  FOREIGN KEY (tenant_id, reissue_of) REFERENCES payments (tenant_id, id)
);
-- An employee can be paid once per period per pay type (spec §11, guide §7.7)
CREATE UNIQUE INDEX one_payment_per_period ON payments (tenant_id, employee_id, period, pay_type)
  WHERE status IN ('approved', 'in_file', 'paid');
CREATE INDEX payments_run ON payments (tenant_id, run_id, status);
SELECT app_secure_tenant_table('payments', 'SELECT, INSERT, UPDATE');

-- What was paid, to whom and how much never changes (guide §5 rule 3): only status fields move.
CREATE FUNCTION payments_reject_money_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.run_id IS DISTINCT FROM OLD.run_id
     OR NEW.channel IS DISTINCT FROM OLD.channel
     OR NEW.bank_account_id IS DISTINCT FROM OLD.bank_account_id
     OR NEW.reference IS DISTINCT FROM OLD.reference
     OR NEW.pay_type IS DISTINCT FROM OLD.pay_type THEN
    RAISE EXCEPTION 'a payment''s amount and destination cannot change; return and re-issue it instead'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER money_fixed BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_reject_money_change();
