-- =============================================================================
-- 0009  Holiday calendars, attendance, service keys (spec §6.2, guide §7.5, §10)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Holiday calendars (calendar module). A branch uses one calendar. Holidays can
-- move at short notice (Eid depends on moon sighting); moving one recomputes
-- attendance for the affected days.
-- ---------------------------------------------------------------------------
CREATE TABLE holiday_calendars (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id uuid NOT NULL,
  name       text NOT NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app_current_user_id(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, name),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON holiday_calendars FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('holiday_calendars', 'SELECT, INSERT, UPDATE');

CREATE TABLE holidays (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  calendar_id    uuid NOT NULL,
  holiday_date   date NOT NULL,
  name_en        text NOT NULL,
  name_bn        text,
  holiday_type   text NOT NULL CHECK (holiday_type IN ('public', 'festival', 'company')),
  is_active      boolean NOT NULL DEFAULT true,
  removed_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT app_current_user_id(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  CHECK (is_active OR removed_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, calendar_id) REFERENCES holiday_calendars (tenant_id, id)
);
CREATE UNIQUE INDEX holidays_one_per_day ON holidays (tenant_id, calendar_id, holiday_date) WHERE is_active;
CREATE TRIGGER touch BEFORE UPDATE ON holidays FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('holidays', 'SELECT, INSERT, UPDATE');

-- the branch's calendar must belong to the same company
ALTER TABLE branches
  ADD FOREIGN KEY (tenant_id, company_id, holiday_calendar_id) REFERENCES holiday_calendars (tenant_id, company_id, id);

-- Company attendance policy (settings, not law).
ALTER TABLE companies
  ADD COLUMN attendance_correction_limit integer NOT NULL DEFAULT 3 CHECK (attendance_correction_limit BETWEEN 0 AND 31),
  -- Late penalty: built but OFF until legal review (guide §1, spec §6.2)
  ADD COLUMN late_penalty_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN late_penalty_every integer NOT NULL DEFAULT 3 CHECK (late_penalty_every BETWEEN 1 AND 31);


-- ---------------------------------------------------------------------------
-- Shifts
-- ---------------------------------------------------------------------------
CREATE TABLE shifts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id       uuid NOT NULL,
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name             text NOT NULL,
  start_time       time NOT NULL,                  -- local Dhaka time
  end_time         time NOT NULL,                  -- before start_time = ends next day (night shift)
  grace_minutes    integer NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 180),
  -- worked less than this = Half-day (spec §6.2 "half-day threshold")
  half_day_minutes integer NOT NULL DEFAULT 240 CHECK (half_day_minutes BETWEEN 0 AND 1440),
  is_default       boolean NOT NULL DEFAULT false, -- used when an employee has no shift assignment
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (start_time <> end_time),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE UNIQUE INDEX shifts_one_default ON shifts (tenant_id, company_id) WHERE is_default AND is_active;
CREATE TRIGGER touch BEFORE UPDATE ON shifts FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('shifts', 'SELECT, INSERT, UPDATE');

CREATE TABLE shift_assignments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  employee_id    uuid NOT NULL,
  shift_id       uuid NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,                             -- exclusive
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid DEFAULT app_current_user_id(),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, shift_id) REFERENCES shifts (tenant_id, company_id, id),
  CONSTRAINT shift_assignments_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&
  )
);
SELECT app_secure_tenant_table('shift_assignments', 'SELECT, INSERT, UPDATE');

-- Temporary timings for a date range, e.g. Ramadan hours 09:00-15:30 (spec §6.2).
CREATE TABLE shift_overrides (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id       uuid NOT NULL,
  branch_id        uuid,                           -- NULL = every branch of the company
  name             text NOT NULL,
  from_date        date NOT NULL,
  to_date          date NOT NULL,                  -- inclusive
  start_time       time NOT NULL,
  end_time         time NOT NULL,
  grace_minutes    integer CHECK (grace_minutes BETWEEN 0 AND 180),
  half_day_minutes integer CHECK (half_day_minutes BETWEEN 0 AND 1440),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id(),
  CHECK (to_date >= from_date),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES branches (tenant_id, company_id, id)
);
SELECT app_secure_tenant_table('shift_overrides', 'SELECT, INSERT, UPDATE');


-- ---------------------------------------------------------------------------
-- Who punches how
-- ---------------------------------------------------------------------------
-- Per employee: user number on the biometric devices, and permission to punch from the web.
CREATE TABLE attendance_profiles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  employee_id       uuid NOT NULL,
  device_user_id    text CHECK (device_user_id ~ '^[A-Za-z0-9]{1,20}$'),
  web_punch_allowed boolean NOT NULL DEFAULT false,   -- "approved remote staff" (spec §6.2)
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_id),
  UNIQUE (tenant_id, company_id, device_user_id),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON attendance_profiles FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('attendance_profiles', 'SELECT, INSERT, UPDATE');

-- Phones registered for mobile punch (spec §11 "device registration for mobile attendance").
-- One active phone per employee, and one employee per phone (no buddy punching).
CREATE TABLE employee_devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id    uuid NOT NULL,
  device_id      text NOT NULL CHECK (length(device_id) BETWEEN 8 AND 200),   -- install id from the app
  name           text NOT NULL,                                                -- e.g. "Samsung Galaxy A15"
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  approved_by    uuid,
  approved_at    timestamptz,
  revoked_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE UNIQUE INDEX employee_devices_one_active ON employee_devices (tenant_id, employee_id) WHERE status = 'active';
CREATE UNIQUE INDEX employee_devices_one_owner ON employee_devices (tenant_id, device_id) WHERE status <> 'revoked';
SELECT app_secure_tenant_table('employee_devices', 'SELECT, INSERT, UPDATE');

-- Biometric devices seen by the office sync agent (clock drift is tracked).
CREATE TABLE attendance_devices (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id               uuid NOT NULL,
  branch_id                uuid NOT NULL,
  serial                   text NOT NULL CHECK (length(serial) BETWEEN 3 AND 100),
  brand                    text,
  last_seen_at             timestamptz,
  last_clock_drift_seconds integer,
  UNIQUE (tenant_id, serial),
  FOREIGN KEY (tenant_id, company_id, branch_id) REFERENCES branches (tenant_id, company_id, id)
);
SELECT app_secure_tenant_table('attendance_devices', 'SELECT, INSERT, UPDATE');


-- ---------------------------------------------------------------------------
-- Punches (raw, never edited) and computed days
-- ---------------------------------------------------------------------------
CREATE TABLE attendance_punches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id  uuid NOT NULL,
  punched_at   timestamptz NOT NULL,
  source       text NOT NULL CHECK (source IN ('device', 'mobile', 'web', 'correction')),
  device_ref   text NOT NULL DEFAULT '',          -- device serial, phone id, 'web', or correction id
  latitude     double precision,
  longitude    double precision,
  distance_m   integer,                           -- from the branch geo-fence centre (mobile)
  raw_ref      jsonb,                             -- original record from the device
  received_at  timestamptz NOT NULL DEFAULT now(),
  created_by   uuid DEFAULT app_current_user_id(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
-- the same punch sent twice (agent retry, double tap) is stored once (guide §7.5)
CREATE UNIQUE INDEX attendance_punches_dedupe ON attendance_punches (tenant_id, employee_id, punched_at, source, device_ref);
CREATE INDEX attendance_punches_time ON attendance_punches (tenant_id, employee_id, punched_at);
SELECT app_secure_tenant_table('attendance_punches', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON attendance_punches FOR EACH ROW EXECUTE FUNCTION app_reject_change();

CREATE TABLE attendance_days (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  work_date           date NOT NULL,
  company_id          uuid NOT NULL,
  branch_id           uuid,
  department_id       uuid,
  shift_id            uuid,
  status              text NOT NULL CHECK (status IN
                        ('present', 'late', 'half_day', 'absent', 'on_leave', 'holiday', 'weekend', 'missing_punch')),
  first_in            timestamptz,
  last_out            timestamptz,
  worked_minutes      integer NOT NULL DEFAULT 0,
  late_minutes        integer NOT NULL DEFAULT 0,
  ot_minutes          integer NOT NULL DEFAULT 0,  -- eligible overtime worked (OT-eligible grades only)
  ot_approved_minutes integer NOT NULL DEFAULT 0,  -- after Dept Head approval; payroll uses this
  holiday_name        text,
  locked              boolean NOT NULL DEFAULT false,
  computed_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_id, work_date),
  FOREIGN KEY (tenant_id, company_id, employee_id) REFERENCES employees (tenant_id, company_id, id)
);
CREATE INDEX attendance_days_by_date ON attendance_days (tenant_id, company_id, work_date);
SELECT app_secure_tenant_table('attendance_days', 'SELECT, INSERT, UPDATE');

-- A locked day whose result would change: the difference waits for the next payroll.
CREATE TABLE attendance_adjustments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id       uuid NOT NULL,
  work_date         date NOT NULL,
  previous          jsonb NOT NULL,               -- status, minutes as locked
  corrected         jsonb NOT NULL,               -- status, minutes as they would be now
  reason            text NOT NULL,                -- e.g. holiday_moved, correction_approved, late_device_upload
  payroll_period    text,                         -- filled by payroll when applied (WP6)
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('attendance_adjustments', 'SELECT, INSERT, UPDATE');

CREATE TABLE attendance_locks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id uuid NOT NULL,
  period     text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- YYYY-MM
  locked_at  timestamptz NOT NULL DEFAULT now(),
  locked_by  uuid DEFAULT app_current_user_id(),
  UNIQUE (tenant_id, company_id, period),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
SELECT app_secure_tenant_table('attendance_locks', 'SELECT, INSERT');


-- ---------------------------------------------------------------------------
-- Requests that go through the approval engine
-- ---------------------------------------------------------------------------
CREATE TABLE attendance_corrections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  work_date           date NOT NULL,
  requested_in        timestamptz,
  requested_out       timestamptz,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  CHECK (requested_in IS NOT NULL OR requested_out IS NOT NULL),
  CHECK (requested_in IS NULL OR requested_out IS NULL OR requested_out > requested_in),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
SELECT app_secure_tenant_table('attendance_corrections', 'SELECT, INSERT, UPDATE');

CREATE TABLE overtime_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  work_date           date NOT NULL,
  minutes             integer NOT NULL CHECK (minutes > 0),
  reason              text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  approval_request_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE UNIQUE INDEX overtime_one_open_per_day ON overtime_requests (tenant_id, employee_id, work_date) WHERE status IN ('pending', 'approved');
SELECT app_secure_tenant_table('overtime_requests', 'SELECT, INSERT, UPDATE');


-- ---------------------------------------------------------------------------
-- Service keys (guide §7.2): machines (office sync agent, later n8n) call the
-- API with a tenant-scoped key limited to named permissions.
-- ---------------------------------------------------------------------------
CREATE TABLE service_keys (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  name           text NOT NULL,
  secret_hash    text NOT NULL,                   -- sha256 of the secret; the secret is shown once
  permissions    text[] NOT NULL CHECK (cardinality(permissions) > 0),
  company_id     uuid,                            -- limit to one company (e.g. one office agent)
  created_by     uuid DEFAULT app_current_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  revoked_reason text,
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
SELECT app_secure_tenant_table('service_keys', 'SELECT, INSERT, UPDATE');

-- A service key arrives before the tenant is known: this returns only what is
-- needed to check it (like auth_find_tenant_id for logins).
CREATE POLICY owner_key_lookup ON service_keys FOR SELECT TO erp_owner USING (true);
CREATE FUNCTION auth_find_service_key(p_id uuid)
  RETURNS TABLE (tenant_id uuid, secret_hash text, permissions text[], company_id uuid, revoked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT k.tenant_id, k.secret_hash, k.permissions, k.company_id, k.revoked_at IS NOT NULL
          FROM service_keys k JOIN tenants t ON t.id = k.tenant_id
         WHERE k.id = p_id AND t.status IN ('trial', 'active') $$;
REVOKE ALL ON FUNCTION auth_find_service_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_service_key(uuid) TO erp_app;

-- The daily attendance job runs per tenant: the worker may list active tenant ids (ids only).
CREATE FUNCTION worker_active_tenant_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM tenants WHERE status IN ('trial', 'active') $$;
REVOKE ALL ON FUNCTION worker_active_tenant_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_active_tenant_ids() TO erp_worker;
