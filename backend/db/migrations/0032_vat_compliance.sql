-- =============================================================================
-- 0032  VAT and compliance (WP21; spec §6.6 "VAT (Mushak forms), tax at source, challan
--       and certificate tracking", spec §10 n8n "compliance calendar")
--
--   vat_items (+ vat_item_rates)   what the company buys and sells, with its VAT rate per
--                        national fiscal year (July-June): standard, reduced, truncated,
--                        zero-rated or exempt; and supplementary duty
--   vendor_bill_lines.vat_item_id  a bill line may name the item; its rate then comes
--                        from the table for the bill's fiscal year
--   vat_sales (+ lines)  the sales register (Mushak 6.2 data): each VAT invoice (Mushak 6.3
--                        number VI/2026-27/00001), its receipt voucher, VAT deducted at
--                        source by the customer (Mushak 6.6)
--   vat_returns          the monthly return (Mushak 9.1 data) as filed: the figures, the
--                        settlement journal (input VAT set off against output VAT), the VAT
--                        challan; one filed return per company and month
--   tax_challans.tax_type 'vat'   the treasury deposit of the month's net VAT
--   compliance_items     the compliance calendar: what is due when, done or not; reminders
--                        go out once per stage (7 days, 1 day, overdue) through the outbox
-- =============================================================================

CREATE TABLE vat_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[0-9A-Za-z.-]{1,20}$'),
  name_en     text NOT NULL,
  name_bn     text,
  kind        text NOT NULL CHECK (kind IN ('goods', 'service')),
  -- HS code (goods) or NBR service code (e.g. S099.10), for the registers
  nbr_code    text,
  unit        text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON vat_items FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('vat_items', 'SELECT, INSERT, UPDATE');

CREATE TABLE vat_item_rates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  item_id           uuid NOT NULL REFERENCES vat_items (id),
  fiscal_year_code  text NOT NULL CHECK (fiscal_year_code ~ '^[0-9]{4}-[0-9]{2}$'),
  rate_class        text NOT NULL CHECK (rate_class IN ('standard', 'reduced', 'truncated', 'zero', 'exempt')),
  vat_percent       numeric(6,2) NOT NULL CHECK (vat_percent >= 0 AND vat_percent <= 100),
  sd_percent        numeric(6,2) NOT NULL DEFAULT 0 CHECK (sd_percent >= 0 AND sd_percent <= 500),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, item_id, fiscal_year_code),
  CHECK (rate_class NOT IN ('zero', 'exempt') OR vat_percent = 0),
  CHECK (rate_class IN ('zero', 'exempt') OR vat_percent > 0)
);
SELECT app_secure_tenant_table('vat_item_rates', 'SELECT, INSERT, UPDATE');

ALTER TABLE vendor_bill_lines ADD COLUMN vat_item_id uuid REFERENCES vat_items (id);
ALTER TABLE vendor_bill_lines ADD COLUMN vat_rate_class text CHECK (vat_rate_class IN ('standard', 'reduced', 'truncated', 'zero', 'exempt'));


CREATE TABLE vat_sales (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id             uuid NOT NULL,
  invoice_no             text NOT NULL,              -- Mushak 6.3 number, gapless per fiscal year
  invoice_date           date NOT NULL,
  customer_name          text NOT NULL,
  customer_bin           text CHECK (customer_bin ~ '^[0-9]{9}(-?[0-9]{4})?$'),
  customer_address       text,
  received_into_account_id uuid NOT NULL REFERENCES accounts (id),
  value                  numeric(16,2) NOT NULL CHECK (value > 0),       -- before VAT and SD
  sd_amount              numeric(16,2) NOT NULL DEFAULT 0 CHECK (sd_amount >= 0),
  vat_amount             numeric(16,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
  -- VAT the customer deducted at source and deposited (its Mushak 6.6 certificate)
  vds_by_customer        numeric(16,2) NOT NULL DEFAULT 0 CHECK (vds_by_customer >= 0 AND vds_by_customer <= vat_amount),
  vds_certificate_no     text,
  received_amount        numeric(16,2) NOT NULL,
  --   in_approval  the receipt voucher waits for the checker
  --   posted       in the books: counts in the month's return
  --   cancelled    the voucher was rejected or withdrawn (the number stays visible)
  --   reversed     the voucher was reversed
  state                  text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'posted', 'cancelled', 'reversed')),
  voucher_id             uuid REFERENCES vouchers (id),
  note                   text,
  created_by             uuid DEFAULT app_current_user_id(),
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, invoice_no),
  CHECK (received_amount = value + sd_amount + vat_amount - vds_by_customer),
  CHECK ((vds_by_customer = 0) OR vds_certificate_no IS NOT NULL)
);
SELECT app_secure_tenant_table('vat_sales', 'SELECT, INSERT');
GRANT UPDATE (state, voucher_id) ON vat_sales TO erp_app;

CREATE TABLE vat_sale_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  sale_id       uuid NOT NULL REFERENCES vat_sales (id),
  line_no       integer NOT NULL,
  item_id       uuid NOT NULL REFERENCES vat_items (id),
  description   text NOT NULL,
  quantity      numeric(14,3),
  value         numeric(16,2) NOT NULL CHECK (value > 0),
  rate_class    text NOT NULL CHECK (rate_class IN ('standard', 'reduced', 'truncated', 'zero', 'exempt')),
  vat_percent   numeric(6,2) NOT NULL,
  sd_percent    numeric(6,2) NOT NULL DEFAULT 0,
  sd_amount     numeric(16,2) NOT NULL DEFAULT 0,
  vat_amount    numeric(16,2) NOT NULL DEFAULT 0,
  UNIQUE (sale_id, line_no)
);
SELECT app_secure_tenant_table('vat_sale_lines', 'SELECT, INSERT');


CREATE TABLE vat_returns (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id         uuid NOT NULL,
  period             text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  -- the Mushak 9.1 figures as filed (and the ledger tie at that moment)
  figures            jsonb NOT NULL,
  output_vat         numeric(16,2) NOT NULL,
  input_vat          numeric(16,2) NOT NULL,
  net_payable        numeric(16,2) NOT NULL,     -- to deposit by VAT challan (0 when a credit)
  carry_forward      numeric(16,2) NOT NULL,     -- credit taken to the next month
  submitted_on       date NOT NULL,
  submission_ref     text,                       -- the NBR e-return acknowledgement
  settlement_voucher_id uuid REFERENCES vouchers (id),
  challan_id         uuid,                       -- the VAT challan, once made
  filed_by           uuid DEFAULT app_current_user_id(),
  filed_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (net_payable >= 0 AND carry_forward >= 0 AND (net_payable = 0 OR carry_forward = 0))
);
CREATE UNIQUE INDEX vat_returns_once ON vat_returns (tenant_id, company_id, period);
SELECT app_secure_tenant_table('vat_returns', 'SELECT, INSERT');
GRANT UPDATE (challan_id, settlement_voucher_id) ON vat_returns TO erp_app;

ALTER TABLE tax_challans DROP CONSTRAINT tax_challans_tax_type_check;
ALTER TABLE tax_challans ADD CONSTRAINT tax_challans_tax_type_check CHECK (tax_type IN ('tds', 'vds', 'vat'));
ALTER TABLE vat_returns ADD CONSTRAINT vat_returns_challan FOREIGN KEY (challan_id) REFERENCES tax_challans (id);


CREATE TABLE compliance_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  -- a rule of the calendar (vat_return, vds_deposit ...) or 'custom'
  kind           text NOT NULL CHECK (kind ~ '^[a-z_]{3,40}$'),
  period         text NOT NULL,              -- '2026-10', '2026-27', '2026-H1' ... (custom: free)
  title          text NOT NULL,
  due_date       date NOT NULL,
  state          text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'done', 'not_applicable')),
  -- how it was closed: 'auto' (the filing / deposit was found) or a person with a note
  done_on        date,
  done_by        uuid,
  evidence       text,
  note           text,
  reminded_7     boolean NOT NULL DEFAULT false,
  reminded_1     boolean NOT NULL DEFAULT false,
  reminded_overdue boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, kind, period),
  CHECK ((state = 'open') = (done_on IS NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON compliance_items FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX compliance_items_due ON compliance_items (tenant_id, due_date) WHERE state = 'open';
SELECT app_secure_tenant_table('compliance_items', 'SELECT, INSERT, UPDATE');
