-- =============================================================================
-- 0023  Expense claims and employee advances (spec §5 "Expense claim: Dept Head ->
--       Accounts (verify, pay); above threshold -> Admin", §6.6 sub-ledger
--       "employees (advances, loans)"; Phase 2 WP16)
--
--   expense_categories     what an employee may claim, and the account it is booked to
--   expense_advances       cash given ahead (a dealer visit to Chattogram), settled by
--                          claims, a refund, or recovery from salary
--   advance_settlements    how an advance came back (claim / refund / payroll)
--   expense_claims / _lines / expense_receipts
--                          the employee's claim with a receipt per line (photo or PDF)
--   loans (changed)        a salary advance is now also paid out through the books;
--                          origin tells requested / migrated / turned from an advance
--
-- Guarantees in the database:
--   * a claim is paid once (one payment voucher per claim: one_posting_per_source),
--     and a paid claim never changes;
--   * the same receipt file is in one live claim only (duplicate receipts);
--   * a receipt is on one line only;
--   * an advance never gives back more than was paid.
-- =============================================================================

CREATE TABLE expense_categories (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id              uuid NOT NULL,
  code                    text NOT NULL CHECK (code ~ '^[A-Z0-9_]{2,30}$'),
  name_en                 text NOT NULL,
  name_bn                 text,
  account_id              uuid NOT NULL REFERENCES accounts (id),
  -- a receipt is needed above this amount (0 = always); e.g. rickshaw / CNG fares under Tk 500
  receipt_required_above  numeric(14,2) NOT NULL DEFAULT 0 CHECK (receipt_required_above >= 0),
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON expense_categories FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('expense_categories', 'SELECT, INSERT, UPDATE');


CREATE TABLE expense_advances (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  employee_id          uuid NOT NULL,
  number               text NOT NULL,            -- EA/2026-27/00001
  purpose              text NOT NULL,
  amount               numeric(14,2) NOT NULL CHECK (amount > 0),
  needed_by            date,
  --   in_approval  Dept Head -> Accounts (-> Admin above the limit)
  --   approved     waiting to be paid out
  --   paid         the payout voucher is posted; open until settled
  --   settled      everything came back (claims, refund, salary)
  --   rejected / cancelled
  state                text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'approved', 'paid', 'settled', 'rejected', 'cancelled')),
  approval_request_id  uuid,
  voucher_id           uuid REFERENCES vouchers (id),
  paid_at              timestamptz,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON expense_advances FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('expense_advances', 'SELECT, INSERT, UPDATE');


CREATE TABLE expense_claims (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  employee_id          uuid NOT NULL,
  number               text NOT NULL,            -- EC/2026-27/00001
  title                text NOT NULL,
  advance_id           uuid REFERENCES expense_advances (id),
  total                numeric(14,2) NOT NULL DEFAULT 0,
  advance_applied      numeric(14,2) NOT NULL DEFAULT 0,   -- settled against the advance at approval
  payable              numeric(14,2) NOT NULL DEFAULT 0,   -- what the company pays the employee
  --   draft        the employee prepares it (lines, receipts)
  --   in_approval  Dept Head -> Accounts verifies (-> Admin above the limit)
  --   approved     booked; Accounts pays it
  --   paid         the payment voucher is posted (once)
  --   settled      fully covered by the advance; nothing to pay
  --   rejected / cancelled
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'approved', 'paid', 'settled', 'rejected', 'cancelled')),
  approval_request_id  uuid,
  posting_voucher_id   uuid REFERENCES vouchers (id),
  payment_voucher_id   uuid REFERENCES vouchers (id),
  submitted_at         timestamptz,
  paid_at              timestamptz,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  CHECK (advance_applied >= 0 AND advance_applied <= total),
  CHECK (state NOT IN ('approved', 'paid', 'settled') OR payable = total - advance_applied),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('expense_claims', 'SELECT, INSERT, UPDATE');

-- paid once: a paid claim never changes again
CREATE FUNCTION expense_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state IN ('paid', 'settled', 'rejected', 'cancelled') AND (NEW.state, NEW.total, NEW.payable, NEW.payment_voucher_id) IS DISTINCT FROM (OLD.state, OLD.total, OLD.payable, OLD.payment_voucher_id) THEN
    RAISE EXCEPTION 'Expense claim % is %, it cannot change', OLD.number, OLD.state USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'approved' AND (NEW.total, NEW.advance_applied, NEW.payable, NEW.employee_id) IS DISTINCT FROM (OLD.total, OLD.advance_applied, OLD.payable, OLD.employee_id) THEN
    RAISE EXCEPTION 'Approved expense claim % cannot change', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON expense_claims FOR EACH ROW EXECUTE FUNCTION expense_claim_guard();

CREATE TABLE expense_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id    uuid NOT NULL,
  claim_id      uuid NOT NULL REFERENCES expense_claims (id),
  file_key      text NOT NULL,
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0),
  sha256        text NOT NULL,
  -- released when its claim is rejected or cancelled (then it may be claimed again)
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  created_by    uuid DEFAULT app_current_user_id(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- the same receipt cannot be claimed twice
CREATE UNIQUE INDEX expense_receipts_once ON expense_receipts (tenant_id, company_id, sha256) WHERE status = 'active';
SELECT app_secure_tenant_table('expense_receipts', 'SELECT, INSERT, UPDATE');

CREATE TABLE expense_claim_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  claim_id      uuid NOT NULL REFERENCES expense_claims (id),
  line_no       integer NOT NULL,
  expense_date  date NOT NULL,
  category_id   uuid NOT NULL REFERENCES expense_categories (id),
  description   text NOT NULL,
  amount        numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_id    uuid REFERENCES expense_receipts (id),
  UNIQUE (tenant_id, claim_id, line_no)
);
CREATE UNIQUE INDEX expense_lines_receipt_once ON expense_claim_lines (tenant_id, receipt_id) WHERE receipt_id IS NOT NULL;
SELECT app_secure_tenant_table('expense_claim_lines', 'SELECT, INSERT, DELETE');
-- lines change only while the claim is a draft
CREATE FUNCTION expense_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM expense_claims WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
  IF s <> 'draft' THEN
    RAISE EXCEPTION 'Lines of a % expense claim cannot change', s USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER guard BEFORE INSERT OR DELETE ON expense_claim_lines FOR EACH ROW EXECUTE FUNCTION expense_line_guard();


-- salary advances (WP6 loans): paid out through the books from WP16
ALTER TABLE loans ADD COLUMN origin text NOT NULL DEFAULT 'request' CHECK (origin IN ('request', 'import', 'advance'));
ALTER TABLE loans ADD COLUMN payout_voucher_id uuid REFERENCES vouchers (id);
ALTER TABLE loans ADD COLUMN paid_at timestamptz;
ALTER TABLE loans ADD COLUMN source_advance_id uuid REFERENCES expense_advances (id);
UPDATE loans SET origin = 'import' WHERE approval_request_id IS NULL AND state IN ('approved', 'closed');

CREATE TABLE advance_settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  advance_id  uuid NOT NULL REFERENCES expense_advances (id),
  kind        text NOT NULL CHECK (kind IN ('claim', 'refund', 'payroll')),
  claim_id    uuid REFERENCES expense_claims (id),
  loan_id     uuid REFERENCES loans (id),
  voucher_id  uuid REFERENCES vouchers (id),
  amount      numeric(14,2) NOT NULL CHECK (amount > 0),
  --   pending  a refund waiting for its receipt voucher to be checked
  --   done     counted against the advance
  --   cancelled
  state       text NOT NULL DEFAULT 'done' CHECK (state IN ('pending', 'done', 'cancelled')),
  created_by  uuid DEFAULT app_current_user_id(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'claim') = (claim_id IS NOT NULL)),
  CHECK ((kind = 'payroll') = (loan_id IS NOT NULL))
);
CREATE UNIQUE INDEX advance_settled_once_per_claim ON advance_settlements (tenant_id, claim_id) WHERE claim_id IS NOT NULL;
SELECT app_secure_tenant_table('advance_settlements', 'SELECT, INSERT, UPDATE');

-- an advance never gives back more than was paid (pending refunds count)
CREATE FUNCTION advance_settlement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid numeric; back numeric;
BEGIN
  SELECT amount INTO paid FROM expense_advances WHERE id = NEW.advance_id FOR UPDATE;
  SELECT coalesce(sum(amount), 0) INTO back FROM advance_settlements
   WHERE advance_id = NEW.advance_id AND state IN ('pending', 'done') AND id <> NEW.id;
  IF NEW.state IN ('pending', 'done') AND back + NEW.amount > paid THEN
    RAISE EXCEPTION 'Advance settlements exceed the advance (% + % > %)', back, NEW.amount, paid USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE INSERT OR UPDATE ON advance_settlements FOR EACH ROW EXECUTE FUNCTION advance_settlement_guard();
