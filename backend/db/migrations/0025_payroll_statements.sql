-- =============================================================================
-- 0025  Payroll statements (payroll audit, 2026-10-21; spec §6.4 "annual tax
--       certificate per employee; PF ledger per member with company match")
--
-- The PF ledger and the tax certificate are read from approved payroll lines, so
-- they always agree with the payslips. Two small tables hold what payroll does
-- not know:
--
--   pf_openings          a member's PF balance brought from the old system
--                        (employee part, company part) as on a date
--   salary_tax_challans  the treasury challans that deposited the tax withheld
--                        from salaries in a month; printed on the certificate
-- =============================================================================

CREATE TABLE pf_openings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id     uuid NOT NULL,
  as_of           date NOT NULL,
  employee_part   numeric(14,2) NOT NULL CHECK (employee_part >= 0),
  employer_part   numeric(14,2) NOT NULL CHECK (employer_part >= 0),
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT app_current_user_id(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, employee_id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE TRIGGER touch BEFORE UPDATE ON pf_openings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('pf_openings', 'SELECT, INSERT, UPDATE');

CREATE TABLE salary_tax_challans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),   -- month the tax was withheld
  challan_no      text NOT NULL,
  challan_date    date NOT NULL,
  amount          numeric(16,2) NOT NULL CHECK (amount > 0),
  state           text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'cancelled')),
  cancelled_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT app_current_user_id()
);
CREATE UNIQUE INDEX salary_tax_challans_number ON salary_tax_challans (tenant_id, company_id, challan_no) WHERE state = 'active';
CREATE INDEX salary_tax_challans_period ON salary_tax_challans (tenant_id, company_id, period);
SELECT app_secure_tenant_table('salary_tax_challans', 'SELECT, INSERT, UPDATE');
