-- =============================================================================
-- 0029  Assets and stock (WP19; spec §6.7 "Assets: register with tag/QR code, assignment
--       to an employee with digital acknowledgement, depreciation method per asset class,
--       maintenance log, disposal. Consumables: stock ledger per store with issue requests
--       from departments.")
--
--   asset_classes        accounts (cost, accumulated depreciation, expense) and the method:
--                        straight line over months, or reducing balance at a yearly rate
--   assets               the register: tag (AST-00001), cost, in-service date, residual value,
--                        department (cost centre), state; opening accumulated depreciation
--                        for assets brought from the old books
--   asset_assignments    to an employee; acknowledged in the app; returned (an open one
--                        blocks the employee's final settlement)
--   asset_maintenance    service / repair / inspection log
--   depreciation_runs (+ lines)   one posted run per company and month (a journal)
--   stores, stock_items  consumables by quantity
--   stock_moves          the stock ledger (append-only); stock_balances follows it by
--                        trigger and can never go below zero
--   stock_issue_requests (+ lines)   a department asks; the Dept Head approves; the store issues
-- =============================================================================

CREATE TABLE asset_classes (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id              uuid NOT NULL,
  code                    text NOT NULL,
  name                    text NOT NULL,
  asset_account_id        uuid NOT NULL REFERENCES accounts (id),
  accumulated_account_id  uuid NOT NULL REFERENCES accounts (id),
  expense_account_id      uuid NOT NULL REFERENCES accounts (id),
  method                  text NOT NULL CHECK (method IN ('straight_line', 'reducing_balance')),
  useful_life_months      integer CHECK (useful_life_months BETWEEN 1 AND 600),
  annual_rate_percent     numeric(5,2) CHECK (annual_rate_percent > 0 AND annual_rate_percent <= 100),
  residual_percent        numeric(5,2) NOT NULL DEFAULT 0 CHECK (residual_percent >= 0 AND residual_percent < 100),
  is_active               boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code),
  CHECK ((method = 'straight_line') = (useful_life_months IS NOT NULL)),
  CHECK ((method = 'reducing_balance') = (annual_rate_percent IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON asset_classes FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('asset_classes', 'SELECT, INSERT, UPDATE');

CREATE TABLE assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  class_id              uuid NOT NULL REFERENCES asset_classes (id),
  tag                   text NOT NULL,
  name                  text NOT NULL,
  serial_no             text,
  in_service_date       date NOT NULL,
  cost                  numeric(16,2) NOT NULL CHECK (cost > 0),
  residual_value        numeric(16,2) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  opening_accumulated   numeric(16,2) NOT NULL DEFAULT 0 CHECK (opening_accumulated >= 0),
  opening_as_of         date,                  -- last day the opening depreciation covers
  department_id         uuid REFERENCES departments (id),
  branch_id             uuid,
  location              text,
  vendor_bill_id        uuid REFERENCES vendor_bills (id),
  state                 text NOT NULL DEFAULT 'in_store' CHECK (state IN ('in_store', 'assigned', 'disposed')),
  disposed_on           date,
  disposal_method       text CHECK (disposal_method IN ('sale', 'scrap', 'write_off')),
  disposal_proceeds     numeric(16,2),
  disposal_voucher_id   uuid,
  disposal_note         text,
  note                  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid DEFAULT app_current_user_id(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, tag),
  CHECK (residual_value <= cost),
  CHECK (opening_accumulated <= cost - residual_value),
  CHECK ((opening_accumulated = 0) OR (opening_as_of IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON assets FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('assets', 'SELECT, INSERT, UPDATE');

CREATE TABLE asset_assignments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  asset_id           uuid NOT NULL REFERENCES assets (id),
  employee_id        uuid NOT NULL,
  assigned_on        date NOT NULL,
  expected_return    date,
  note               text,
  acknowledged_at    timestamptz,
  acknowledged_ip    text,
  returned_on        date,
  return_condition   text CHECK (return_condition IN ('good', 'damaged', 'lost')),
  return_note        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT app_current_user_id(),
  returned_by        uuid,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id),
  CHECK (returned_on IS NULL OR returned_on >= assigned_on)
);
-- one open assignment per asset
CREATE UNIQUE INDEX asset_assignments_open ON asset_assignments (tenant_id, asset_id) WHERE returned_on IS NULL;
CREATE INDEX asset_assignments_employee ON asset_assignments (tenant_id, employee_id) WHERE returned_on IS NULL;
SELECT app_secure_tenant_table('asset_assignments', 'SELECT, INSERT, UPDATE');

CREATE TABLE asset_maintenance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  asset_id     uuid NOT NULL REFERENCES assets (id),
  done_on      date NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('service', 'repair', 'inspection')),
  description  text NOT NULL,
  vendor_id    uuid REFERENCES vendors (id),
  cost         numeric(16,2) NOT NULL DEFAULT 0 CHECK (cost >= 0),
  next_due     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app_current_user_id()
);
SELECT app_secure_tenant_table('asset_maintenance', 'SELECT, INSERT');

CREATE TABLE depreciation_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  period       text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  state        text NOT NULL DEFAULT 'posted' CHECK (state IN ('posted', 'reversed')),
  total        numeric(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  voucher_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app_current_user_id()
);
CREATE UNIQUE INDEX depreciation_runs_one_per_month ON depreciation_runs (tenant_id, company_id, period) WHERE state = 'posted';
SELECT app_secure_tenant_table('depreciation_runs', 'SELECT, INSERT, UPDATE');

CREATE TABLE depreciation_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  run_id              uuid NOT NULL REFERENCES depreciation_runs (id),
  asset_id            uuid NOT NULL REFERENCES assets (id),
  amount              numeric(16,2) NOT NULL CHECK (amount > 0),
  accumulated_after   numeric(16,2) NOT NULL,
  book_value_after    numeric(16,2) NOT NULL,
  UNIQUE (run_id, asset_id)
);
SELECT app_secure_tenant_table('depreciation_lines', 'SELECT, INSERT');

-- ---------------------------------------------------------------- stock

CREATE TABLE stores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  code                text NOT NULL,
  name                text NOT NULL,
  branch_id           uuid,
  keeper_employee_id  uuid,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, code)
);
SELECT app_secure_tenant_table('stores', 'SELECT, INSERT, UPDATE');

CREATE TABLE stock_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  code           text NOT NULL,
  name           text NOT NULL,
  name_bn        text,
  unit           text NOT NULL,
  reorder_level  numeric(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, company_id, code)
);
SELECT app_secure_tenant_table('stock_items', 'SELECT, INSERT, UPDATE');

CREATE TABLE stock_issue_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  number               text NOT NULL,
  store_id             uuid NOT NULL REFERENCES stores (id),
  requester_id         uuid NOT NULL,
  department_id        uuid,
  note                 text,
  state                text NOT NULL DEFAULT 'in_approval'
                         CHECK (state IN ('in_approval', 'approved', 'partially_issued', 'issued', 'rejected', 'cancelled')),
  approval_request_id  uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid DEFAULT app_current_user_id(),
  UNIQUE (tenant_id, company_id, number),
  FOREIGN KEY (tenant_id, requester_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('stock_issue_requests', 'SELECT, INSERT, UPDATE');

CREATE TABLE stock_issue_request_lines (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  request_id          uuid NOT NULL REFERENCES stock_issue_requests (id),
  item_id             uuid NOT NULL REFERENCES stock_items (id),
  quantity_requested  numeric(14,3) NOT NULL CHECK (quantity_requested > 0),
  quantity_issued     numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0),
  UNIQUE (request_id, item_id),
  CHECK (quantity_issued <= quantity_requested)
);
SELECT app_secure_tenant_table('stock_issue_request_lines', 'SELECT, INSERT, UPDATE');

CREATE TABLE stock_moves (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  store_id          uuid NOT NULL REFERENCES stores (id),
  item_id           uuid NOT NULL REFERENCES stock_items (id),
  move_date         date NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('opening', 'receipt', 'issue', 'adjustment')),
  quantity          numeric(14,3) NOT NULL CHECK (quantity <> 0),   -- in: positive, out: negative
  reference         text,
  issue_request_id  uuid REFERENCES stock_issue_requests (id),
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid DEFAULT app_current_user_id(),
  CHECK ((kind IN ('opening', 'receipt') AND quantity > 0) OR (kind = 'issue' AND quantity < 0) OR kind = 'adjustment')
);
CREATE INDEX stock_moves_item ON stock_moves (tenant_id, store_id, item_id, move_date);
-- the ledger is append-only: no UPDATE / DELETE grant
SELECT app_secure_tenant_table('stock_moves', 'SELECT, INSERT');

-- the balance follows the ledger and can never go below zero
CREATE TABLE stock_balances (
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  store_id   uuid NOT NULL REFERENCES stores (id),
  item_id    uuid NOT NULL REFERENCES stock_items (id),
  quantity   numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (tenant_id, store_id, item_id)
);
SELECT app_secure_tenant_table('stock_balances', 'SELECT');

CREATE FUNCTION stock_move_balance() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO stock_balances (tenant_id, store_id, item_id, quantity)
  VALUES (NEW.tenant_id, NEW.store_id, NEW.item_id, NEW.quantity)
  ON CONFLICT (tenant_id, store_id, item_id) DO UPDATE SET quantity = stock_balances.quantity + EXCLUDED.quantity;
  RETURN NEW;
EXCEPTION WHEN check_violation THEN
  RAISE EXCEPTION 'stock of item % in store % would go below zero', NEW.item_id, NEW.store_id USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER balance AFTER INSERT ON stock_moves FOR EACH ROW EXECUTE FUNCTION stock_move_balance();
