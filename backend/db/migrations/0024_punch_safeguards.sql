-- =============================================================================
-- 0024  Phone punch safeguards (attendance misuse review, 2026-10-17)
--
-- A browser cannot prove where a phone is (fake GPS, location override, hand-made
-- requests), so the system keeps evidence and looks for patterns instead:
--
--   attendance_punches  + accuracy_m, ip, user_agent   (what the phone and the network said)
--   punch_attempts      refused phone punches: outside the area, weak GPS, unknown phone,
--                       no geo-fence set; append-only, for the HR punch review
--
-- Retention (WP12): after the location period, coordinates, accuracy, IP and browser
-- are blanked on both tables; the times stay.
-- =============================================================================

ALTER TABLE attendance_punches ADD COLUMN accuracy_m integer CHECK (accuracy_m >= 0);
ALTER TABLE attendance_punches ADD COLUMN ip text;
ALTER TABLE attendance_punches ADD COLUMN user_agent text;

CREATE TABLE punch_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id   uuid NOT NULL,
  attempted_at  timestamptz NOT NULL DEFAULT now(),
  outcome       text NOT NULL CHECK (outcome IN ('outside_area', 'weak_gps', 'unknown_device', 'no_geofence')),
  branch_id     uuid,
  device_ref    text,
  latitude      double precision,
  longitude     double precision,
  accuracy_m    integer,
  distance_m    integer,
  ip            text,
  user_agent    text,
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
CREATE INDEX punch_attempts_employee ON punch_attempts (tenant_id, employee_id, attempted_at);
SELECT app_secure_tenant_table('punch_attempts', 'SELECT, INSERT');

-- append-only, except the retention job blanking the personal data
CREATE FUNCTION punch_attempt_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.retention', true) = 'on'
     AND NEW.latitude IS NULL AND NEW.longitude IS NULL AND NEW.ip IS NULL AND NEW.user_agent IS NULL
     AND (NEW.id, NEW.tenant_id, NEW.employee_id, NEW.attempted_at, NEW.outcome)
         IS NOT DISTINCT FROM (OLD.id, OLD.tenant_id, OLD.employee_id, OLD.attempted_at, OLD.outcome)
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON punch_attempts FOR EACH ROW EXECUTE FUNCTION punch_attempt_guard();

-- the punch guard: the retention job may now also blank accuracy, IP and browser
CREATE OR REPLACE FUNCTION attendance_punch_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.retention', true) = 'on'
     AND NEW.latitude IS NULL AND NEW.longitude IS NULL AND NEW.distance_m IS NULL
     AND NEW.accuracy_m IS NULL AND NEW.ip IS NULL AND NEW.user_agent IS NULL
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

CREATE OR REPLACE FUNCTION retention_apply(p_location_before timestamptz, p_ai_text_before timestamptz, p_staging_before timestamptz)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  v_locations integer;
  v_attempts integer;
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

  UPDATE attendance_punches SET latitude = NULL, longitude = NULL, distance_m = NULL, accuracy_m = NULL, ip = NULL, user_agent = NULL
   WHERE punched_at < p_location_before
     AND (latitude IS NOT NULL OR longitude IS NOT NULL OR ip IS NOT NULL OR user_agent IS NOT NULL OR accuracy_m IS NOT NULL);
  GET DIAGNOSTICS v_locations = ROW_COUNT;

  UPDATE punch_attempts SET latitude = NULL, longitude = NULL, ip = NULL, user_agent = NULL
   WHERE attempted_at < p_location_before AND (latitude IS NOT NULL OR longitude IS NOT NULL OR ip IS NOT NULL OR user_agent IS NOT NULL);
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

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
  RETURN jsonb_build_object('punchLocations', v_locations + v_attempts, 'aiTexts', v_ai, 'stagedRows', v_staging);
END
$$;
