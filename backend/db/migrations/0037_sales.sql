-- =============================================================================
-- 0037  Quotations, orders, invoices and collections (Phase 3 WP25-WP27; spec §6.8 steps 4-7,
--       §5 discount chain, §9 invoice.created / invoice.overdue / payment.received)
--
--   products                 what the company sells; each on a VAT item (its rate)
--   price_lists (+ items)    unit prices per fiscal year, for all customers or one customer type
--   discount_limits          the most a salesperson may give without approval (per user,
--                            product, customer type; the most specific limit applies)
--   sales_quotations (+ lines)   versions (revision), validity; above a limit: the discount chain
--   sales_orders (+ lines)   from an accepted quotation; over the credit limit: Accounts approves
--   sales_invoices (+ lines) Mushak 6.3, numbered with the VAT invoices (one gapless series);
--                            posted at once: Dr receivables, Cr sales, Cr output VAT
--   credit_notes (+ lines)   Mushak 6.7 against an invoice
--   customer_receipts (+ allocations)   money in, allocated to invoices (partial, several),
--                            the rest on account; VAT the customer deducted (Mushak 6.6)
--   advance_applications     money on account applied to an invoice later
--   collection_reminders     one row per invoice and reminder stage: a stage is sent once
--
-- receivable_items (WP22) become the customer sub-ledger: an invoice is an item; a credit
-- note lowers it (credited); receipts and applications pay it (received).
-- =============================================================================

-- money a customer paid ahead (on account): a control account like receivables
ALTER TABLE accounts DROP CONSTRAINT accounts_role_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_role_check CHECK (role IN ('cash', 'bank', 'payables', 'receivables', 'employee_advances', 'retained_earnings', 'customer_advances'));

-- the sub-ledger: items know their customer and invoice; credit notes lower them
ALTER TABLE receivable_items ADD COLUMN customer_id uuid REFERENCES customers (id);
ALTER TABLE receivable_items ADD COLUMN sales_invoice_id uuid;
ALTER TABLE receivable_items ADD COLUMN credited numeric(16,2) NOT NULL DEFAULT 0 CHECK (credited >= 0);
ALTER TABLE receivable_items DROP CONSTRAINT receivable_items_check;
ALTER TABLE receivable_items ADD CONSTRAINT receivable_items_paid_check CHECK (received + credited <= amount);
GRANT UPDATE (received, credited, customer_id) ON receivable_items TO erp_app;
CREATE INDEX receivable_items_customer ON receivable_items (tenant_id, customer_id);

CREATE TABLE products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,30}$'),
  name         text NOT NULL,
  name_bn      text,
  kind         text NOT NULL DEFAULT 'goods' CHECK (kind IN ('goods', 'service')),
  unit         text NOT NULL,                       -- can, bottle, carton, kg, litre, pcs, month
  vat_item_id  uuid NOT NULL REFERENCES vat_items (id),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('products', 'SELECT, INSERT, UPDATE');

CREATE TABLE price_lists (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id       uuid NOT NULL,
  name             text NOT NULL,
  fiscal_year_code text NOT NULL CHECK (fiscal_year_code ~ '^[0-9]{4}-[0-9]{2}$'),
  -- for one customer type, or (null) for every customer
  customer_type    text CHECK (customer_type IN ('dealer', 'distributor', 'retail', 'corporate', 'government', 'export')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX price_lists_one ON price_lists (tenant_id, company_id, fiscal_year_code, coalesce(customer_type, '*')) WHERE is_active;
CREATE TRIGGER touch BEFORE UPDATE ON price_lists FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('price_lists', 'SELECT, INSERT, UPDATE');

CREATE TABLE price_list_items (
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  price_list_id  uuid NOT NULL REFERENCES price_lists (id),
  product_id     uuid NOT NULL REFERENCES products (id),
  unit_price     numeric(16,2) NOT NULL CHECK (unit_price >= 0),
  PRIMARY KEY (tenant_id, price_list_id, product_id)
);
SELECT app_secure_tenant_table('price_list_items', 'SELECT, INSERT, UPDATE, DELETE');

CREATE TABLE discount_limits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  user_id        uuid REFERENCES users (id),
  product_id     uuid REFERENCES products (id),
  customer_type  text CHECK (customer_type IN ('dealer', 'distributor', 'retail', 'corporate', 'government', 'export')),
  max_percent    numeric(5,2) NOT NULL CHECK (max_percent BETWEEN 0 AND 100),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX discount_limits_one ON discount_limits (tenant_id, company_id, coalesce(user_id::text, '*'), coalesce(product_id::text, '*'), coalesce(customer_type, '*'));
SELECT app_secure_tenant_table('discount_limits', 'SELECT, INSERT, UPDATE, DELETE');


CREATE TABLE sales_quotations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  number                text NOT NULL,                -- QT/2026-27/00001
  revision              integer NOT NULL DEFAULT 1,   -- a new version keeps the number
  customer_id           uuid NOT NULL REFERENCES customers (id),
  opportunity_id        uuid REFERENCES opportunities (id),
  owner_id              uuid NOT NULL REFERENCES users (id),
  quote_date            date NOT NULL,
  valid_until           date NOT NULL,
  language              text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'bn')),
  --   draft -> in_approval (a discount above the limit) -> approved -> sent -> accepted | rejected
  --   any open one -> superseded (a new revision) | cancelled; sent -> expired (past validity)
  state                 text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'approved', 'sent', 'accepted', 'rejected', 'expired', 'superseded', 'cancelled')),
  -- the largest discount on a line, against the limit that applies to it
  needs_approval        boolean NOT NULL DEFAULT false,
  approval_request_id   uuid,
  subtotal              numeric(16,2) NOT NULL DEFAULT 0,   -- before discount
  discount_total        numeric(16,2) NOT NULL DEFAULT 0,
  value                 numeric(16,2) NOT NULL DEFAULT 0,   -- after discount, before VAT
  sd_total              numeric(16,2) NOT NULL DEFAULT 0,
  vat_total             numeric(16,2) NOT NULL DEFAULT 0,
  total                 numeric(16,2) NOT NULL DEFAULT 0,
  terms                 text,
  reject_reason         text,
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number, revision),
  CHECK (valid_until >= quote_date),
  CHECK (total = value + sd_total + vat_total),
  CHECK (value = subtotal - discount_total)
);
CREATE INDEX sales_quotations_owner ON sales_quotations (tenant_id, owner_id, state);
CREATE TRIGGER touch BEFORE UPDATE ON sales_quotations FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('sales_quotations', 'SELECT, INSERT, UPDATE');

CREATE TABLE sales_quotation_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  quotation_id      uuid NOT NULL REFERENCES sales_quotations (id),
  line_no           integer NOT NULL,
  product_id        uuid NOT NULL REFERENCES products (id),
  description       text NOT NULL,
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit              text NOT NULL,
  list_price        numeric(16,2),                   -- the price list's, when there is one
  unit_price        numeric(16,2) NOT NULL CHECK (unit_price >= 0),
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  discount_limit    numeric(5,2) NOT NULL,           -- the limit that applied
  gross             numeric(16,2) NOT NULL,          -- quantity × unit price
  value             numeric(16,2) NOT NULL,          -- after discount, before VAT
  vat_item_id       uuid NOT NULL REFERENCES vat_items (id),
  rate_class        text NOT NULL,
  vat_percent       numeric(5,2) NOT NULL,
  sd_percent        numeric(5,2) NOT NULL,
  sd_amount         numeric(16,2) NOT NULL,
  vat_amount        numeric(16,2) NOT NULL,
  UNIQUE (tenant_id, quotation_id, line_no)
);
SELECT app_secure_tenant_table('sales_quotation_lines', 'SELECT, INSERT');


CREATE TABLE sales_orders (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  number                text NOT NULL,                -- SO/2026-27/00001
  customer_id           uuid NOT NULL REFERENCES customers (id),
  quotation_id          uuid REFERENCES sales_quotations (id),
  owner_id              uuid NOT NULL REFERENCES users (id),
  order_date            date NOT NULL,
  customer_ref          text,                         -- the customer's PO / work order
  --   in_approval (over the credit limit: Accounts) -> confirmed -> delivered -> invoiced
  --   in_approval | confirmed -> cancelled
  state                 text NOT NULL DEFAULT 'confirmed' CHECK (state IN ('in_approval', 'confirmed', 'delivered', 'invoiced', 'cancelled')),
  -- the credit check when placed: what the customer owed, the order, the limit
  credit_check          jsonb NOT NULL,
  approval_request_id   uuid,
  delivered_on          date,
  delivery_challan_no   text,                         -- Mushak 6.5 / delivery challan
  value                 numeric(16,2) NOT NULL,
  sd_total              numeric(16,2) NOT NULL,
  vat_total             numeric(16,2) NOT NULL,
  total                 numeric(16,2) NOT NULL,
  cancel_reason         text,
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  CHECK (total = value + sd_total + vat_total)
);
CREATE UNIQUE INDEX sales_orders_one_per_quotation ON sales_orders (tenant_id, quotation_id) WHERE quotation_id IS NOT NULL AND state <> 'cancelled';
CREATE TRIGGER touch BEFORE UPDATE ON sales_orders FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('sales_orders', 'SELECT, INSERT, UPDATE');

CREATE TABLE sales_order_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  order_id          uuid NOT NULL REFERENCES sales_orders (id),
  line_no           integer NOT NULL,
  product_id        uuid NOT NULL REFERENCES products (id),
  description       text NOT NULL,
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit              text NOT NULL,
  unit_price        numeric(16,2) NOT NULL,
  discount_percent  numeric(5,2) NOT NULL DEFAULT 0,
  value             numeric(16,2) NOT NULL,
  vat_item_id       uuid NOT NULL REFERENCES vat_items (id),
  rate_class        text NOT NULL,
  vat_percent       numeric(5,2) NOT NULL,
  sd_percent        numeric(5,2) NOT NULL,
  sd_amount         numeric(16,2) NOT NULL,
  vat_amount        numeric(16,2) NOT NULL,
  UNIQUE (tenant_id, order_id, line_no)
);
SELECT app_secure_tenant_table('sales_order_lines', 'SELECT, INSERT');


CREATE TABLE sales_invoices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  invoice_no        text NOT NULL,                    -- VI/2026-27/00001: the Mushak 6.3 series shared with vat_sales
  order_id          uuid NOT NULL REFERENCES sales_orders (id),
  customer_id       uuid NOT NULL REFERENCES customers (id),
  invoice_date      date NOT NULL,
  due_date          date NOT NULL,
  customer_name     text NOT NULL,
  customer_bin      text,
  customer_address  text,
  value             numeric(16,2) NOT NULL CHECK (value > 0),
  sd_amount         numeric(16,2) NOT NULL,
  vat_amount        numeric(16,2) NOT NULL,
  total             numeric(16,2) NOT NULL,
  voucher_id        uuid REFERENCES vouchers (id),
  created_by        uuid DEFAULT app_current_user_id(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, invoice_no),
  UNIQUE (tenant_id, order_id),
  CHECK (total = value + sd_amount + vat_amount),
  CHECK (due_date >= invoice_date)
);
SELECT app_secure_tenant_table('sales_invoices', 'SELECT, INSERT');
GRANT UPDATE (voucher_id) ON sales_invoices TO erp_app;
ALTER TABLE receivable_items ADD CONSTRAINT receivable_items_invoice FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices (id);
CREATE UNIQUE INDEX receivable_items_one_per_invoice ON receivable_items (tenant_id, sales_invoice_id) WHERE sales_invoice_id IS NOT NULL;

CREATE TABLE sales_invoice_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  invoice_id    uuid NOT NULL REFERENCES sales_invoices (id),
  line_no       integer NOT NULL,
  product_id    uuid NOT NULL REFERENCES products (id),
  description   text NOT NULL,
  quantity      numeric(14,3) NOT NULL,
  unit          text NOT NULL,
  unit_price    numeric(16,2) NOT NULL,
  discount_percent numeric(5,2) NOT NULL,
  value         numeric(16,2) NOT NULL,
  vat_item_id   uuid NOT NULL REFERENCES vat_items (id),
  rate_class    text NOT NULL,
  vat_percent   numeric(5,2) NOT NULL,
  sd_percent    numeric(5,2) NOT NULL,
  sd_amount     numeric(16,2) NOT NULL,
  vat_amount    numeric(16,2) NOT NULL,
  UNIQUE (tenant_id, invoice_id, line_no)
);
SELECT app_secure_tenant_table('sales_invoice_lines', 'SELECT, INSERT');

CREATE TABLE credit_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id    uuid NOT NULL,
  number        text NOT NULL,                        -- CN/2026-27/00001 (Mushak 6.7)
  invoice_id    uuid NOT NULL REFERENCES sales_invoices (id),
  note_date     date NOT NULL,
  reason        text NOT NULL,
  value         numeric(16,2) NOT NULL CHECK (value > 0),
  sd_amount     numeric(16,2) NOT NULL,
  vat_amount    numeric(16,2) NOT NULL,
  total         numeric(16,2) NOT NULL,
  voucher_id    uuid REFERENCES vouchers (id),
  created_by    uuid DEFAULT app_current_user_id(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, number),
  CHECK (total = value + sd_amount + vat_amount)
);
SELECT app_secure_tenant_table('credit_notes', 'SELECT, INSERT');
GRANT UPDATE (voucher_id) ON credit_notes TO erp_app;

CREATE TABLE credit_note_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  credit_note_id  uuid NOT NULL REFERENCES credit_notes (id),
  invoice_line_id uuid NOT NULL REFERENCES sales_invoice_lines (id),
  quantity        numeric(14,3) NOT NULL CHECK (quantity > 0),
  value           numeric(16,2) NOT NULL,
  rate_class      text NOT NULL,
  sd_amount       numeric(16,2) NOT NULL,
  vat_amount      numeric(16,2) NOT NULL
);
SELECT app_secure_tenant_table('credit_note_lines', 'SELECT, INSERT');


CREATE TABLE customer_receipts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id                uuid NOT NULL,
  number                    text NOT NULL,            -- CR/2026-27/00001
  customer_id               uuid NOT NULL REFERENCES customers (id),
  receipt_date              date NOT NULL,
  method                    text NOT NULL CHECK (method IN ('cash', 'cheque', 'bank_transfer', 'bkash', 'nagad', 'other')),
  received_into_account_id  uuid NOT NULL REFERENCES accounts (id),
  amount                    numeric(16,2) NOT NULL CHECK (amount >= 0),     -- money received
  -- VAT the customer deducted at source (its Mushak 6.6 certificate)
  vds_amount                numeric(16,2) NOT NULL DEFAULT 0 CHECK (vds_amount >= 0),
  vds_certificate_no        text,
  -- allocated to invoices; the rest is on account
  allocated                 numeric(16,2) NOT NULL,
  on_account                numeric(16,2) NOT NULL CHECK (on_account >= 0),
  cheque_no                 text,
  cheque_bank               text,
  reference                 text,
  --   in_approval -> posted | cancelled; posted -> reversed (a bounced cheque)
  state                     text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'posted', 'cancelled', 'reversed')),
  voucher_id                uuid REFERENCES vouchers (id),
  created_by                uuid DEFAULT app_current_user_id(),
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, number),
  CHECK (amount + vds_amount > 0),
  CHECK (allocated + on_account = amount + vds_amount),
  CHECK (vds_amount = 0 OR vds_certificate_no IS NOT NULL),
  CHECK (method <> 'cheque' OR cheque_no IS NOT NULL)
);
SELECT app_secure_tenant_table('customer_receipts', 'SELECT, INSERT');
GRANT UPDATE (state, voucher_id) ON customer_receipts TO erp_app;

CREATE TABLE customer_receipt_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  receipt_id  uuid NOT NULL REFERENCES customer_receipts (id),
  item_id     uuid NOT NULL REFERENCES receivable_items (id),
  amount      numeric(16,2) NOT NULL CHECK (amount > 0),
  UNIQUE (tenant_id, receipt_id, item_id)
);
SELECT app_secure_tenant_table('customer_receipt_allocations', 'SELECT, INSERT');

-- every receipt's allocations add up to what it allocates (checked at commit)
CREATE FUNCTION app_receipt_allocations_check() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r customer_receipts%ROWTYPE;
  s numeric;
BEGIN
  SELECT * INTO r FROM customer_receipts WHERE id = COALESCE(NEW.receipt_id, NEW.id);
  SELECT coalesce(sum(amount), 0) INTO s FROM customer_receipt_allocations WHERE receipt_id = r.id;
  IF s <> r.allocated THEN
    RAISE EXCEPTION 'receipt % allocates % but its allocations add up to %', r.number, r.allocated, s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER allocations_add_up AFTER INSERT ON customer_receipts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_receipt_allocations_check();
CREATE CONSTRAINT TRIGGER allocations_add_up AFTER INSERT ON customer_receipt_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_receipt_allocations_check();

CREATE TABLE advance_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  customer_id  uuid NOT NULL REFERENCES customers (id),
  item_id      uuid NOT NULL REFERENCES receivable_items (id),
  amount       numeric(16,2) NOT NULL CHECK (amount > 0),
  applied_on   date NOT NULL,
  voucher_id   uuid REFERENCES vouchers (id),
  created_by   uuid DEFAULT app_current_user_id(),
  created_at   timestamptz NOT NULL DEFAULT now()
);
SELECT app_secure_tenant_table('advance_applications', 'SELECT, INSERT');
GRANT UPDATE (voucher_id) ON advance_applications TO erp_app;

CREATE TABLE collection_reminders (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  item_id      uuid NOT NULL REFERENCES receivable_items (id),
  -- days past due at which this reminder goes (1, 7, 15, 30: placeholders the company can change)
  stage        integer NOT NULL,
  days_late    integer NOT NULL,
  escalated    boolean NOT NULL DEFAULT false,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, item_id, stage)
);
SELECT app_secure_tenant_table('collection_reminders', 'SELECT, INSERT');
