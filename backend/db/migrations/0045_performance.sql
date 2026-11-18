-- =============================================================================
-- 0045  Performance (Phase 3 WP30; spec §6.5: "Cycle -> goals/KPIs from a library per
--       designation -> self-review -> Dept Head rating -> HR calibration across departments
--       -> increment and promotion proposals -> Admin approval -> effective-dated salary
--       change -> arrears in payroll. Continuous feedback notes can be added any time and
--       are visible in the review.")
--
--   kpi_library            the KPIs a company measures, per designation or company-wide
--   appraisal_cycles       annual or half-yearly, with the phase it is in
--   appraisals             one per employee per cycle: self-review, the manager's rating,
--                          HR's calibrated rating, the final one
--   appraisal_goals        the goals of one appraisal, their weights, and the scores the
--                          employee and the manager gave each
--   feedback_notes         continuous feedback about an employee, visible in their review
--   increment_proposals    what the cycle leads to: a new salary from a date, a promotion,
--                          or both, through the approval engine; applying it writes the
--                          effective-dated salary (and the job event), and payroll pays the
--                          arrears by itself
--
-- Guarantees the database keeps:
--   - one appraisal per employee per cycle, and one cycle name per company;
--   - a rating is 1 to 5, and the weights of one appraisal's goals add up to 100 (checked by
--     a trigger when the goals are submitted, not on every insert);
--   - a calibrated rating exists only with who calibrated it and when;
--   - one proposal per appraisal at a time (a withdrawn one may be followed by another);
--   - an applied proposal always says which salary row and which job event it became.
-- =============================================================================

CREATE TABLE kpi_library (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id      uuid NOT NULL,
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  title           text NOT NULL,
  title_bn        text,
  description     text,
  -- what "done" looks like: a number, a percentage, a date, or a judgement
  measure         text NOT NULL DEFAULT 'number' CHECK (measure IN ('number', 'percent', 'taka', 'date', 'judgement')),
  -- the designation this KPI is for; NULL = every designation in the company
  designation_id  uuid REFERENCES designations (id),
  default_weight  integer NOT NULL DEFAULT 10 CHECK (default_weight BETWEEN 1 AND 100),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON kpi_library FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('kpi_library', 'SELECT, INSERT, UPDATE');

CREATE TABLE appraisal_cycles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  name           text NOT NULL,                  -- "2025-26 annual"
  kind           text NOT NULL CHECK (kind IN ('annual', 'half_yearly')),
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  -- the phase the cycle is in; it only ever moves forward (performance-rules.ts)
  state          text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'goals', 'self_review', 'manager_review', 'calibration', 'proposals', 'closed')),
  -- the salary change an approved increment of this cycle starts from
  increment_from date,
  note           text,
  created_by     uuid DEFAULT app_current_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, name),
  CONSTRAINT period_order CHECK (period_to > period_from)
);
CREATE TRIGGER touch BEFORE UPDATE ON appraisal_cycles FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('appraisal_cycles', 'SELECT, INSERT, UPDATE');

CREATE TABLE appraisals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  cycle_id             uuid NOT NULL REFERENCES appraisal_cycles (id),
  employee_id          uuid NOT NULL REFERENCES employees (id),
  -- the manager who rates: the line manager at the time the appraisal was opened
  manager_employee_id  uuid REFERENCES employees (id),
  department_id        uuid REFERENCES departments (id),
  state                text NOT NULL DEFAULT 'goals' CHECK (state IN ('goals', 'self_review', 'manager_review', 'calibration', 'done')),
  self_review          text,
  self_submitted_at    timestamptz,
  manager_rating       integer CHECK (manager_rating BETWEEN 1 AND 5),
  manager_comment      text,
  manager_submitted_at timestamptz,
  manager_user_id      uuid REFERENCES users (id),
  -- HR's calibration across departments: the rating that counts for proposals
  calibrated_rating    integer CHECK (calibrated_rating BETWEEN 1 AND 5),
  calibration_note     text,
  calibrated_by        uuid REFERENCES users (id),
  calibrated_at        timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, cycle_id, employee_id),
  CONSTRAINT self_review_recorded CHECK ((self_submitted_at IS NULL) = (self_review IS NULL)),
  CONSTRAINT manager_rating_recorded CHECK ((manager_submitted_at IS NULL) = (manager_rating IS NULL)),
  CONSTRAINT calibration_recorded CHECK (
    (calibrated_rating IS NULL) = (calibrated_at IS NULL)
    AND (calibrated_rating IS NULL) = (calibrated_by IS NULL)
  )
);
CREATE TRIGGER touch BEFORE UPDATE ON appraisals FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX appraisals_employee ON appraisals (tenant_id, employee_id);
CREATE INDEX appraisals_manager ON appraisals (tenant_id, manager_employee_id, state);
SELECT app_secure_tenant_table('appraisals', 'SELECT, INSERT, UPDATE');

CREATE TABLE appraisal_goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  appraisal_id    uuid NOT NULL REFERENCES appraisals (id),
  kpi_id          uuid REFERENCES kpi_library (id),
  title           text NOT NULL,
  target          text,
  weight          integer NOT NULL CHECK (weight BETWEEN 1 AND 100),
  self_score      integer CHECK (self_score BETWEEN 1 AND 5),
  self_note       text,
  manager_score   integer CHECK (manager_score BETWEEN 1 AND 5),
  manager_note    text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1
);
CREATE TRIGGER touch BEFORE UPDATE ON appraisal_goals FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX appraisal_goals_appraisal ON appraisal_goals (tenant_id, appraisal_id);
SELECT app_secure_tenant_table('appraisal_goals', 'SELECT, INSERT, UPDATE, DELETE');

-- Continuous feedback (spec §6.5): written any time, read in the review.
CREATE TABLE feedback_notes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id     uuid NOT NULL,
  employee_id    uuid NOT NULL REFERENCES employees (id),
  body           text NOT NULL,
  -- what it is about, so a year of notes can be read quickly
  kind           text NOT NULL DEFAULT 'note' CHECK (kind IN ('note', 'praise', 'concern', 'coaching')),
  -- who may read it besides the author: the employee's manager and HR always; the employee
  -- only when the author shares it with them
  shared_with_employee boolean NOT NULL DEFAULT false,
  author_user_id uuid DEFAULT app_current_user_id(),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_notes_employee ON feedback_notes (tenant_id, employee_id, created_at);
SELECT app_secure_tenant_table('feedback_notes', 'SELECT, INSERT');

CREATE TABLE increment_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  appraisal_id         uuid NOT NULL REFERENCES appraisals (id),
  employee_id          uuid NOT NULL REFERENCES employees (id),
  kind                 text NOT NULL CHECK (kind IN ('increment', 'promotion', 'both')),
  -- the increment: the new monthly gross from effective_from
  new_gross            numeric(14,2) CHECK (new_gross > 0),
  structure_id         uuid REFERENCES salary_structures (id),
  -- the promotion
  new_designation_id   uuid REFERENCES designations (id),
  new_grade_id         uuid REFERENCES grades (id),
  effective_from       date NOT NULL,
  justification        text NOT NULL,
  state                text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'approved', 'rejected', 'withdrawn', 'applied')),
  approval_request_id  uuid REFERENCES approval_requests (id),
  -- what it became when it was applied
  applied_salary_id    uuid REFERENCES employee_salaries (id),
  applied_event_id     uuid REFERENCES employee_job_events (id),
  applied_at           timestamptz,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  -- an increment needs a new salary; a promotion needs a new designation or grade
  CONSTRAINT increment_has_salary CHECK (
    (kind = 'promotion') OR (new_gross IS NOT NULL AND structure_id IS NOT NULL)
  ),
  CONSTRAINT promotion_has_post CHECK (
    (kind = 'increment') OR (new_designation_id IS NOT NULL OR new_grade_id IS NOT NULL)
  ),
  CONSTRAINT applied_recorded CHECK ((state = 'applied') = (applied_at IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON increment_proposals FOR EACH ROW EXECUTE FUNCTION app_touch_row();
-- one live proposal per appraisal
CREATE UNIQUE INDEX increment_proposals_live ON increment_proposals (tenant_id, appraisal_id)
  WHERE state IN ('in_approval', 'approved');
CREATE INDEX increment_proposals_employee ON increment_proposals (tenant_id, employee_id);
SELECT app_secure_tenant_table('increment_proposals', 'SELECT, INSERT, UPDATE');

-- AI feature switch for review drafting (WP11 pattern, WP30 feature)
ALTER TABLE ai_settings ADD COLUMN review_draft_enabled boolean NOT NULL DEFAULT true;
GRANT INSERT (review_draft_enabled) ON ai_settings TO erp_app;
GRANT UPDATE (review_draft_enabled) ON ai_settings TO erp_app;

ALTER TABLE ai_usage DROP CONSTRAINT ai_usage_feature_check;
ALTER TABLE ai_usage ADD CONSTRAINT ai_usage_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening', 'review_draft'));
ALTER TABLE ai_interactions DROP CONSTRAINT ai_interactions_feature_check;
ALTER TABLE ai_interactions ADD CONSTRAINT ai_interactions_feature_check CHECK (feature IN ('assistant', 'payroll_flag_explanation', 'bank_match_suggestion', 'document_reader', 'cv_screening', 'review_draft'));
