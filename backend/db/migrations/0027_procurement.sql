-- =============================================================================
-- 0027  Procurement (WP17; spec §6.7 steps 1-4, §5 "Purchase requisition")
--
--   procurement_settings        per company: quotation threshold and minimum count, the
--                               Admin approval threshold, the three-way match tolerance
--                               (placeholders until the customer sets them)
--   purchase_requisitions (+ lines)   any employee asks; Dept Head -> Accounts (budget
--                               check) -> Admin above the threshold; then quotations and,
--                               above the quotation threshold, a comparative statement the
--                               Admin approves
--   quotations (+ lines)        vendors' prices for the requisition lines
--   purchase_orders (+ lines)   from the chosen quotation; issued to the vendor
--   goods_receipts (+ lines)    goods / service received notes against a PO
--   vendor_bills / lines        + the PO and PO line they bill, and the three-way match
--                               result; a mismatched bill cannot be paid (trigger)
-- Numbers PR/2026-27/00001, PO/..., GRN/... come from payables_sequences.
-- =============================================================================

CREATE TABLE procurement_settings (
  tenant_id                 uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id                uuid NOT NULL,
  quotation_threshold       numeric(16,2) NOT NULL DEFAULT 50000 CHECK (quotation_threshold >= 0),
  min_quotations            integer NOT NULL DEFAULT 3 CHECK (min_quotations BETWEEN 1 AND 10),
  admin_threshold           numeric(16,2) NOT NULL DEFAULT 500000 CHECK (admin_threshold >= 0),
  match_tolerance_percent   numeric(5,2) NOT NULL DEFAULT 2 CHECK (match_tolerance_percent BETWEEN 0 AND 20),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id)
);
SELECT app_secure_tenant_table('procurement_settings', 'SELECT, INSERT, UPDATE');

CREATE TABLE purchase_requisitions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id             uuid NOT NULL,
  number                 text NOT NULL,
  requester_id           uuid NOT NULL,                  -- employee
  department_id          uuid,                           -- the requester's department (cost centre)
  title                  text NOT NULL,
  justification          text NOT NULL,
  needed_by              date,
  estimated_total        numeric(16,2) NOT NULL DEFAULT 0 CHECK (estimated_total >= 0),
  state                  text NOT NULL DEFAULT 'draft'
                           CHECK (state IN ('draft', 'in_approval', 'approved', 'ordered', 'rejected', 'cancelled')),
  approval_request_id    uuid,
  -- comparative statement: the chosen quotation, approved by the Admin above the quotation threshold
  selected_quotation_id  uuid,
  selection_reason       text,
  cs_state               text NOT NULL DEFAULT 'none' CHECK (cs_state IN ('none', 'in_approval', 'approved')),
  cs_approval_request_id uuid,
  cancel_reason          text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid DEFAULT app_current_user_id(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  version                integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  FOREIGN KEY (tenant_id, requester_id) REFERENCES employees (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON purchase_requisitions FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('purchase_requisitions', 'SELECT, INSERT, UPDATE');

CREATE TABLE purchase_requisition_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  requisition_id        uuid NOT NULL REFERENCES purchase_requisitions (id),
  line_no               integer NOT NULL,
  description           text NOT NULL,
  quantity              numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit                  text NOT NULL,
  estimated_unit_price  numeric(16,2) NOT NULL CHECK (estimated_unit_price >= 0),
  UNIQUE (requisition_id, line_no)
);
SELECT app_secure_tenant_table('purchase_requisition_lines', 'SELECT, INSERT, DELETE');

CREATE TABLE quotations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  requisition_id   uuid NOT NULL REFERENCES purchase_requisitions (id),
  vendor_id        uuid NOT NULL REFERENCES vendors (id),
  reference        text NOT NULL,                   -- the vendor's quotation number
  quotation_date   date NOT NULL,
  valid_until      date,
  delivery_days    integer CHECK (delivery_days >= 0),
  note             text,
  base_total       numeric(16,2) NOT NULL CHECK (base_total >= 0),     -- before VAT
  vat_total        numeric(16,2) NOT NULL CHECK (vat_total >= 0),
  state            text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'withdrawn')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id()
);
-- one live quotation per vendor per requisition
CREATE UNIQUE INDEX quotations_one_per_vendor ON quotations (tenant_id, requisition_id, vendor_id) WHERE state = 'active';
SELECT app_secure_tenant_table('quotations', 'SELECT, INSERT, UPDATE');

CREATE TABLE quotation_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  quotation_id         uuid NOT NULL REFERENCES quotations (id),
  requisition_line_id  uuid NOT NULL REFERENCES purchase_requisition_lines (id),
  unit_price           numeric(16,2) NOT NULL CHECK (unit_price >= 0),
  vat_percent          numeric(5,2) NOT NULL DEFAULT 0 CHECK (vat_percent BETWEEN 0 AND 100),
  UNIQUE (quotation_id, requisition_line_id)
);
SELECT app_secure_tenant_table('quotation_lines', 'SELECT, INSERT');

CREATE TABLE purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  number            text NOT NULL,
  requisition_id    uuid NOT NULL REFERENCES purchase_requisitions (id),
  quotation_id      uuid NOT NULL REFERENCES quotations (id),
  vendor_id         uuid NOT NULL REFERENCES vendors (id),
  department_id     uuid,
  order_date        date NOT NULL,
  delivery_date     date,
  deliver_to        text,
  terms             text,
  base_total        numeric(16,2) NOT NULL CHECK (base_total >= 0),
  vat_total         numeric(16,2) NOT NULL CHECK (vat_total >= 0),
  state             text NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft', 'issued', 'partially_received', 'received', 'cancelled')),
  issued_at         timestamptz,
  cancel_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid DEFAULT app_current_user_id(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number)
);
-- one live order per requisition
CREATE UNIQUE INDEX purchase_orders_one_per_requisition ON purchase_orders (tenant_id, requisition_id) WHERE state <> 'cancelled';
CREATE TRIGGER touch BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('purchase_orders', 'SELECT, INSERT, UPDATE');

CREATE TABLE purchase_order_lines (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  purchase_order_id    uuid NOT NULL REFERENCES purchase_orders (id),
  requisition_line_id  uuid NOT NULL REFERENCES purchase_requisition_lines (id),
  line_no              integer NOT NULL,
  description          text NOT NULL,
  quantity             numeric(14,3) NOT NULL CHECK (quantity > 0),
  unit                 text NOT NULL,
  unit_price           numeric(16,2) NOT NULL CHECK (unit_price >= 0),
  vat_percent          numeric(5,2) NOT NULL DEFAULT 0,
  account_id           uuid NOT NULL REFERENCES accounts (id),   -- where the bill line posts
  UNIQUE (purchase_order_id, line_no)
);
SELECT app_secure_tenant_table('purchase_order_lines', 'SELECT, INSERT');

CREATE TABLE goods_receipts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id         uuid NOT NULL,
  number             text NOT NULL,
  purchase_order_id  uuid NOT NULL REFERENCES purchase_orders (id),
  received_date      date NOT NULL,
  note               text,
  state              text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'cancelled')),
  cancel_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid DEFAULT app_current_user_id(),
  UNIQUE (tenant_id, company_id, number)
);
SELECT app_secure_tenant_table('goods_receipts', 'SELECT, INSERT, UPDATE');

CREATE TABLE goods_receipt_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  receipt_id       uuid NOT NULL REFERENCES goods_receipts (id),
  po_line_id       uuid NOT NULL REFERENCES purchase_order_lines (id),
  quantity         numeric(14,3) NOT NULL CHECK (quantity > 0),
  UNIQUE (receipt_id, po_line_id)
);
SELECT app_secure_tenant_table('goods_receipt_lines', 'SELECT, INSERT');

-- vendor bills against a purchase order, and the three-way match
ALTER TABLE vendor_bills
  ADD COLUMN purchase_order_id uuid REFERENCES purchase_orders (id),
  ADD COLUMN match_status text NOT NULL DEFAULT 'not_required'
    CHECK (match_status IN ('not_required', 'matched', 'mismatch', 'overridden')),
  ADD COLUMN match_details jsonb,
  ADD COLUMN match_override_reason text,
  ADD COLUMN match_overridden_by uuid;
ALTER TABLE vendor_bill_lines
  ADD COLUMN po_line_id uuid REFERENCES purchase_order_lines (id),
  ADD COLUMN quantity numeric(14,3) CHECK (quantity > 0),
  ADD CONSTRAINT po_line_has_quantity CHECK ((po_line_id IS NULL) = (quantity IS NULL));

-- a bill against a purchase order is paid only when matched (or the variance accepted)
CREATE FUNCTION vendor_payment_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE status text;
BEGIN
  SELECT match_status INTO status FROM vendor_bills WHERE id = NEW.bill_id;
  IF status = 'mismatch' THEN
    RAISE EXCEPTION 'bill % is not matched with its purchase order and goods received', NEW.bill_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER match_guard BEFORE INSERT ON vendor_payment_allocations FOR EACH ROW EXECUTE FUNCTION vendor_payment_match_guard();

-- an approved bill keeps its purchase order (the match result may still change)
CREATE OR REPLACE FUNCTION vendor_bill_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'approved' AND (
       NEW.vendor_id, NEW.bill_no, NEW.bill_date, NEW.due_date, NEW.base_amount, NEW.vat_amount, NEW.tds_amount,
       NEW.vds_amount, NEW.input_vat, NEW.vat_in_cost, NEW.net_payable, NEW.voucher_id, NEW.purchase_order_id
     ) IS DISTINCT FROM (
       OLD.vendor_id, OLD.bill_no, OLD.bill_date, OLD.due_date, OLD.base_amount, OLD.vat_amount, OLD.tds_amount,
       OLD.vds_amount, OLD.input_vat, OLD.vat_in_cost, OLD.net_payable, OLD.voucher_id, OLD.purchase_order_id
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
