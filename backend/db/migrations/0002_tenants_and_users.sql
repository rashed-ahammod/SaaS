-- =============================================================================
-- 0002  Tenants and user logins (guide §7.1, §7.2)
--
-- Roles, permissions, scopes and the employee link are added in WP1/WP2.
-- =============================================================================

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short workspace code typed on the login screen, e.g. "acme".
  slug        text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name        text NOT NULL,
  plan_tier   text NOT NULL DEFAULT 'core' CHECK (plan_tier IN ('core', 'business', 'intelligent')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'suspended', 'closed')),
  data_region text NOT NULL DEFAULT 'bd',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- The tenants table has no tenant_id column: a tenant may see only its own row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants
  USING      (id = app_current_tenant_id())
  WITH CHECK (id = app_current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tenants TO erp_app;

-- Login happens before the tenant is known. This function is the only way to
-- turn a workspace slug into a tenant id without a tenant context. It returns
-- the id only, never other tenant data.
CREATE POLICY owner_slug_lookup ON tenants FOR SELECT TO erp_owner USING (true);

CREATE FUNCTION auth_find_tenant_id(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
  AS $$ SELECT id FROM tenants WHERE slug = lower(p_slug) AND status IN ('trial', 'active') $$;

REVOKE ALL ON FUNCTION auth_find_tenant_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_find_tenant_id(text) TO erp_app;


CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  email               text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  phone               text CHECK (phone ~ '^\+?[0-9]{8,15}$'),
  password_hash       text NOT NULL,                 -- argon2id
  mfa_secret          text,                          -- TOTP secret, encrypted (field-encryption.ts)
  mfa_enabled         boolean NOT NULL DEFAULT false,
  mfa_last_time_step  bigint,                        -- blocks re-use of the same 2FA code
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  preferred_language  text NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('bn', 'en')),
  employee_id         uuid,                          -- foreign key added with the employees table (WP1)
  failed_login_count  integer NOT NULL DEFAULT 0,
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX users_email_per_tenant ON users (tenant_id, email);
CREATE UNIQUE INDEX users_phone_per_tenant ON users (tenant_id, phone) WHERE phone IS NOT NULL;
CREATE TRIGGER touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION app_touch_row();

SELECT app_secure_tenant_table('users');
