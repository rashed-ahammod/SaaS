-- =============================================================================
-- 0035  Customers and leads (Phase 3 WP23; spec §6.8 steps 1-2, §4 "Sales user")
--
--   user_roles.system_role 'sales'   the Sales user: works their own leads and customers
--   sales_territories (+ members)    districts -> the salespeople who take their leads
--   crm_assignment_cursors           round robin: who got the last lead (per territory /
--                                    the whole company)
--   customers (+ customer_contacts)  the customer master: company or person, BIN / TIN,
--                                    district, payment terms and credit limit (Accounts),
--                                    account manager
--   leads                            enquiries from the web form, Facebook lead ads,
--                                    referrals, calls, walk-ins; owner always set
--   crm_contact_keys                 every phone number and e-mail of a lead, customer or
--                                    contact, once per company: a lead can never duplicate
--                                    an existing phone or e-mail (the database refuses it)
--   crm_activities                   calls, meetings, notes, tasks, messages on a lead or
--                                    customer
-- =============================================================================

ALTER TABLE user_roles DROP CONSTRAINT user_roles_system_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_system_role_check
  CHECK (system_role IN ('admin', 'system_admin', 'hr', 'accounts', 'dept_head', 'employee', 'auditor', 'sales'));

CREATE TABLE sales_territories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name        text NOT NULL,
  -- Bangladesh districts (as in the address), e.g. {Dhaka, Gazipur, Narayanganj}
  districts   text[] NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON sales_territories FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('sales_territories', 'SELECT, INSERT, UPDATE');

CREATE TABLE sales_territory_members (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  territory_id  uuid NOT NULL REFERENCES sales_territories (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  PRIMARY KEY (tenant_id, territory_id, user_id)
);
SELECT app_secure_tenant_table('sales_territory_members', 'SELECT, INSERT, DELETE');

CREATE TABLE crm_assignment_cursors (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id    uuid NOT NULL,
  -- a territory id, or 'company' for the company-wide pool
  pool          text NOT NULL,
  last_user_id  uuid NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, company_id, pool)
);
SELECT app_secure_tenant_table('crm_assignment_cursors', 'SELECT, INSERT, UPDATE');


CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  code                text NOT NULL,                 -- C-00001
  kind                text NOT NULL CHECK (kind IN ('company', 'person')),
  name                text NOT NULL,
  name_bn             text,
  customer_type       text NOT NULL DEFAULT 'retail' CHECK (customer_type IN ('dealer', 'distributor', 'retail', 'corporate', 'government', 'export')),
  bin                 text CHECK (bin ~ '^[0-9]{9}-[0-9]{4}$'),
  tin                 text CHECK (tin ~ '^[0-9]{12}$'),
  phone               text CHECK (phone ~ '^\+880[0-9]{8,10}$'),
  email               text CHECK (email = lower(email)),
  address             text,
  district            text,
  territory_id        uuid REFERENCES sales_territories (id),
  account_manager_id  uuid REFERENCES users (id),
  -- set by Accounts
  payment_terms_days  integer NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 365),
  credit_limit        numeric(16,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  from_lead_id        uuid,
  is_active           boolean NOT NULL DEFAULT true,
  created_by          uuid DEFAULT app_current_user_id(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX customers_manager ON customers (tenant_id, account_manager_id);
SELECT app_secure_tenant_table('customers', 'SELECT, INSERT, UPDATE');

CREATE TABLE customer_contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  customer_id  uuid NOT NULL REFERENCES customers (id),
  name         text NOT NULL,
  designation  text,
  phone        text CHECK (phone ~ '^\+880[0-9]{8,10}$'),
  email        text CHECK (email = lower(email)),
  is_primary   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_primary_contact ON customer_contacts (tenant_id, customer_id) WHERE is_primary AND is_active;
SELECT app_secure_tenant_table('customer_contacts', 'SELECT, INSERT, UPDATE');


CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id         uuid NOT NULL,
  number             text NOT NULL,                  -- L/2026-27/00001
  name               text NOT NULL,                  -- the person who enquired
  organisation       text,
  phone              text CHECK (phone ~ '^\+880[0-9]{8,10}$'),
  email              text CHECK (email = lower(email)),
  district           text,
  source             text NOT NULL CHECK (source IN ('web_form', 'facebook', 'referral', 'call', 'walk_in', 'manual', 'other')),
  source_detail      text,                           -- campaign, referrer, form name
  -- what they wrote: outside content, shown as text only, never acted on
  message            text,
  -- the source's own id (Facebook leadgen id, form submission id): one lead per external ref
  external_ref       text,
  owner_id           uuid NOT NULL REFERENCES users (id),
  territory_id       uuid REFERENCES sales_territories (id),
  --   new -> contacted -> qualified (a customer, later an opportunity) | disqualified
  state              text NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'contacted', 'qualified', 'disqualified')),
  disqualify_reason  text,
  customer_id        uuid REFERENCES customers (id),
  created_by         uuid DEFAULT app_current_user_id(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CHECK ((state = 'qualified') = (customer_id IS NOT NULL)),
  CHECK ((state = 'disqualified') = (disqualify_reason IS NOT NULL))
);
CREATE UNIQUE INDEX leads_external_ref ON leads (tenant_id, company_id, source, external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX leads_owner ON leads (tenant_id, owner_id, state);
CREATE TRIGGER touch BEFORE UPDATE ON leads FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('leads', 'SELECT, INSERT, UPDATE');
ALTER TABLE customers ADD CONSTRAINT customers_from_lead FOREIGN KEY (from_lead_id) REFERENCES leads (id);

-- one phone / e-mail, one record: the guard against duplicate leads
CREATE TABLE crm_contact_keys (
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('phone', 'email')),
  value        text NOT NULL,
  lead_id      uuid REFERENCES leads (id),
  customer_id  uuid REFERENCES customers (id),
  contact_id   uuid REFERENCES customer_contacts (id),
  PRIMARY KEY (tenant_id, company_id, kind, value),
  -- a lead's key moves to its customer when the lead is qualified
  CHECK (num_nonnulls(lead_id, customer_id) = 1),
  CHECK (contact_id IS NULL OR customer_id IS NOT NULL)
);
SELECT app_secure_tenant_table('crm_contact_keys', 'SELECT, INSERT, UPDATE, DELETE');


CREATE TABLE crm_activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id    uuid NOT NULL,
  lead_id       uuid REFERENCES leads (id),
  customer_id   uuid REFERENCES customers (id),
  kind          text NOT NULL CHECK (kind IN ('call', 'meeting', 'note', 'task', 'email', 'sms', 'enquiry', 'system')),
  subject       text NOT NULL,
  body          text,
  -- tasks: when, and when done
  due_at        timestamptz,
  done_at       timestamptz,
  owner_id      uuid REFERENCES users (id),
  created_by    uuid DEFAULT app_current_user_id(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (lead_id IS NOT NULL OR customer_id IS NOT NULL),
  CHECK (kind = 'task' OR (due_at IS NULL AND done_at IS NULL))
);
CREATE INDEX crm_activities_lead ON crm_activities (tenant_id, lead_id, created_at);
CREATE INDEX crm_activities_customer ON crm_activities (tenant_id, customer_id, created_at);
CREATE INDEX crm_activities_open_tasks ON crm_activities (tenant_id, owner_id, due_at) WHERE kind = 'task' AND done_at IS NULL;
SELECT app_secure_tenant_table('crm_activities', 'SELECT, INSERT');
GRANT UPDATE (done_at) ON crm_activities TO erp_app;
