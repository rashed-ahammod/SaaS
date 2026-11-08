-- =============================================================================
-- 0017  Pilot readiness (guide §20, §22; spec §11; WP12)
--
--   employee_consents      consent for biometric, phone-location and selfie
--                          attendance data: append-only history, latest row counts
--   retention_apply()      clears personal data that is past its retention period,
--                          for the current tenant (worker job, daily)
--   system_job_runs        last run and result of every background job (monitoring)
-- =============================================================================

-- ---------------------------------------------------------------- consent

CREATE TABLE employee_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id     uuid NOT NULL,
  --   biometric_attendance  fingerprint / face device (templates stay on the device; the ERP keeps the device user number)
  --   location_attendance   phone punch with location (geo-fence)
  --   selfie_attendance     photo at punch (not used in Phase 1; listed so consent can be collected up front)
  purpose         text NOT NULL CHECK (purpose IN ('biometric_attendance', 'location_attendance', 'selfie_attendance')),
  granted         boolean NOT NULL,                 -- false = refused or withdrawn
  notice_version  text NOT NULL,                    -- the notice text shown (consent-notices.ts)
  method          text NOT NULL CHECK (method IN ('app', 'paper')),
  document_id     uuid,                             -- scanned paper form (employee document), for method = paper
  recorded_by     uuid DEFAULT app_current_user_id(),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX employee_consents_latest ON employee_consents (tenant_id, employee_id, purpose, recorded_at DESC);
SELECT app_secure_tenant_table('employee_consents', 'SELECT, INSERT');
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON employee_consents FOR EACH ROW EXECUTE FUNCTION app_reject_change();


-- ---------------------------------------------------------------- retention

-- Punches stay append-only, except that the retention job may blank the
-- location of old phone punches (the time stays; attendance does not change).
CREATE FUNCTION attendance_punch_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.retention', true) = 'on'
     AND NEW.latitude IS NULL AND NEW.longitude IS NULL AND NEW.distance_m IS NULL
     AND (NEW.id, NEW.tenant_id, NEW.employee_id, NEW.punched_at, NEW.source, NEW.device_ref, NEW.raw_ref, NEW.received_at, NEW.created_by)
         IS NOT DISTINCT FROM
         (OLD.id, OLD.tenant_id, OLD.employee_id, OLD.punched_at, OLD.source, OLD.device_ref, OLD.raw_ref, OLD.received_at, OLD.created_by)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;
DROP TRIGGER append_only ON attendance_punches;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON attendance_punches FOR EACH ROW EXECUTE FUNCTION attendance_punch_guard();

-- Runs as the owner but row-level security still limits it to app.tenant_id,
-- so it can only touch the tenant the caller opened.
CREATE FUNCTION retention_apply(p_location_before timestamptz, p_ai_text_before timestamptz, p_staging_before timestamptz)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_locations integer;
  v_ai integer;
  v_staging integer;
BEGIN
  IF app_current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'retention_apply needs a tenant';
  END IF;
  -- floors, so a wrong or malicious call can never remove recent data
  IF p_location_before > now() - interval '90 days' OR p_ai_text_before > now() - interval '180 days'
     OR p_staging_before > now() - interval '30 days' THEN
    RAISE EXCEPTION 'retention_apply: periods shorter than the minimum (90 / 180 / 30 days)';
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

  PERFORM set_config('app.retention', 'off', true);
  RETURN jsonb_build_object('punchLocations', v_locations, 'aiTexts', v_ai, 'stagedRows', v_staging);
END
$$;
REVOKE ALL ON FUNCTION retention_apply(timestamptz, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_apply(timestamptz, timestamptz, timestamptz) TO erp_app;


-- ---------------------------------------------------------------- monitoring

-- Global (not tenant data): one row per background job, updated after every run.
CREATE TABLE system_job_runs (
  job            text PRIMARY KEY,
  last_started   timestamptz,
  last_finished  timestamptz,
  last_ok        timestamptz,
  last_error     text,
  failures       integer NOT NULL DEFAULT 0,       -- failures in a row (0 after a success)
  details        jsonb NOT NULL DEFAULT '{}'
);
GRANT SELECT, INSERT, UPDATE ON system_job_runs TO erp_worker;
GRANT SELECT ON system_job_runs TO erp_app;

-- Counts for alerts across all tenants, read by the worker role (no tenant data leaves: only numbers).
GRANT SELECT ON ai_interactions TO erp_worker;
CREATE POLICY worker_metrics ON ai_interactions FOR SELECT TO erp_worker USING (true);
