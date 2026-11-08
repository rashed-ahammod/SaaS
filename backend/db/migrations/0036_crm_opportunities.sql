-- =============================================================================
-- 0036  Opportunities, pipeline and targets (Phase 3 WP24; spec §6.8 step 3, §9 opportunity.won)
--
--   opportunity_stages           the company's open stages, in order, each with a default
--                                probability (won = 100 and lost = 0 are states, not stages)
--   opportunities                a possible sale to a customer: value, probability, expected
--                                close date, stage; won / lost with a reason
--   opportunity_stage_history    every change of stage or state, written by the database
--                                itself (trigger), append-only
--   sales_targets                the amount to win per month, for a salesperson or a department
-- =============================================================================

CREATE TABLE opportunity_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  name         text NOT NULL,
  name_bn      text,
  sort_order   integer NOT NULL,
  -- the probability an opportunity gets on entering the stage (the owner may change it)
  probability  integer NOT NULL CHECK (probability BETWEEN 0 AND 100),
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, name)
);
CREATE TRIGGER touch BEFORE UPDATE ON opportunity_stages FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('opportunity_stages', 'SELECT, INSERT, UPDATE');

CREATE TABLE opportunities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id         uuid NOT NULL,
  number             text NOT NULL,                  -- O/2026-27/00001
  title              text NOT NULL,
  customer_id        uuid NOT NULL REFERENCES customers (id),
  lead_id            uuid REFERENCES leads (id),
  owner_id           uuid NOT NULL REFERENCES users (id),
  -- the owner's department (for the department's target); set again on hand-over
  department_id      uuid,
  stage_id           uuid NOT NULL REFERENCES opportunity_stages (id),
  --   open -> won | lost   (a closed one may be opened again: the history keeps both)
  state              text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'won', 'lost')),
  value              numeric(16,2) NOT NULL CHECK (value >= 0),
  probability        integer NOT NULL CHECK (probability BETWEEN 0 AND 100),
  expected_close_on  date NOT NULL,
  closed_on          date,
  lost_reason        text CHECK (lost_reason IN ('price', 'competitor', 'no_budget', 'no_response', 'timing', 'product_fit', 'other')),
  close_note         text,
  -- why the stage or state changed this time: copied into the history by the trigger
  change_note        text,
  created_by         uuid DEFAULT app_current_user_id(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  CHECK ((state = 'open') = (closed_on IS NULL)),
  CHECK ((state = 'lost') = (lost_reason IS NOT NULL)),
  CHECK (state <> 'won' OR probability = 100),
  CHECK (state <> 'lost' OR probability = 0)
);
CREATE INDEX opportunities_owner ON opportunities (tenant_id, owner_id, state);
CREATE INDEX opportunities_customer ON opportunities (tenant_id, customer_id);
CREATE INDEX opportunities_close ON opportunities (tenant_id, company_id, state, expected_close_on);
CREATE TRIGGER touch BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('opportunities', 'SELECT, INSERT, UPDATE');

CREATE TABLE opportunity_stage_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants (id),
  opportunity_id  uuid NOT NULL REFERENCES opportunities (id),
  from_stage_id   uuid REFERENCES opportunity_stages (id),
  to_stage_id     uuid NOT NULL REFERENCES opportunity_stages (id),
  from_state      text,
  to_state        text NOT NULL,
  -- what it was worth at the moment of the change
  value           numeric(16,2) NOT NULL,
  probability     integer NOT NULL,
  note            text,
  changed_by      uuid DEFAULT app_current_user_id(),
  -- the moment itself (several changes can happen in one transaction)
  changed_at      timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX opportunity_stage_history_opp ON opportunity_stage_history (tenant_id, opportunity_id, changed_at);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON opportunity_stage_history FOR EACH ROW EXECUTE FUNCTION app_reject_change();
SELECT app_secure_tenant_table('opportunity_stage_history', 'SELECT, INSERT');

-- every new opportunity and every change of stage or state is kept, whatever the code does
CREATE FUNCTION app_opportunity_stage_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO opportunity_stage_history (tenant_id, opportunity_id, from_stage_id, to_stage_id, from_state, to_state, value, probability, note)
    VALUES (NEW.tenant_id, NEW.id, NULL, NEW.stage_id, NULL, NEW.state, NEW.value, NEW.probability, NEW.change_note);
  ELSIF NEW.stage_id IS DISTINCT FROM OLD.stage_id OR NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO opportunity_stage_history (tenant_id, opportunity_id, from_stage_id, to_stage_id, from_state, to_state, value, probability, note)
    VALUES (NEW.tenant_id, NEW.id, OLD.stage_id, NEW.stage_id, OLD.state, NEW.state, NEW.value, NEW.probability, NEW.change_note);
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER stage_history AFTER INSERT OR UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION app_opportunity_stage_history();

CREATE TABLE sales_targets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  -- the first day of the month
  month          date NOT NULL CHECK (extract(day FROM month) = 1),
  -- a salesperson's target, or a department's
  user_id        uuid REFERENCES users (id),
  department_id  uuid,
  amount         numeric(16,2) NOT NULL CHECK (amount >= 0),
  set_by         uuid DEFAULT app_current_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CHECK (num_nonnulls(user_id, department_id) = 1)
);
CREATE UNIQUE INDEX sales_targets_user ON sales_targets (tenant_id, company_id, month, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX sales_targets_department ON sales_targets (tenant_id, company_id, month, department_id) WHERE department_id IS NOT NULL;
CREATE TRIGGER touch BEFORE UPDATE ON sales_targets FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('sales_targets', 'SELECT, INSERT, UPDATE');
