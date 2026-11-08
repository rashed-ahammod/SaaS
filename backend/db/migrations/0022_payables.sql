-- =============================================================================
-- 0022  Vendors, bills and tax at source (spec §6.6, §6.7 step 5, §11; Phase 2 WP15)
--
--   payables_settings          per company: VAT withholding entity?, default payment terms
--   vendors                    suppliers; TIN / BIN decide the tax treatment
--   vendor_bank_accounts       where a vendor is paid: encrypted, maker-checker (spec §3, §11)
--   vendor_bills / _lines      the vendor's invoice: expense lines, VAT, tax withheld
--   vendor_payments / _allocations   a payment voucher settling one or more bills
--   tax_withholdings           income tax (TDS) and VAT (VDS) deducted, one per bill and tax
--   tax_challans               deposit of withheld tax to the government
--   tax_certificates           certificate to the vendor for a period (withholdings certified once)
--   payables_sequences         gapless certificate numbers per company x kind x fiscal year
--
-- Guarantees in the database:
--   * one live bill per vendor and invoice number (no duplicate bills);
--   * a bill is never paid more than its net payable;
--   * an approved bill's amounts never change (only the amount paid, or void by reversal);
--   * a withholding is in at most one challan and one certificate;
--   * one approved bank account per vendor at a time.
-- =============================================================================

CREATE TABLE payables_settings (
  tenant_id                uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id               uuid NOT NULL,
  -- the company deducts VAT at source from its suppliers (VAT and SD Act 2012 s.49)
  vat_withholding_entity   boolean NOT NULL DEFAULT false,
  default_payment_terms_days integer NOT NULL DEFAULT 30 CHECK (default_payment_terms_days BETWEEN 0 AND 365),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, company_id)
);
CREATE TRIGGER touch BEFORE UPDATE ON payables_settings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('payables_settings', 'SELECT, INSERT, UPDATE');

CREATE TABLE vendors (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  code                  text NOT NULL CHECK (code ~ '^[A-Za-z0-9-]{1,20}$'),
  name                  text NOT NULL,
  name_bn               text,
  vendor_type           text NOT NULL DEFAULT 'company' CHECK (vendor_type IN ('company', 'individual')),
  tin                   text CHECK (tin ~ '^[0-9]{12}$'),            -- e-TIN
  bin                   text CHECK (bin ~ '^[0-9]{9}(-?[0-9]{4})?$'), -- VAT registration (BIN)
  trade_licence         text,
  phone                 text,
  email                 text,
  address               text,
  -- payment category for tax at source (rule pack tax.tds.vendor_categories)
  withholding_category  text NOT NULL DEFAULT 'SUPPLY' CHECK (withholding_category ~ '^[A-Z_]{2,30}$'),
  payment_terms_days    integer CHECK (payment_terms_days BETWEEN 0 AND 365),
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
-- the same supplier twice is a classic duplicate-payment path
CREATE UNIQUE INDEX vendors_one_per_tin ON vendors (tenant_id, company_id, tin) WHERE tin IS NOT NULL;
CREATE TRIGGER touch BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('vendors', 'SELECT, INSERT, UPDATE');

CREATE TABLE vendor_bank_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  vendor_id            uuid NOT NULL REFERENCES vendors (id),
  bank_name            text NOT NULL,
  account_last4        text NOT NULL,
  details_encrypted    text NOT NULL,          -- account name, number, branch, routing number (encrypted JSON)
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'retired', 'rejected', 'cancelled')),
  approval_request_id  uuid,
  approved_at          timestamptz,
  retired_at           timestamptz,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vendor_bank_one_approved ON vendor_bank_accounts (tenant_id, vendor_id) WHERE status = 'approved';
CREATE UNIQUE INDEX vendor_bank_one_pending ON vendor_bank_accounts (tenant_id, vendor_id) WHERE status = 'pending';
SELECT app_secure_tenant_table('vendor_bank_accounts', 'SELECT, INSERT, UPDATE');


CREATE TABLE vendor_bills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  vendor_id             uuid NOT NULL REFERENCES vendors (id),
  bill_no               text NOT NULL,            -- the vendor's invoice number (Mushak 6.3)
  bill_date             date NOT NULL,
  due_date              date NOT NULL,
  narration             text NOT NULL,
  withholding_category  text NOT NULL,
  base_amount           numeric(16,2) NOT NULL DEFAULT 0,   -- before VAT
  vat_amount            numeric(16,2) NOT NULL DEFAULT 0,
  tds_percent           numeric(9,4) NOT NULL DEFAULT 0,
  tds_amount            numeric(16,2) NOT NULL DEFAULT 0,
  vds_percent           numeric(9,4) NOT NULL DEFAULT 0,
  vds_amount            numeric(16,2) NOT NULL DEFAULT 0,
  input_vat             numeric(16,2) NOT NULL DEFAULT 0,
  vat_in_cost           numeric(16,2) NOT NULL DEFAULT 0,
  net_payable           numeric(16,2) NOT NULL DEFAULT 0,
  paid_amount           numeric(16,2) NOT NULL DEFAULT 0,
  rule_pack             text,                     -- which rule pack the withholding came from
  --   draft        being prepared (lines may change)
  --   in_approval  submitted; another Accounts user (and Admin above the limit) decides
  --   approved     posted to the books; payable
  --   cancelled    withdrawn, rejected, or voided by reversing its posting
  state                 text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'approved', 'cancelled')),
  voucher_id            uuid REFERENCES vouchers (id),
  approval_request_id   uuid,
  cancel_reason         text,
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  CHECK (due_date >= bill_date),
  CHECK (paid_amount >= 0 AND paid_amount <= net_payable),
  CHECK (net_payable = base_amount + vat_amount - tds_amount - vds_amount),
  CHECK (state <> 'approved' OR voucher_id IS NOT NULL)
);
-- no duplicate bills: one live bill per vendor and invoice number
CREATE UNIQUE INDEX vendor_bills_no_duplicate ON vendor_bills (tenant_id, vendor_id, lower(bill_no)) WHERE state <> 'cancelled';
CREATE INDEX vendor_bills_open ON vendor_bills (tenant_id, company_id, vendor_id) WHERE state = 'approved';
CREATE TRIGGER touch BEFORE UPDATE ON vendor_bills FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('vendor_bills', 'SELECT, INSERT, UPDATE');

-- an approved bill keeps its amounts; only the amount paid moves, or the bill is voided
CREATE FUNCTION vendor_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'approved' AND (
       NEW.vendor_id, NEW.bill_no, NEW.bill_date, NEW.due_date, NEW.base_amount, NEW.vat_amount, NEW.tds_amount,
       NEW.vds_amount, NEW.input_vat, NEW.vat_in_cost, NEW.net_payable, NEW.voucher_id
     ) IS DISTINCT FROM (
       OLD.vendor_id, OLD.bill_no, OLD.bill_date, OLD.due_date, OLD.base_amount, OLD.vat_amount, OLD.tds_amount,
       OLD.vds_amount, OLD.input_vat, OLD.vat_in_cost, OLD.net_payable, OLD.voucher_id
     ) THEN
    RAISE EXCEPTION 'Approved vendor bill % cannot change', OLD.bill_no USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'cancelled' AND NEW.state <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled vendor bill % stays cancelled', OLD.bill_no USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'approved' AND NEW.state = 'cancelled' AND NEW.paid_amount <> 0 THEN
    RAISE EXCEPTION 'Vendor bill % has payments and cannot be voided', OLD.bill_no USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON vendor_bills FOR EACH ROW EXECUTE FUNCTION vendor_bill_guard();

CREATE TABLE vendor_bill_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  bill_id        uuid NOT NULL REFERENCES vendor_bills (id),
  line_no        integer NOT NULL,
  account_id     uuid NOT NULL REFERENCES accounts (id),
  department_id  uuid,
  description    text NOT NULL,
  amount         numeric(16,2) NOT NULL CHECK (amount > 0),
  vat_percent    numeric(6,2) NOT NULL DEFAULT 0 CHECK (vat_percent >= 0 AND vat_percent <= 100),
  vat_amount     numeric(16,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  UNIQUE (tenant_id, bill_id, line_no)
);
SELECT app_secure_tenant_table('vendor_bill_lines', 'SELECT, INSERT, DELETE');
-- lines change only while the bill is a draft
CREATE FUNCTION vendor_bill_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM vendor_bills WHERE id = COALESCE(NEW.bill_id, OLD.bill_id);
  IF s <> 'draft' THEN
    RAISE EXCEPTION 'Lines of a % vendor bill cannot change', s USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER guard BEFORE INSERT OR DELETE ON vendor_bill_lines FOR EACH ROW EXECUTE FUNCTION vendor_bill_line_guard();


CREATE TABLE vendor_payments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id              uuid NOT NULL,
  vendor_id               uuid NOT NULL REFERENCES vendors (id),
  payment_date            date NOT NULL,
  method                  text NOT NULL CHECK (method IN ('bank_transfer', 'cheque', 'cash', 'mobile_wallet')),
  reference               text,                       -- cheque number, transfer reference
  paid_from_account_id    uuid NOT NULL REFERENCES accounts (id),
  vendor_bank_account_id  uuid REFERENCES vendor_bank_accounts (id),
  amount                  numeric(16,2) NOT NULL CHECK (amount > 0),
  --   in_approval  the payment voucher waits for the checker
  --   paid         the voucher is posted; the bills are paid
  --   cancelled    the voucher was rejected, returned or withdrawn
  --   reversed     the posted voucher was reversed; the bills are open again
  state                   text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'paid', 'cancelled', 'reversed')),
  voucher_id              uuid REFERENCES vouchers (id),
  created_by              uuid DEFAULT app_current_user_id(),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (method <> 'bank_transfer' OR vendor_bank_account_id IS NOT NULL)
);
SELECT app_secure_tenant_table('vendor_payments', 'SELECT, INSERT, UPDATE');

CREATE TABLE vendor_payment_allocations (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  payment_id  uuid NOT NULL REFERENCES vendor_payments (id),
  bill_id     uuid NOT NULL REFERENCES vendor_bills (id),
  amount      numeric(16,2) NOT NULL CHECK (amount > 0),
  PRIMARY KEY (tenant_id, payment_id, bill_id)
);
SELECT app_secure_tenant_table('vendor_payment_allocations', 'SELECT, INSERT');


CREATE TABLE tax_challans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  tax_type              text NOT NULL CHECK (tax_type IN ('tds', 'vds')),
  period                text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- month of deduction
  challan_no            text NOT NULL,              -- treasury challan / A-challan number
  challan_date          date NOT NULL,
  paid_from_account_id  uuid NOT NULL REFERENCES accounts (id),
  amount                numeric(16,2) NOT NULL CHECK (amount > 0),
  state                 text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'deposited', 'cancelled', 'reversed')),
  voucher_id            uuid REFERENCES vouchers (id),
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tax_challans_number ON tax_challans (tenant_id, company_id, tax_type, challan_no) WHERE state NOT IN ('cancelled', 'reversed');
SELECT app_secure_tenant_table('tax_challans', 'SELECT, INSERT, UPDATE');

CREATE TABLE tax_certificates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  vendor_id    uuid NOT NULL REFERENCES vendors (id),
  tax_type     text NOT NULL CHECK (tax_type IN ('tds', 'vds')),
  number       text NOT NULL,
  period_from  date NOT NULL,
  period_to    date NOT NULL,
  amount       numeric(16,2) NOT NULL CHECK (amount > 0),
  issued_by    uuid DEFAULT app_current_user_id(),
  issued_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, number),
  CHECK (period_to >= period_from)
);
SELECT app_secure_tenant_table('tax_certificates', 'SELECT, INSERT');

CREATE TABLE tax_withholdings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  vendor_id       uuid NOT NULL REFERENCES vendors (id),
  bill_id         uuid NOT NULL REFERENCES vendor_bills (id),
  tax_type        text NOT NULL CHECK (tax_type IN ('tds', 'vds')),
  category        text NOT NULL,
  base            numeric(16,2) NOT NULL,      -- TDS: bill amount before VAT; VDS: invoice VAT
  percent         numeric(9,4) NOT NULL,
  amount          numeric(16,2) NOT NULL CHECK (amount > 0),
  deducted_on     date NOT NULL,
  period          text NOT NULL,               -- YYYY-MM of deduction (challan period)
  state           text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'void')),
  challan_id      uuid REFERENCES tax_challans (id),
  certificate_id  uuid REFERENCES tax_certificates (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, bill_id, tax_type),
  CHECK (certificate_id IS NULL OR challan_id IS NOT NULL)
);
CREATE INDEX tax_withholdings_open ON tax_withholdings (tenant_id, company_id, tax_type, period) WHERE state = 'active' AND challan_id IS NULL;
SELECT app_secure_tenant_table('tax_withholdings', 'SELECT, INSERT, UPDATE');
-- certified once; a certified withholding never leaves its challan
CREATE FUNCTION tax_withholding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.certificate_id IS NOT NULL AND (NEW.certificate_id IS DISTINCT FROM OLD.certificate_id OR NEW.challan_id IS DISTINCT FROM OLD.challan_id OR NEW.state <> OLD.state) THEN
    RAISE EXCEPTION 'A certified withholding cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.challan_id IS NOT NULL AND NEW.challan_id IS NOT NULL AND NEW.challan_id <> OLD.challan_id THEN
    RAISE EXCEPTION 'A withholding is in one challan only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.base, NEW.percent, NEW.amount, NEW.bill_id, NEW.tax_type) IS DISTINCT FROM (OLD.base, OLD.percent, OLD.amount, OLD.bill_id, OLD.tax_type) THEN
    RAISE EXCEPTION 'A withholding amount cannot change' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON tax_withholdings FOR EACH ROW EXECUTE FUNCTION tax_withholding_guard();

CREATE TABLE payables_sequences (
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  kind              text NOT NULL,             -- 'tds_certificate', 'vds_certificate'
  fiscal_year_code  text NOT NULL,
  last_no           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, company_id, kind, fiscal_year_code)
);
SELECT app_secure_tenant_table('payables_sequences', 'SELECT, INSERT, UPDATE');
