-- =============================================================================
-- 0001  Platform helpers used by every later migration
--
-- Roles (created by scripts/db-setup.ts, see docs/adr/0002):
--   erp_owner  owns all tables and runs migrations
--   erp_app    used by the API: no BYPASSRLS, not the owner, so RLS always applies
--   erp_worker used by background jobs; gets narrow, explicit policies per table
-- =============================================================================

-- The tenant of the current transaction, set by the API with
--   SELECT set_config('app.tenant_id', '<uuid>', true)   -- "true" = SET LOCAL
-- Returns NULL when not set, so every tenant_isolation policy matches nothing
-- (fail closed, guide §6).
CREATE FUNCTION app_current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

-- The user acting in the current transaction (used for created_by and audit).
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Turns on row-level security for a tenant-owned table and grants the API role
-- the given privileges. EVERY table with a tenant_id column must call this
-- (checked by test/integration/rls-coverage.int-spec.ts).
--
--   SELECT app_secure_tenant_table('employees');                       -- full CRUD for erp_app
--   SELECT app_secure_tenant_table('audit_log', 'SELECT, INSERT');     -- append-only
CREATE FUNCTION app_secure_tenant_table(
  tbl regclass,
  app_privileges text DEFAULT 'SELECT, INSERT, UPDATE, DELETE'
) RETURNS void
  LANGUAGE plpgsql
  AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  -- FORCE: RLS applies to the table owner as well.
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format(
    'CREATE POLICY tenant_isolation ON %s
       USING      (tenant_id = app_current_tenant_id())
       WITH CHECK (tenant_id = app_current_tenant_id())', tbl);
  EXECUTE format('GRANT %s ON %s TO erp_app', app_privileges, tbl);
END
$$;

-- Keeps updated_at and the optimistic-locking version column current.
-- Attach to editable tables:
--   CREATE TRIGGER touch BEFORE UPDATE ON <table> FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE FUNCTION app_touch_row() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := OLD.version + 1;
  RETURN NEW;
END
$$;

-- Raises an error for any UPDATE or DELETE. Used on append-only tables
-- (audit log; later posted payroll and journals - guide §5 rule 3).
CREATE FUNCTION app_reject_change() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END
$$;
