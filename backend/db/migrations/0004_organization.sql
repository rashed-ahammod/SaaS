-- =============================================================================
-- 0004  Organization (spec §3, guide §7.1)
--
--   tenant -> company -> branch
--                     -> department (tree) -> sub-department ...
--                     -> designations, grades
--
-- Foreign keys always include tenant_id (and company_id where it applies), e.g.
--   FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
-- because PostgreSQL checks foreign keys WITHOUT row-level security. A plain
-- company_id key would accept another tenant's id. See docs/adr/0004.
-- =============================================================================

CREATE TABLE companies (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  legal_name           text NOT NULL,
  short_name           text,
  tin                  text CHECK (tin ~ '^[0-9]{12}$'),           -- company e-TIN
  bin                  text CHECK (bin ~ '^[0-9-]{9,15}$'),        -- VAT business identification number
  fiscal_year_start    text NOT NULL DEFAULT '07-01' CHECK (fiscal_year_start ~ '^(0[1-9]|1[0-2])-01$'),
  base_currency        char(3) NOT NULL DEFAULT 'BDT',
  -- company settings (spec §3: employee ID format, probation length)
  employee_code_prefix text NOT NULL DEFAULT 'EMP' CHECK (employee_code_prefix ~ '^[A-Z0-9]{1,10}$'),
  next_employee_number integer NOT NULL DEFAULT 1 CHECK (next_employee_number > 0),
  probation_months     integer NOT NULL DEFAULT 6 CHECK (probation_months BETWEEN 0 AND 12),
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid DEFAULT app_current_user_id(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_name)
);
CREATE TRIGGER touch BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('companies', 'SELECT, INSERT, UPDATE');


CREATE TABLE branches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id          uuid NOT NULL,
  code                text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name                text NOT NULL,
  address             text,
  -- weekly off days, e.g. {FRI} or {FRI,SAT} (spec §6.2)
  weekend_days        text[] NOT NULL DEFAULT '{FRI}'
                      CHECK (weekend_days <@ ARRAY['SUN','MON','TUE','WED','THU','FRI','SAT'] AND cardinality(weekend_days) <= 3),
  holiday_calendar_id uuid,                     -- foreign key added with holiday calendars (WP4)
  -- geo-fence for mobile attendance: all three set, or none
  geo_lat             double precision CHECK (geo_lat BETWEEN -90 AND 90),
  geo_lng             double precision CHECK (geo_lng BETWEEN -180 AND 180),
  geo_radius_m        integer CHECK (geo_radius_m BETWEEN 10 AND 5000),
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  CHECK ((geo_lat IS NULL) = (geo_lng IS NULL) AND (geo_lat IS NULL) = (geo_radius_m IS NULL)),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON branches FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('branches', 'SELECT, INSERT, UPDATE');


CREATE TABLE departments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id       uuid NOT NULL,
  parent_id        uuid,                        -- NULL = top-level department
  code             text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name             text NOT NULL,
  cost_centre_code text,
  head_employee_id uuid,                        -- foreign key added in 0005 (employees)
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid DEFAULT app_current_user_id(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  version          integer NOT NULL DEFAULT 1,
  CHECK (parent_id <> id),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id),
  -- the parent must be in the same company
  FOREIGN KEY (tenant_id, company_id, parent_id) REFERENCES departments (tenant_id, company_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('departments', 'SELECT, INSERT, UPDATE');

-- Closure table: one row for every (ancestor, descendant) pair, including each
-- department with itself at depth 0. "Is X inside department D?" becomes one
-- indexed lookup (used for Department-scope permissions in WP2).
-- Maintained only by DepartmentsService.
CREATE TABLE department_paths (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  ancestor_id   uuid NOT NULL,
  descendant_id uuid NOT NULL,
  depth         integer NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (tenant_id, ancestor_id, descendant_id),
  FOREIGN KEY (tenant_id, ancestor_id) REFERENCES departments (tenant_id, id),
  FOREIGN KEY (tenant_id, descendant_id) REFERENCES departments (tenant_id, id)
);
CREATE INDEX department_paths_descendant ON department_paths (tenant_id, descendant_id);
SELECT app_secure_tenant_table('department_paths', 'SELECT, INSERT, DELETE');


CREATE TABLE designations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id uuid NOT NULL,
  code       text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name_en    text NOT NULL,
  name_bn    text,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT app_current_user_id(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version    integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON designations FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('designations', 'SELECT, INSERT, UPDATE');


CREATE TABLE grades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id  uuid NOT NULL,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name        text NOT NULL,
  rank        integer NOT NULL DEFAULT 0,       -- higher = more senior (for sorting)
  ot_eligible boolean NOT NULL DEFAULT false,   -- overtime only for eligible grades (spec §6.2)
  salary_min  numeric(18,2) CHECK (salary_min >= 0),
  salary_max  numeric(18,2),
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT app_current_user_id(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  CHECK (salary_max IS NULL OR salary_min IS NULL OR salary_max >= salary_min),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES companies (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON grades FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('grades', 'SELECT, INSERT, UPDATE');
