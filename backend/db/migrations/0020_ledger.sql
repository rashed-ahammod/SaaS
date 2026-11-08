-- =============================================================================
-- 0020  General ledger (spec §6.6, §11 "Financial integrity"; Phase 2 WP14)
--
--   fiscal_years / accounting_periods  July-June years (company setting), monthly periods
--   accounts                           chart of accounts per company (Bangladesh template)
--   posting_accounts                   which account an automatic posting uses ("payroll.tax_payable" -> 2150)
--   voucher_sequences                  gapless numbers per company x fiscal year x voucher type
--   vouchers / voucher_lines           double entry; cost centre = department
--
-- Guarantees in the database (the service checks first, these are the last line):
--   * a voucher becomes "posted" only when debits = credits > 0, with >= 2 lines,
--     inside an open period (a closed period accepts only reversal vouchers);
--   * a posted voucher never changes (only "reversed_by" may be set once), its
--     lines can never change, and lines are frozen as soon as it is submitted;
--   * one automatic posting per source document (payroll run, bank file ...).
-- =============================================================================

CREATE TABLE fiscal_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL,                    -- e.g. "2026-27"
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, code),
  CHECK (ends_on > starts_on)
);
SELECT app_secure_tenant_table('fiscal_years', 'SELECT, INSERT');

CREATE TABLE accounting_periods (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  fiscal_year_id  uuid NOT NULL REFERENCES fiscal_years (id),
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  starts_on       date NOT NULL,
  ends_on         date NOT NULL,
  state           text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
  closed_by       uuid,
  closed_at       timestamptz,
  UNIQUE (tenant_id, company_id, period),
  CHECK (state = 'open' OR (closed_by IS NOT NULL AND closed_at IS NOT NULL))
);
SELECT app_secure_tenant_table('accounting_periods', 'SELECT, INSERT, UPDATE');
-- a closed period stays closed (spec §6.6)
CREATE FUNCTION accounting_period_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'closed' THEN
    RAISE EXCEPTION 'Accounting period % is closed', OLD.period USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stays_closed BEFORE UPDATE OR DELETE ON accounting_periods FOR EACH ROW EXECUTE FUNCTION accounting_period_guard();


CREATE TABLE accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[0-9A-Za-z.-]{1,20}$'),
  name_en     text NOT NULL,
  name_bn     text,
  type        text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  parent_id   uuid REFERENCES accounts (id),
  -- group accounts only add up their children; vouchers use postable (leaf) accounts
  postable    boolean NOT NULL DEFAULT true,
  -- what the account is for, where the system needs to know (cash / bank for payment
  -- vouchers, control accounts of sub-ledgers in later work packages)
  role        text CHECK (role IN ('cash', 'bank', 'payables', 'receivables', 'employee_advances', 'retained_earnings')),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('accounts', 'SELECT, INSERT, UPDATE');

CREATE TABLE posting_accounts (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  key         text NOT NULL CHECK (key ~ '^[a-z_]+(\.[A-Za-z0-9_]+)+$'),
  account_id  uuid NOT NULL REFERENCES accounts (id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id, key)
);
SELECT app_secure_tenant_table('posting_accounts', 'SELECT, INSERT, UPDATE, DELETE');


CREATE TABLE voucher_sequences (
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  fiscal_year_id  uuid NOT NULL REFERENCES fiscal_years (id),
  voucher_type    text NOT NULL,
  last_no         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, company_id, fiscal_year_id, voucher_type)
);
SELECT app_secure_tenant_table('voucher_sequences', 'SELECT, INSERT, UPDATE');

CREATE TABLE vouchers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  fiscal_year_id       uuid NOT NULL REFERENCES fiscal_years (id),
  voucher_type         text NOT NULL CHECK (voucher_type IN ('payment', 'receipt', 'journal', 'contra')),
  -- gapless per company x fiscal year x type, given when the voucher is created;
  -- a cancelled voucher keeps its number (spec §11)
  number               text NOT NULL,
  voucher_date         date NOT NULL,
  narration            text NOT NULL,
  --   draft        being prepared by the maker (lines may change)
  --   in_approval  submitted; lines frozen; checker (and Admin above the limit) decide
  --   posted       in the books for good; corrected only by a reversal voucher
  --   cancelled    withdrawn, rejected or returned-and-dropped; the number stays visible
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'posted', 'cancelled')),
  -- automatic postings: the document they come from (unique, see index below)
  source_type          text,
  source_id            uuid,
  is_opening           boolean NOT NULL DEFAULT false,
  reversal_of          uuid REFERENCES vouchers (id),
  reversed_by          uuid REFERENCES vouchers (id),
  reason               text,                       -- reversal or cancellation reason
  total                numeric(16,2) NOT NULL DEFAULT 0,
  approval_request_id  uuid,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  posted_at            timestamptz,
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  CHECK ((source_type IS NULL) = (source_id IS NULL)),
  CHECK (reversal_of IS NULL OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_posting_per_source ON vouchers (tenant_id, company_id, source_type, source_id)
  WHERE source_type IS NOT NULL AND reversal_of IS NULL AND state <> 'cancelled';
CREATE UNIQUE INDEX reversed_once ON vouchers (tenant_id, reversal_of) WHERE reversal_of IS NOT NULL AND state <> 'cancelled';
CREATE INDEX vouchers_books ON vouchers (tenant_id, company_id, voucher_date) WHERE state = 'posted';
SELECT app_secure_tenant_table('vouchers', 'SELECT, INSERT, UPDATE');

CREATE TABLE voucher_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  voucher_id     uuid NOT NULL REFERENCES vouchers (id),
  line_no        integer NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts (id),
  department_id  uuid,                              -- cost centre
  party_type     text CHECK (party_type IN ('employee', 'vendor', 'customer')),
  party_id       uuid,
  debit          numeric(16,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit         numeric(16,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  narration      text,
  UNIQUE (voucher_id, line_no),
  CHECK ((debit > 0) <> (credit > 0)),
  CHECK ((party_type IS NULL) = (party_id IS NULL))
);
CREATE INDEX voucher_lines_account ON voucher_lines (tenant_id, account_id);
SELECT app_secure_tenant_table('voucher_lines', 'SELECT, INSERT, DELETE');


-- ---------------------------------------------------------------- guards

CREATE FUNCTION voucher_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
  v_period text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Vouchers are never deleted; cancel or reverse them' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- posted is permanent: only reversed_by may be filled in, once
  IF OLD.state = 'posted' THEN
    IF NEW.reversed_by IS NOT NULL AND OLD.reversed_by IS NULL
       AND (NEW.id, NEW.tenant_id, NEW.company_id, NEW.fiscal_year_id, NEW.voucher_type, NEW.number, NEW.voucher_date, NEW.narration, NEW.state,
            NEW.source_type, NEW.source_id, NEW.is_opening, NEW.reversal_of, NEW.reason, NEW.total, NEW.approval_request_id, NEW.created_by, NEW.posted_at)
           IS NOT DISTINCT FROM
           (OLD.id, OLD.tenant_id, OLD.company_id, OLD.fiscal_year_id, OLD.voucher_type, OLD.number, OLD.voucher_date, OLD.narration, OLD.state,
            OLD.source_type, OLD.source_id, OLD.is_opening, OLD.reversal_of, OLD.reason, OLD.total, OLD.approval_request_id, OLD.created_by, OLD.posted_at)
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Voucher % is posted: correct it with a reversal', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'cancelled' THEN
    RAISE EXCEPTION 'Voucher % is cancelled', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- a submitted voucher keeps its content while it is decided
  IF OLD.state = 'in_approval' AND NEW.state = 'in_approval' THEN
    RAISE EXCEPTION 'Voucher % is waiting for approval', OLD.number USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- posting: balanced, inside an open period (a closed one takes reversals only)
  IF NEW.state = 'posted' THEN
    SELECT coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) INTO v_debit, v_credit, v_lines
      FROM voucher_lines WHERE voucher_id = NEW.id;
    IF v_lines < 2 OR v_debit <> v_credit OR v_debit = 0 THEN
      RAISE EXCEPTION 'Voucher % does not balance (debit %, credit %, % lines)', NEW.number, v_debit, v_credit, v_lines USING ERRCODE = 'check_violation';
    END IF;
    v_period := to_char(NEW.voucher_date, 'YYYY-MM');
    IF NOT EXISTS (SELECT 1 FROM accounting_periods p WHERE p.company_id = NEW.company_id AND p.period = v_period
                    AND (p.state = 'open' OR NEW.reversal_of IS NOT NULL)) THEN
      RAISE EXCEPTION 'No open accounting period % for voucher %', v_period, NEW.number USING ERRCODE = 'check_violation';
    END IF;
    NEW.total := v_debit;
    NEW.posted_at := coalesce(NEW.posted_at, now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE OR DELETE ON vouchers FOR EACH ROW EXECUTE FUNCTION voucher_guard();

-- a voucher is created as a draft; it reaches "posted" only through the guarded update
CREATE FUNCTION voucher_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state <> 'draft' THEN
    RAISE EXCEPTION 'A voucher is created as a draft' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER created_as_draft BEFORE INSERT ON vouchers FOR EACH ROW EXECUTE FUNCTION voucher_insert_guard();

-- lines change only while the voucher is a draft
CREATE FUNCTION voucher_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_state text;
BEGIN
  SELECT state INTO v_state FROM vouchers WHERE id = coalesce(NEW.voucher_id, OLD.voucher_id);
  IF v_state IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Lines of a % voucher cannot change', v_state USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER guard BEFORE INSERT OR UPDATE OR DELETE ON voucher_lines FOR EACH ROW EXECUTE FUNCTION voucher_line_guard();
