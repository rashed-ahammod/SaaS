-- =============================================================================
-- 0007  Approval workflow engine (spec §5, guide §9)
--
-- One engine for every request type (bank account change now; leave, claims,
-- payroll later). Request states:
--   in_approval -> executed            (approved; the owning module applied it)
--               -> rejected            (final, comment required)
--               -> returned            (sent back for correction)
--               -> cancelled           (by the requester, before final approval)
--
-- Approvers are resolved when a step becomes active (from current org data) and
-- written to approval_step_assignments. A "slot" is one approval the step needs:
--   mode 'any' -> all candidates share slot 1, the first to approve fills it
--   mode 'all' -> one slot per candidate
-- An SLA escalation adds the late approver's manager to the same slot.
-- =============================================================================

-- Configured chains. If a tenant has none for a request type, the built-in
-- default chain from code is used (src/modules/approvals/default-chains.ts).
CREATE TABLE approval_chains (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  request_type text NOT NULL CHECK (request_type ~ '^[a-z_]+$'),
  name         text NOT NULL,
  -- e.g. {"minAmount": "50000.00", "minDays": 4, "departmentIds": ["..."]}; {} matches everything
  conditions   jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(conditions) = 'object'),
  priority     integer NOT NULL DEFAULT 100,    -- lower number is checked first
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app_current_user_id(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON approval_chains FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('approval_chains', 'SELECT, INSERT, UPDATE');

CREATE TABLE approval_chain_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  chain_id         uuid NOT NULL,
  step_no          integer NOT NULL CHECK (step_no >= 1),
  -- who approves: line_manager | dept_head | role:<system role> | user:<user id>
  approver_rule    text NOT NULL CHECK (approver_rule ~ '^(line_manager|dept_head|role:[a-z_]+|user:[0-9a-f-]{36})$'),
  mode             text NOT NULL DEFAULT 'any' CHECK (mode IN ('any', 'all')),
  reminder_hours   integer NOT NULL DEFAULT 24 CHECK (reminder_hours > 0),
  escalation_hours integer NOT NULL DEFAULT 48 CHECK (escalation_hours > 0),
  UNIQUE (tenant_id, chain_id, step_no),
  FOREIGN KEY (tenant_id, chain_id) REFERENCES approval_chains (tenant_id, id)
);
SELECT app_secure_tenant_table('approval_chain_steps', 'SELECT, INSERT, DELETE');


CREATE TABLE approval_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  request_type       text NOT NULL,
  source_id          uuid NOT NULL,             -- the record in the owning module (e.g. bank account id)
  requester_user_id  uuid NOT NULL,
  subject_employee_id uuid,                     -- whose request it is about (routing uses their org data)
  company_id         uuid NOT NULL,
  chain_id           uuid,                      -- NULL = built-in default chain
  chain_name         text NOT NULL,
  steps              jsonb NOT NULL,            -- the chain steps, frozen at submit
  current_step       integer NOT NULL DEFAULT 1,
  state              text NOT NULL DEFAULT 'in_approval'
                     CHECK (state IN ('in_approval', 'executed', 'rejected', 'returned', 'cancelled')),
  summary            text NOT NULL,             -- one line for the inbox
  amount             numeric(18,2),
  days               numeric(6,2),
  snapshot           jsonb NOT NULL,            -- key values at submit (what is being approved)
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  approved_at        timestamptz,
  completed_at       timestamptz,
  version            integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, requester_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, subject_employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, chain_id) REFERENCES approval_chains (tenant_id, id)
);
CREATE INDEX approval_requests_requester ON approval_requests (tenant_id, requester_user_id, submitted_at DESC);
-- One open request per source record.
CREATE UNIQUE INDEX approval_requests_one_open ON approval_requests (tenant_id, request_type, source_id) WHERE state = 'in_approval';
SELECT app_secure_tenant_table('approval_requests', 'SELECT, INSERT, UPDATE');


CREATE TABLE approval_step_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  request_id       uuid NOT NULL,
  step_no          integer NOT NULL,
  slot             integer NOT NULL DEFAULT 1,
  approver_user_id uuid NOT NULL,
  reason           text NOT NULL,              -- how this approver was found, e.g. 'line_manager', 'escalation'
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'approved', 'rejected', 'returned', 'superseded', 'cancelled')),
  acted_at         timestamptz,
  remind_at        timestamptz NOT NULL,       -- SLA in working hours (see working-time.ts)
  escalate_at      timestamptz NOT NULL,
  reminded_at      timestamptz,
  escalated_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests (tenant_id, id),
  FOREIGN KEY (tenant_id, approver_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX approval_assignments_inbox ON approval_step_assignments (tenant_id, approver_user_id) WHERE status = 'pending';
CREATE INDEX approval_assignments_request ON approval_step_assignments (tenant_id, request_id, step_no);
CREATE INDEX approval_assignments_sla ON approval_step_assignments (remind_at, escalate_at) WHERE status = 'pending';
SELECT app_secure_tenant_table('approval_step_assignments', 'SELECT, INSERT, UPDATE');
-- The SLA job finds due assignments across tenants (read only; it then works per tenant as erp_app).
CREATE POLICY worker_sla_scan ON approval_step_assignments FOR SELECT TO erp_worker USING (status = 'pending');
GRANT SELECT ON approval_step_assignments TO erp_worker;


-- Every action, with who, when, from where, and the values at that moment (spec §5).
CREATE TABLE approval_actions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  request_id           uuid NOT NULL,
  step_no              integer,
  actor_user_id        uuid,                   -- NULL = system (SLA job)
  on_behalf_of_user_id uuid,                   -- set when a delegate acted
  action               text NOT NULL CHECK (action IN
                         ('submit', 'approve', 'reject', 'return', 'cancel', 'remind', 'escalate', 'execute')),
  comment              text,
  ip                   text,
  device               text,
  snapshot             jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests (tenant_id, id)
);
CREATE INDEX approval_actions_request ON approval_actions (tenant_id, request_id, created_at);
SELECT app_secure_tenant_table('approval_actions', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON approval_actions
  FOR EACH ROW EXECUTE FUNCTION app_reject_change();
