-- =============================================================================
-- 0031  Bank reconciliation (WP20; spec §6.6 "bank reconciliation", spec §8 "AI bank
--       reconciliation matching", spec §10 n8n "bank statement import")
--
--   company_bank_accounts   a ledger bank account (role bank) with the bank's details,
--                           its statement format, and where reconciliation starts: the
--                           bank's balance at the end of the day before reconcile_from
--   bank_statements         one imported file (upload or n8n); the same file twice is refused
--   bank_statement_lines    append-only; a line already imported from an overlapping file
--                           is skipped (line_key)
--   bank_matches (+ items)  statement lines <-> posted ledger lines of the bank account,
--                           one-to-one or many; undone, never deleted
--
-- Guards in the database (acceptance "no line matched twice"):
--   - a statement line and a ledger line are each in at most one active match
--     (unique partial indexes);
--   - a match balances (statement side = ledger side), each item is the line's own
--     amount, the ledger line is a posted line of the bank account's ledger account
--     (deferred constraint trigger, checked at commit);
--   - undoing a match is the only change; its items follow by trigger.
-- =============================================================================

CREATE TABLE company_bank_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  account_id            uuid NOT NULL REFERENCES accounts (id),
  bank_name             text NOT NULL,
  branch                text,
  account_name          text NOT NULL,
  account_no            text NOT NULL,
  statement_format      text NOT NULL CHECK (statement_format IN ('generic', 'dbbl', 'brac', 'city')),
  reconcile_from        date NOT NULL,
  opening_bank_balance  numeric(16,2) NOT NULL,
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, account_id)
);
CREATE TRIGGER touch BEFORE UPDATE ON company_bank_accounts FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('company_bank_accounts', 'SELECT, INSERT, UPDATE');

CREATE TABLE bank_statements (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  bank_account_id  uuid NOT NULL REFERENCES company_bank_accounts (id),
  source           text NOT NULL CHECK (source IN ('upload', 'n8n')),
  file_name        text NOT NULL,
  file_sha256      text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  period_from      date NOT NULL,
  period_to        date NOT NULL,
  opening_balance  numeric(16,2),
  closing_balance  numeric(16,2),
  lines_imported   integer NOT NULL CHECK (lines_imported >= 0),
  lines_skipped    integer NOT NULL CHECK (lines_skipped >= 0),
  imported_by      uuid DEFAULT app_current_user_id(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, file_sha256),
  CHECK (period_from <= period_to)
);
SELECT app_secure_tenant_table('bank_statements', 'SELECT, INSERT');

CREATE TABLE bank_statement_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  bank_account_id  uuid NOT NULL REFERENCES company_bank_accounts (id),
  statement_id     uuid NOT NULL REFERENCES bank_statements (id),
  line_no          integer NOT NULL,
  txn_date         date NOT NULL,
  value_date       date,
  description      text NOT NULL,
  reference        text,
  -- deposit +, withdrawal -
  amount           numeric(16,2) NOT NULL CHECK (amount <> 0),
  balance          numeric(16,2),
  -- the same transaction in an overlapping statement has the same key
  line_key         text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bank_account_id, line_key),
  UNIQUE (statement_id, line_no)
);
CREATE INDEX bank_statement_lines_date ON bank_statement_lines (tenant_id, bank_account_id, txn_date);
SELECT app_secure_tenant_table('bank_statement_lines', 'SELECT, INSERT');

CREATE TABLE bank_matches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  bank_account_id  uuid NOT NULL REFERENCES company_bank_accounts (id),
  -- auto: the rules matched it; manual: a person did; suggestion: a person accepted a
  -- suggestion (rules or AI)
  kind             text NOT NULL CHECK (kind IN ('auto', 'manual', 'suggestion')),
  note             text,
  matched_by       uuid DEFAULT app_current_user_id(),
  matched_at       timestamptz NOT NULL DEFAULT now(),
  undone_by        uuid,
  undone_at        timestamptz,
  undo_reason      text,
  CHECK ((undone_at IS NULL) = (undone_by IS NULL) AND (undone_at IS NULL) = (undo_reason IS NULL))
);
SELECT app_secure_tenant_table('bank_matches', 'SELECT, INSERT');
GRANT UPDATE (undone_by, undone_at, undo_reason) ON bank_matches TO erp_app;

CREATE TABLE bank_match_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  match_id           uuid NOT NULL REFERENCES bank_matches (id),
  bank_account_id    uuid NOT NULL REFERENCES company_bank_accounts (id),
  statement_line_id  uuid REFERENCES bank_statement_lines (id),
  voucher_line_id    uuid REFERENCES voucher_lines (id),
  -- signed: deposit / debit to the bank +, withdrawal / credit -
  amount             numeric(16,2) NOT NULL CHECK (amount <> 0),
  active             boolean NOT NULL DEFAULT true,
  CHECK ((statement_line_id IS NULL) <> (voucher_line_id IS NULL))
);
-- no line matched twice
CREATE UNIQUE INDEX statement_line_matched_once ON bank_match_items (tenant_id, statement_line_id) WHERE active AND statement_line_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_line_matched_once ON bank_match_items (tenant_id, voucher_line_id) WHERE active AND voucher_line_id IS NOT NULL;
CREATE INDEX bank_match_items_match ON bank_match_items (match_id);
SELECT app_secure_tenant_table('bank_match_items', 'SELECT, INSERT');

-- a match is checked at commit: it balances, and every item is the line it says it is
CREATE FUNCTION bank_match_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_statement numeric;
  v_ledger numeric;
  v_n_statement integer;
  v_n_ledger integer;
  v_bad integer;
BEGIN
  SELECT coalesce(sum(amount) FILTER (WHERE statement_line_id IS NOT NULL), 0), coalesce(sum(amount) FILTER (WHERE voucher_line_id IS NOT NULL), 0),
         count(*) FILTER (WHERE statement_line_id IS NOT NULL), count(*) FILTER (WHERE voucher_line_id IS NOT NULL)
    INTO v_statement, v_ledger, v_n_statement, v_n_ledger
    FROM bank_match_items WHERE match_id = NEW.match_id;
  IF v_n_statement = 0 OR v_n_ledger = 0 OR v_statement <> v_ledger THEN
    RAISE EXCEPTION 'Bank match % does not balance (statement %, ledger %)', NEW.match_id, v_statement, v_ledger USING ERRCODE = 'check_violation';
  END IF;

  SELECT count(*) INTO v_bad
    FROM bank_match_items i
    JOIN bank_matches m ON m.id = i.match_id
    LEFT JOIN bank_statement_lines s ON s.id = i.statement_line_id
    LEFT JOIN voucher_lines vl ON vl.id = i.voucher_line_id
    LEFT JOIN vouchers v ON v.id = vl.voucher_id
    LEFT JOIN company_bank_accounts b ON b.id = i.bank_account_id
   WHERE i.match_id = NEW.match_id
     AND (i.bank_account_id <> m.bank_account_id
       OR (i.statement_line_id IS NOT NULL AND (s.bank_account_id <> i.bank_account_id OR s.amount <> i.amount))
       OR (i.voucher_line_id IS NOT NULL AND (vl.account_id <> b.account_id OR v.state <> 'posted' OR vl.debit - vl.credit <> i.amount)));
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'Bank match % has lines of another account, unposted lines or wrong amounts', NEW.match_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER balanced AFTER INSERT ON bank_match_items DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION bank_match_check();

-- undone once; the items leave the match with it (the app cannot change items itself)
CREATE FUNCTION bank_match_undo() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bank match % is already undone', OLD.id USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.undone_at IS NOT NULL THEN
    UPDATE bank_match_items SET active = false WHERE match_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER undo AFTER UPDATE ON bank_matches FOR EACH ROW EXECUTE FUNCTION bank_match_undo();

-- AI match suggestions (spec §8): a feature of its own, switched separately
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion'));
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_feature_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion'));
ALTER TABLE ai_settings ADD COLUMN bank_match_enabled boolean NOT NULL DEFAULT true;
GRANT INSERT (bank_match_enabled) ON ai_settings TO erp_app;
GRANT UPDATE (bank_match_enabled) ON ai_settings TO erp_app;
