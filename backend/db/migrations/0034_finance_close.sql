-- =============================================================================
-- 0034  Finance close and Gate 2 (WP22; spec §6.6 reports, §12 Gate 2 "a pilot closes one
--       month fully in the system, and the trial balance reconciles")
--
--   opening_balance_imports   the old system's trial balance at cut-over: checked, posted
--                       as THE opening voucher (to the checker); the open items behind the
--                       control accounts (vendor bills, customer invoices) come with it
--   account_map         old system account code -> our account (kept from the opening import,
--                       used to compare the old system's later trial balances)
--   vendor_bills.is_opening   bills still unpaid at cut-over (no journal of their own: the
--                       opening voucher carries them)
--   receivable_items (+ receipts)   what customers owe (opening invoices); receipts against
--                       them; the receivables account becomes a control account
--   old_system_comparisons    the old system's trial balance on a date against ours
--   month_close_items   the month-end checklist's ticks a person makes
--   AI document reader  a feature of its own (bill and receipt photos -> suggested fields)
-- =============================================================================

CREATE TABLE opening_balance_imports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  cut_over_date   date NOT NULL CHECK (extract(day FROM cut_over_date) = 1),
  file_name       text NOT NULL,
  file_sha256     text NOT NULL,
  -- the checked rows (accounts, open items), applied when the voucher is posted
  rows            jsonb NOT NULL,
  total_debit     numeric(16,2) NOT NULL,
  total_credit    numeric(16,2) NOT NULL,
  --   in_approval  the opening voucher waits for the checker
  --   posted       in the books; open items and the account map created
  --   cancelled    rejected or withdrawn
  state           text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'posted', 'cancelled')),
  voucher_id      uuid REFERENCES vouchers (id),
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (total_debit = total_credit)
);
CREATE UNIQUE INDEX one_live_opening_import ON opening_balance_imports (tenant_id, company_id) WHERE state <> 'cancelled';
SELECT app_secure_tenant_table('opening_balance_imports', 'SELECT, INSERT');
GRANT UPDATE (state, voucher_id) ON opening_balance_imports TO erp_app;

CREATE TABLE account_map (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  old_code     text NOT NULL,
  old_name     text,
  account_id   uuid NOT NULL REFERENCES accounts (id),
  PRIMARY KEY (tenant_id, company_id, old_code)
);
SELECT app_secure_tenant_table('account_map', 'SELECT, INSERT, UPDATE');

ALTER TABLE vendor_bills ADD COLUMN is_opening boolean NOT NULL DEFAULT false;


CREATE TABLE receivable_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  customer_name   text NOT NULL,
  reference       text NOT NULL,           -- the invoice number (old system)
  invoice_date    date NOT NULL,
  due_date        date NOT NULL,
  amount          numeric(16,2) NOT NULL CHECK (amount > 0),
  received        numeric(16,2) NOT NULL DEFAULT 0 CHECK (received >= 0),
  opening_import_id uuid REFERENCES opening_balance_imports (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, customer_name, reference),
  CHECK (received <= amount),
  CHECK (due_date >= invoice_date)
);
SELECT app_secure_tenant_table('receivable_items', 'SELECT, INSERT');
GRANT UPDATE (received) ON receivable_items TO erp_app;

CREATE TABLE receivable_receipts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  item_id               uuid NOT NULL REFERENCES receivable_items (id),
  receipt_date          date NOT NULL,
  amount                numeric(16,2) NOT NULL CHECK (amount > 0),
  received_into_account_id uuid NOT NULL REFERENCES accounts (id),
  reference             text,
  --   in_approval -> posted (counts against the item) | cancelled | reversed
  state                 text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'posted', 'cancelled', 'reversed')),
  voucher_id            uuid REFERENCES vouchers (id),
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now()
);
SELECT app_secure_tenant_table('receivable_receipts', 'SELECT, INSERT');
GRANT UPDATE (state, voucher_id) ON receivable_receipts TO erp_app;


CREATE TABLE old_system_comparisons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  as_of           date NOT NULL,
  file_name       text NOT NULL,
  file_sha256     text NOT NULL,
  -- per account: old system, ours, difference; old codes without a mapping
  result          jsonb NOT NULL,
  differences     integer NOT NULL CHECK (differences >= 0),
  unmapped        integer NOT NULL CHECK (unmapped >= 0),
  matched         boolean NOT NULL,
  note            text,
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (matched = (differences = 0 AND unmapped = 0))
);
SELECT app_secure_tenant_table('old_system_comparisons', 'SELECT, INSERT');


CREATE TABLE month_close_items (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  period       text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  key          text NOT NULL CHECK (key ~ '^[a-z_]{3,40}$'),
  done_by      uuid NOT NULL DEFAULT app_current_user_id(),
  done_at      timestamptz NOT NULL DEFAULT now(),
  note         text NOT NULL,
  PRIMARY KEY (tenant_id, company_id, period, key)
);
SELECT app_secure_tenant_table('month_close_items', 'SELECT, INSERT, DELETE');


-- AI bill and receipt reader (spec §8): a feature of its own, switched separately
ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader'));
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_feature_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader'));
ALTER TABLE ai_settings ADD COLUMN document_reader_enabled boolean NOT NULL DEFAULT true;
GRANT INSERT (document_reader_enabled) ON ai_settings TO erp_app;
GRANT UPDATE (document_reader_enabled) ON ai_settings TO erp_app;
