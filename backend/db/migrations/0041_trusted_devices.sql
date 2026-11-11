-- =============================================================================
-- 0041  "Remember this device" for two-step verification (2026-11-11; spec §11)
--
--   trusted_devices   one row per device a user chose to trust. After the code
--                     has been entered once on that device, the next sign-in
--                     needs the password only — the second factor is skipped
--                     until the row expires (30 days) or is revoked.
--
-- What this does NOT weaken: the password is still required every time, the
-- step-up code for high-risk actions (role grants, bank-account changes) is
-- still asked for, and a device the user does not tick is never remembered.
--
-- Only the SHA-256 of the device token is stored, never the token itself, so a
-- copy of this table cannot be used to sign in — the same reasoning as password
-- hashes. The token lives in an httpOnly cookie on that one device.
-- =============================================================================

CREATE TABLE trusted_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  -- SHA-256 of the token, hex. Unique so a token identifies at most one device.
  token_hash   text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  -- what the user sees in the list: the browser's user agent, shortened
  label        text,
  created_ip   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  CHECK (expires_at > created_at)
);

-- The login path looks a device up by its hash inside the tenant.
CREATE INDEX trusted_devices_user ON trusted_devices (tenant_id, user_id)
  WHERE revoked_at IS NULL;

SELECT app_secure_tenant_table('trusted_devices');
