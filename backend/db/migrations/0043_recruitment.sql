-- =============================================================================
-- 0043  Recruitment (Phase 3 WP29; spec §5 "New position (headcount): Dept Head ->
--       HR -> Admin, checked against an approved manpower plan", §8 feature "CV
--       screening", §11 retention of personal data)
--
--   manpower_plans (+ lines)     the approved headcount per department and designation for
--                                a fiscal year. A position request outside the plan is not
--                                refused: it is marked and the approvers see it.
--   position_requests            NP/2026-27/00001: the request for a new post, through the
--                                approval engine (request type 'new_position')
--   job_openings                 JO/2026-27/00001: a post actually being recruited for,
--                                raised from an approved position request
--   job_postings                 where an opening was advertised (website, Facebook, a
--                                notice board, a referral drive)
--   applicants                   a person who applied: their CV, their consent to keep it,
--                                and the date their personal data must be cleared
--   applications (+ events)      one applicant for one opening, with its stage history
--   interviews (+ panel, scorecards)
--   job_offers                   OF/2026-27/00001: the offer, its letter, and the employee
--                                record it became
--   cv_screenings                what the AI said about a CV it was shown BLIND (no name,
--                                gender, religion, age or photo), with its reasons
--
-- Retention (spec §11): an applicant who was not hired has their personal data and their CV
-- cleared after the period in platform/retention.ts. retention_apply() gains a fourth
-- period for it, and the file itself is removed by the retention job (SQL cannot delete a
-- file from the bucket), which is why applicants.cv_file_key is cleared in the same step.
-- =============================================================================

-- ------------------------------------------------------------- manpower plan

CREATE TABLE manpower_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  fiscal_year_code  text NOT NULL,                 -- 2026-27
  state             text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'approved')),
  approved_by       uuid REFERENCES users (id),
  approved_at       timestamptz,
  note              text,
  created_by        uuid DEFAULT app_current_user_id(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, fiscal_year_code),
  CONSTRAINT approved_recorded CHECK ((state = 'approved') = (approved_at IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON manpower_plans FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('manpower_plans', 'SELECT, INSERT, UPDATE');

CREATE TABLE manpower_plan_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  plan_id         uuid NOT NULL REFERENCES manpower_plans (id),
  department_id   uuid NOT NULL REFERENCES departments (id),
  designation_id  uuid NOT NULL REFERENCES designations (id),
  headcount       integer NOT NULL CHECK (headcount > 0),
  UNIQUE (tenant_id, plan_id, department_id, designation_id)
);
SELECT app_secure_tenant_table('manpower_plan_lines', 'SELECT, INSERT, UPDATE, DELETE');

-- --------------------------------------------------------- position requests

CREATE TABLE position_requests (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  number               text NOT NULL,              -- NP/2026-27/00001
  department_id        uuid NOT NULL REFERENCES departments (id),
  designation_id       uuid NOT NULL REFERENCES designations (id),
  grade_id             uuid NOT NULL REFERENCES grades (id),
  branch_id            uuid NOT NULL REFERENCES branches (id),
  employment_type      text NOT NULL DEFAULT 'permanent' CHECK (employment_type IN ('permanent', 'contract', 'probation_only', 'intern', 'part_time')),
  headcount            integer NOT NULL CHECK (headcount > 0 AND headcount <= 500),
  replacement_for      uuid REFERENCES employees (id),
  reason               text NOT NULL,
  -- the plan check, taken when the request is raised, so the approvers see what was true then
  within_plan          boolean NOT NULL,
  plan_detail          jsonb NOT NULL DEFAULT '{}',
  state                text NOT NULL DEFAULT 'in_approval' CHECK (state IN ('in_approval', 'approved', 'rejected', 'cancelled', 'opened')),
  approval_request_id  uuid REFERENCES approval_requests (id),
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number)
);
CREATE TRIGGER touch BEFORE UPDATE ON position_requests FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX position_requests_department ON position_requests (tenant_id, department_id);
SELECT app_secure_tenant_table('position_requests', 'SELECT, INSERT, UPDATE');

-- -------------------------------------------------------------- job openings

CREATE TABLE job_openings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  number                text NOT NULL,             -- JO/2026-27/00001
  position_request_id   uuid NOT NULL REFERENCES position_requests (id),
  title                 text NOT NULL,
  title_bn              text,
  description           text NOT NULL,
  -- what the CV is judged against; the AI screening sees exactly these and nothing about the person
  requirements          text[] NOT NULL DEFAULT '{}',
  openings              integer NOT NULL CHECK (openings > 0),
  closing_on            date,
  state                 text NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'on_hold', 'filled', 'closed')),
  close_reason          text,
  created_by            uuid DEFAULT app_current_user_id(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  -- one opening per approved request: the request is the authority for the post
  UNIQUE (tenant_id, position_request_id)
);
CREATE TRIGGER touch BEFORE UPDATE ON job_openings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('job_openings', 'SELECT, INSERT, UPDATE');

CREATE TABLE job_postings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  opening_id  uuid NOT NULL REFERENCES job_openings (id),
  channel     text NOT NULL CHECK (channel IN ('website', 'facebook', 'notice_board', 'referral', 'newspaper', 'agency', 'other')),
  posted_on   date NOT NULL,
  reference   text,                                 -- the link, the page, the agency
  posted_by   uuid DEFAULT app_current_user_id(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, opening_id, channel, posted_on)
);
SELECT app_secure_tenant_table('job_postings', 'SELECT, INSERT');

-- ---------------------------------------------------------------- applicants

CREATE TABLE applicants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  full_name_en      text NOT NULL,
  full_name_bn      text,
  phone             text CHECK (phone ~ '^\+880[0-9]{8,10}$'),
  email             text CHECK (email = lower(email)),
  district          text,
  date_of_birth     date,
  gender            text CHECK (gender IN ('male', 'female', 'other')),
  source            text NOT NULL DEFAULT 'website' CHECK (source IN ('website', 'facebook', 'referral', 'agency', 'walk_in', 'newspaper', 'other')),
  source_detail     text,
  referred_by       uuid REFERENCES employees (id),
  cv_file_key       text,
  cv_file_name      text,
  -- the CV as text, for screening and search. Cleared with the rest at retention.
  cv_text           text,
  -- spec §11: a CV is kept only with the applicant's consent, and only for a period
  consent_at        timestamptz NOT NULL,
  consent_version   text NOT NULL,
  retention_until   date NOT NULL,
  redacted_at       timestamptz,
  created_by        uuid DEFAULT app_current_user_id(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1
);
CREATE TRIGGER touch BEFORE UPDATE ON applicants FOR EACH ROW EXECUTE FUNCTION app_touch_row();
-- the same person twice for the same company: one record (phone or e-mail)
CREATE UNIQUE INDEX applicants_phone ON applicants (tenant_id, company_id, phone) WHERE phone IS NOT NULL AND redacted_at IS NULL;
CREATE UNIQUE INDEX applicants_email ON applicants (tenant_id, company_id, email) WHERE email IS NOT NULL AND redacted_at IS NULL;
CREATE INDEX applicants_retention ON applicants (tenant_id, retention_until) WHERE redacted_at IS NULL;
SELECT app_secure_tenant_table('applicants', 'SELECT, INSERT, UPDATE');

CREATE TABLE applications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id         uuid NOT NULL,
  applicant_id       uuid NOT NULL REFERENCES applicants (id),
  opening_id         uuid NOT NULL REFERENCES job_openings (id),
  state              text NOT NULL DEFAULT 'applied' CHECK (state IN ('applied', 'screened', 'shortlisted', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn')),
  rejected_reason    text,
  hired_employee_id  uuid REFERENCES employees (id),
  applied_on         date NOT NULL,
  created_by         uuid DEFAULT app_current_user_id(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  version            integer NOT NULL DEFAULT 1,
  -- one application per person per opening
  UNIQUE (tenant_id, applicant_id, opening_id),
  CONSTRAINT rejection_has_reason CHECK ((state = 'rejected') = (rejected_reason IS NOT NULL)),
  CONSTRAINT hired_has_employee CHECK ((state = 'hired') = (hired_employee_id IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON applications FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX applications_opening ON applications (tenant_id, opening_id, state);
-- one employee record can come from one application only
CREATE UNIQUE INDEX applications_hired_employee ON applications (tenant_id, hired_employee_id) WHERE hired_employee_id IS NOT NULL;
SELECT app_secure_tenant_table('applications', 'SELECT, INSERT, UPDATE');

CREATE TABLE application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  application_id  uuid NOT NULL REFERENCES applications (id),
  from_state      text,
  to_state        text NOT NULL,
  note            text,
  by_user_id      uuid DEFAULT app_current_user_id(),
  at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX application_events_application ON application_events (tenant_id, application_id, at);
SELECT app_secure_tenant_table('application_events', 'SELECT, INSERT');

-- ---------------------------------------------------------------- interviews

CREATE TABLE interviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  application_id  uuid NOT NULL REFERENCES applications (id),
  round_no        integer NOT NULL CHECK (round_no > 0),
  kind            text NOT NULL DEFAULT 'in_person' CHECK (kind IN ('phone', 'in_person', 'online', 'written_test')),
  scheduled_at    timestamptz NOT NULL,
  place           text,
  state           text NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled', 'done', 'cancelled', 'no_show')),
  outcome         text CHECK (outcome IN ('proceed', 'reject', 'hold')),
  cancel_reason   text,
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, application_id, round_no)
);
CREATE TRIGGER touch BEFORE UPDATE ON interviews FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('interviews', 'SELECT, INSERT, UPDATE');

CREATE TABLE interview_panel (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  interview_id  uuid NOT NULL REFERENCES interviews (id),
  user_id       uuid NOT NULL REFERENCES users (id),
  PRIMARY KEY (tenant_id, interview_id, user_id)
);
SELECT app_secure_tenant_table('interview_panel', 'SELECT, INSERT, DELETE');

CREATE TABLE interview_scorecards (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  interview_id    uuid NOT NULL REFERENCES interviews (id),
  interviewer_id  uuid NOT NULL REFERENCES users (id),
  -- { "Technical knowledge": 4, "Communication": 3, ... }, each 1-5
  scores          jsonb NOT NULL DEFAULT '{}',
  overall         integer NOT NULL CHECK (overall BETWEEN 1 AND 5),
  recommendation  text NOT NULL CHECK (recommendation IN ('hire', 'no_hire', 'hold')),
  notes           text,
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  -- one scorecard per interviewer per interview; changing it means replacing it
  UNIQUE (tenant_id, interview_id, interviewer_id)
);
SELECT app_secure_tenant_table('interview_scorecards', 'SELECT, INSERT, UPDATE');

-- -------------------------------------------------------------------- offers

CREATE TABLE job_offers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id           uuid NOT NULL,
  number               text NOT NULL,              -- OF/2026-27/00001
  application_id       uuid NOT NULL REFERENCES applications (id),
  branch_id            uuid NOT NULL REFERENCES branches (id),
  department_id        uuid NOT NULL REFERENCES departments (id),
  designation_id       uuid NOT NULL REFERENCES designations (id),
  grade_id             uuid NOT NULL REFERENCES grades (id),
  gross_salary         numeric(14,2) NOT NULL CHECK (gross_salary > 0),
  -- an offer outside the grade's salary range needs the Admin's approval before it goes out
  outside_grade_range  boolean NOT NULL DEFAULT false,
  approval_request_id  uuid REFERENCES approval_requests (id),
  joining_on           date NOT NULL,
  probation_months     integer NOT NULL DEFAULT 6 CHECK (probation_months BETWEEN 0 AND 24),
  valid_until          date NOT NULL,
  terms                text,
  state                text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'in_approval', 'approved', 'sent', 'accepted', 'declined', 'withdrawn', 'expired')),
  decline_reason       text,
  sent_at              timestamptz,
  decided_at           timestamptz,
  created_by           uuid DEFAULT app_current_user_id(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  version              integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  -- one live offer per application; a withdrawn or declined one may be followed by another
  CONSTRAINT decided_recorded CHECK (
    (state IN ('accepted', 'declined', 'withdrawn')) = (decided_at IS NOT NULL)
  )
);
CREATE TRIGGER touch BEFORE UPDATE ON job_offers FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE UNIQUE INDEX job_offers_live ON job_offers (tenant_id, application_id)
  WHERE state IN ('draft', 'in_approval', 'approved', 'sent', 'accepted');
SELECT app_secure_tenant_table('job_offers', 'SELECT, INSERT, UPDATE');

-- -------------------------------------------------------------- CV screening

-- What the model was shown is recorded as the BLIND text it actually received, so a
-- fairness complaint can be answered with the evidence (spec §8 guardrails).
CREATE TABLE cv_screenings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  application_id  uuid NOT NULL REFERENCES applications (id),
  score           integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  reasons         jsonb NOT NULL DEFAULT '[]',
  blind_input     text NOT NULL,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  interaction_id  uuid,
  created_by      uuid DEFAULT app_current_user_id(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cv_screenings_application ON cv_screenings (tenant_id, application_id, created_at);
SELECT app_secure_tenant_table('cv_screenings', 'SELECT, INSERT');

-- AI feature switch for the tenant (WP11 pattern)
ALTER TABLE ai_settings ADD COLUMN cv_screening_enabled boolean NOT NULL DEFAULT true;
GRANT INSERT (cv_screening_enabled) ON ai_settings TO erp_app;
GRANT UPDATE (cv_screening_enabled) ON ai_settings TO erp_app;

-- ----------------------------------------------------------------- retention

-- A fourth period: applicants who were not hired. The CV file in the bucket is removed by
-- the retention job before it calls this, because SQL cannot reach the bucket.
DROP FUNCTION retention_apply(timestamptz, timestamptz, timestamptz);
CREATE FUNCTION retention_apply(
  p_location_before timestamptz,
  p_ai_text_before timestamptz,
  p_staging_before timestamptz,
  p_applicant_before timestamptz DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_locations integer;
  v_ai integer;
  v_staging integer;
  v_applicants integer := 0;
BEGIN
  IF app_current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'retention_apply needs a tenant';
  END IF;
  -- floors, so a wrong or malicious call can never remove recent data
  IF p_location_before > now() - interval '90 days' OR p_ai_text_before > now() - interval '180 days'
     OR p_staging_before > now() - interval '30 days'
     OR (p_applicant_before IS NOT NULL AND p_applicant_before > now()) THEN
    RAISE EXCEPTION 'retention_apply: periods shorter than the minimum (90 / 180 / 30 days), or a date in the future';
  END IF;
  PERFORM set_config('app.retention', 'on', true);

  UPDATE attendance_punches SET latitude = NULL, longitude = NULL, distance_m = NULL
   WHERE punched_at < p_location_before AND (latitude IS NOT NULL OR longitude IS NOT NULL);
  GET DIAGNOSTICS v_locations = ROW_COUNT;

  -- the log line stays (who, when, model, prompt version, human action); the texts go
  UPDATE ai_interactions SET input_text = '[removed after retention period]', output_text = NULL
   WHERE created_at < p_ai_text_before AND input_text <> '[removed after retention period]';
  GET DIAGNOSTICS v_ai = ROW_COUNT;

  -- staged rows of finished migration batches (the records themselves are kept)
  UPDATE import_rows r SET data = '{}'::jsonb
    FROM import_batches b
   WHERE b.id = r.batch_id AND b.state IN ('signed_off', 'rolled_back', 'discarded')
     AND b.updated_at < p_staging_before AND r.data <> '{}'::jsonb;
  GET DIAGNOSTICS v_staging = ROW_COUNT;

  -- applicants past their retention date who were never hired: the person goes, the
  -- counts stay (how many applied for an opening is not personal data)
  IF p_applicant_before IS NOT NULL THEN
    UPDATE applicants a
       SET full_name_en = '[removed after retention period]',
           full_name_bn = NULL,
           phone = NULL,
           email = NULL,
           district = NULL,
           date_of_birth = NULL,
           gender = NULL,
           source_detail = NULL,
           cv_file_key = NULL,
           cv_file_name = NULL,
           cv_text = NULL,
           redacted_at = now()
     WHERE a.redacted_at IS NULL
       AND a.retention_until < p_applicant_before::date
       -- floor: data newer than 90 days is never cleared, whatever the caller passes
       AND a.consent_at < now() - interval '90 days'
       AND NOT EXISTS (
         SELECT 1 FROM applications p WHERE p.applicant_id = a.id AND p.state = 'hired'
       );
    GET DIAGNOSTICS v_applicants = ROW_COUNT;
  END IF;

  PERFORM set_config('app.retention', 'off', true);
  RETURN jsonb_build_object(
    'punchLocations', v_locations, 'aiTexts', v_ai, 'stagedRows', v_staging,
    'applicants', v_applicants
  );
END
$$;
REVOKE ALL ON FUNCTION retention_apply(timestamptz, timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_apply(timestamptz, timestamptz, timestamptz, timestamptz) TO erp_app;

-- Note on the applicant step: nothing is deleted, the person is blanked out. The row stays
-- so "how many applied for this opening" keeps working, and an applicant who WAS hired is
-- never touched, because their details are now an employee record with its own retention.
