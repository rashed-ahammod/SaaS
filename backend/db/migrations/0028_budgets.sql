-- =============================================================================
-- 0028  Budgets (WP18; spec §6.6 "annual budget per department and account. Purchase-
--       order approval commits the amount; vendor bill makes it actual. Warning at 80%,
--       escalation to Admin at 100%", §5 "over budget -> Admin")
--
--   budget_settings        per company: the warning percent (80) and whether spending in a
--                          department without a budget needs the Admin
--   budgets / budget_lines one budget per company, fiscal year and department; an amount
--                          per account. Accounts prepares, the Admin approves.
--   budget_revisions (+ lines)  a change to an approved budget (Accounts, or the Dept Head
--                          for their department), approved by the Admin
--   budget_alerts          each 80 % / 100 % crossing, raised once
--   purchase_orders        + in_approval: an order that takes a budget line over 100 % waits
--                          for the Admin before it is issued
--   purchase_requisitions  + the budget position at submission
--
-- Actuals are read from posted vouchers (account x cost centre); commitments from issued
-- purchase orders minus what approved bills of them already made actual.
-- =============================================================================

CREATE TABLE budget_settings (
  tenant_id              uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id             uuid NOT NULL,
  warning_percent        numeric(5,2) NOT NULL DEFAULT 80 CHECK (warning_percent > 0 AND warning_percent < 100),
  no_budget_needs_admin  boolean NOT NULL DEFAULT true,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id)
);
SELECT app_secure_tenant_table('budget_settings', 'SELECT, INSERT, UPDATE');

CREATE TABLE budgets (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  fiscal_year_code     text NOT NULL CHECK (fiscal_year_code ~ '^[0-9]{4}-[0-9]{2}$'),
  department_id        uuid NOT NULL REFERENCES departments (id),
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'approved', 'cancelled')),
  total                numeric(16,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  note                 text,
  approval_request_id  uuid,
  approved_at          timestamptz,
  cancel_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid DEFAULT app_current_user_id(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1
);
-- one live budget per department and year
CREATE UNIQUE INDEX budgets_one_per_department ON budgets (tenant_id, company_id, fiscal_year_code, department_id) WHERE state <> 'cancelled';
CREATE TRIGGER touch BEFORE UPDATE ON budgets FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('budgets', 'SELECT, INSERT, UPDATE');

CREATE TABLE budget_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  budget_id   uuid NOT NULL REFERENCES budgets (id),
  account_id  uuid NOT NULL REFERENCES accounts (id),
  amount      numeric(16,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (budget_id, account_id)
);
SELECT app_secure_tenant_table('budget_lines', 'SELECT, INSERT, UPDATE, DELETE');

-- an approved budget changes only through an approved revision (the service sets the flag)
CREATE FUNCTION budget_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  SELECT state INTO s FROM budgets WHERE id = COALESCE(NEW.budget_id, OLD.budget_id);
  IF s IN ('approved', 'in_approval', 'cancelled') AND current_setting('app.budget_revision', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'the lines of a % budget change only through an approved revision', s USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER guard BEFORE INSERT OR UPDATE OR DELETE ON budget_lines FOR EACH ROW EXECUTE FUNCTION budget_line_guard();

CREATE TABLE budget_revisions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  budget_id            uuid NOT NULL REFERENCES budgets (id),
  reason               text NOT NULL,
  state                text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'approved', 'rejected', 'cancelled')),
  approval_request_id  uuid,
  decided_at           timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid DEFAULT app_current_user_id()
);
-- one open revision per budget at a time
CREATE UNIQUE INDEX budget_revisions_one_open ON budget_revisions (tenant_id, budget_id) WHERE state = 'in_approval';
SELECT app_secure_tenant_table('budget_revisions', 'SELECT, INSERT, UPDATE');

CREATE TABLE budget_revision_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  revision_id  uuid NOT NULL REFERENCES budget_revisions (id),
  account_id   uuid NOT NULL REFERENCES accounts (id),
  old_amount   numeric(16,2) NOT NULL CHECK (old_amount >= 0),
  new_amount   numeric(16,2) NOT NULL CHECK (new_amount >= 0),
  UNIQUE (revision_id, account_id)
);
SELECT app_secure_tenant_table('budget_revision_lines', 'SELECT, INSERT');

CREATE TABLE budget_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  budget_id   uuid NOT NULL REFERENCES budgets (id),
  account_id  uuid REFERENCES accounts (id),       -- null: the department's whole budget
  level       integer NOT NULL CHECK (level IN (80, 100)),
  percent     numeric(7,2) NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budget_alerts_once ON budget_alerts (tenant_id, budget_id, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid), level);
SELECT app_secure_tenant_table('budget_alerts', 'SELECT, INSERT');

-- an order over budget waits for the Admin
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_state_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_state_check CHECK (state IN ('draft', 'in_approval', 'issued', 'partially_received', 'received', 'cancelled')),
  ADD COLUMN approval_request_id uuid,
  ADD COLUMN budget_snapshot jsonb;

ALTER TABLE purchase_requisitions
  ADD COLUMN budget_status text CHECK (budget_status IN ('within', 'warning', 'over', 'no_budget', 'not_used')),
  ADD COLUMN budget_snapshot jsonb;
