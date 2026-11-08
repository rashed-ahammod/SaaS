-- =============================================================================
-- 0005  Employees (spec §6.1, guide §7.3)
--
-- Job history works in two layers (docs/adr/0004):
--   employee_job_events   what was decided: "transfer to Sales from 1 March",
--                         recorded once, never edited (only cancelled with a reason)
--   employee_assignments  the resulting timeline, one row per period, rebuilt
--                         from the events whenever one is added or cancelled.
--                         Periods can never overlap (exclusion constraint).
-- =============================================================================

CREATE TABLE employees (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id              uuid NOT NULL,                   -- employing legal entity
  employee_code           text NOT NULL,                   -- e.g. DTL-00012, unique per company
  full_name_en            text NOT NULL,
  full_name_bn            text,
  date_of_birth           date,
  gender                  text CHECK (gender IN ('male', 'female', 'other')),
  nid_encrypted           text,                            -- field-encrypted (never stored in clear)
  tin_encrypted           text,                            -- field-encrypted
  personal_email          text CHECK (personal_email = lower(personal_email)),
  phone                   text CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  present_address         text,
  permanent_address       text,
  emergency_contact_name  text,
  emergency_contact_phone text CHECK (emergency_contact_phone ~ '^\+?[0-9]{8,15}$'),
  join_date               date NOT NULL,
  probation_end_date      date,
  status                  text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'probation', 'active', 'notice', 'separated')),
  -- which festival bonus calendar applies (spec §6.4), e.g. 'eid', 'puja'
  festival_group          text CHECK (festival_group ~ '^[a-z_]{1,30}$'),
  activated_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid DEFAULT app_current_user_id(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  version                 integer NOT NULL DEFAULT 1,
  CHECK (probation_end_date IS NULL OR probation_end_date >= join_date),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, employee_code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE INDEX employees_name_en ON employees (tenant_id, lower(full_name_en));
CREATE TRIGGER touch BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION app_touch_row();
-- No DELETE: employees are separated, never removed (history and payroll depend on them).
SELECT app_secure_tenant_table('employees', 'SELECT, INSERT, UPDATE');


CREATE TABLE employee_job_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq              bigint GENERATED ALWAYS AS IDENTITY,   -- order of recording (same-day events)
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id      uuid NOT NULL,
  effective_from   date NOT NULL,
  event_type       text NOT NULL CHECK (event_type IN
                     ('joining', 'transfer', 'promotion', 'redesignation', 'grade_change', 'manager_change')),
  -- only the fields this event changes, e.g. {"department_id": "...", "branch_id": "..."}
  -- a null value clears the field (e.g. remove functional manager)
  changes          jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'object' AND changes <> '{}'::jsonb),
  reason           text,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  cancelled_reason text,
  cancelled_at     timestamptz,
  cancelled_by     uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id(),
  CHECK (status = 'active' OR (cancelled_reason IS NOT NULL AND cancelled_at IS NOT NULL)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX employee_job_events_employee ON employee_job_events (tenant_id, employee_id, effective_from);
-- One joining event per employee.
CREATE UNIQUE INDEX one_joining_event ON employee_job_events (tenant_id, employee_id)
  WHERE event_type = 'joining' AND status = 'active';
SELECT app_secure_tenant_table('employee_job_events', 'SELECT, INSERT, UPDATE');

-- Events are never edited; only cancellation fields may change, once.
CREATE FUNCTION employee_job_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'cancelled'
     OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.changes IS DISTINCT FROM OLD.changes
     OR (NEW.effective_from IS DISTINCT FROM OLD.effective_from AND OLD.event_type <> 'joining') THEN
    RAISE EXCEPTION 'employee_job_events: only cancellation is allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE ON employee_job_events FOR EACH ROW EXECUTE FUNCTION employee_job_events_guard();


CREATE TABLE employee_assignments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id           uuid NOT NULL,
  company_id            uuid NOT NULL,
  effective_from        date NOT NULL,
  effective_to          date,                   -- exclusive; NULL = still current
  branch_id             uuid NOT NULL,
  department_id         uuid NOT NULL,
  designation_id        uuid NOT NULL,
  grade_id              uuid NOT NULL,
  line_manager_id       uuid,                   -- NULL only for the top of the organization
  functional_manager_id uuid,
  source_event_id       uuid NOT NULL,          -- the event that started this period
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (line_manager_id IS DISTINCT FROM employee_id),
  CHECK (functional_manager_id IS DISTINCT FROM employee_id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES branches (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, department_id) REFERENCES departments (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, designation_id) REFERENCES designations (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, grade_id) REFERENCES grades (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, line_manager_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, functional_manager_id) REFERENCES employees (tenant_id, id),
  FOREIGN KEY (tenant_id, source_event_id) REFERENCES employee_job_events (tenant_id, id),
  -- guide §7.3: no overlapping assignment periods per employee
  CONSTRAINT no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    employee_id WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
CREATE INDEX employee_assignments_department ON employee_assignments (tenant_id, department_id);
CREATE INDEX employee_assignments_line_manager ON employee_assignments (tenant_id, line_manager_id);
-- DELETE is needed to rebuild the timeline from the events.
SELECT app_secure_tenant_table('employee_assignments', 'SELECT, INSERT, DELETE');


CREATE TABLE employee_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id    uuid NOT NULL,
  doc_type       text NOT NULL CHECK (doc_type IN
                   ('nid', 'tin_certificate', 'photo', 'cv', 'educational_certificate', 'experience_letter',
                    'contract', 'other')),
  title          text,
  file_key       text NOT NULL,                 -- location in file storage
  file_name      text NOT NULL,                 -- original name, for download
  content_type   text NOT NULL,
  size_bytes     integer NOT NULL CHECK (size_bytes > 0),
  sha256         text NOT NULL,
  expires_on     date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  removed_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT app_current_user_id(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CHECK (status = 'active' OR removed_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX employee_documents_employee ON employee_documents (tenant_id, employee_id);
CREATE TRIGGER touch BEFORE UPDATE ON employee_documents FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('employee_documents', 'SELECT, INSERT, UPDATE');


-- Spec §6.1: the checklist must be complete before the employee becomes active.
CREATE TABLE onboarding_checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id uuid NOT NULL,
  item_code   text NOT NULL CHECK (item_code ~ '^[a-z_]{1,40}$'),
  required    boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  done_at     timestamptz,
  done_by     uuid,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, item_code),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('onboarding_checklists', 'SELECT, INSERT, UPDATE');


-- Links that had to wait for the employees table.
-- The department head must be an employee of the same company.
ALTER TABLE departments
  ADD FOREIGN KEY (tenant_id, company_id, head_employee_id) REFERENCES employees (tenant_id, company_id, id);
ALTER TABLE users
  ADD FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id);
CREATE UNIQUE INDEX users_one_login_per_employee ON users (tenant_id, employee_id) WHERE employee_id IS NOT NULL;
