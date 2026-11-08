-- =============================================================================
-- 0006  Roles, scopes, field grants, delegations (spec §4, guide §7.2, §8)
--
-- Access = role x scope x field sensitivity.
--   * The seven SYSTEM roles (admin, system_admin, hr, accounts, dept_head,
--     employee, auditor) are defined in code (src/modules/identity/access/roles.ts)
--     and are the same for every tenant; they cannot be edited, only copied.
--   * CUSTOM roles are copies stored per tenant (custom_roles + permissions).
--   * user_roles gives a user one role with one scope:
--       own        - only the user's own employee record
--       department - a department and everything below it (scope_id = department)
--       company    - one company (scope_id = company)
--       group      - every company of the tenant
-- =============================================================================

-- Composite keys below reference users (tenant_id, id).
ALTER TABLE users ADD CONSTRAINT users_tenant_id_id UNIQUE (tenant_id, id);

CREATE TABLE custom_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  name_en     text NOT NULL,
  name_bn     text,
  -- the system role it was copied from; decides whether it is privileged (2FA)
  based_on    text NOT NULL CHECK (based_on IN ('admin', 'system_admin', 'hr', 'accounts', 'dept_head', 'employee', 'auditor')),
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT app_current_user_id(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  version     integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name_en)
);
CREATE TRIGGER touch BEFORE UPDATE ON custom_roles FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('custom_roles', 'SELECT, INSERT, UPDATE');

CREATE TABLE custom_role_permissions (
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  role_id        uuid NOT NULL,
  permission_key text NOT NULL CHECK (permission_key ~ '^[a-z_]+(\.[a-z_]+)+$'),
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES custom_roles (tenant_id, id)
);
SELECT app_secure_tenant_table('custom_role_permissions', 'SELECT, INSERT, DELETE');


CREATE TABLE user_roles (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  user_id        uuid NOT NULL,
  system_role    text CHECK (system_role IN ('admin', 'system_admin', 'hr', 'accounts', 'dept_head', 'employee', 'auditor')),
  custom_role_id uuid,
  scope_type     text NOT NULL CHECK (scope_type IN ('own', 'department', 'company', 'group')),
  scope_id       uuid,                 -- department or company id; NULL for own / group
  expires_at     timestamptz,          -- time-limited access (e.g. external auditor)
  granted_by     uuid DEFAULT app_current_user_id(),
  granted_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoke_reason  text,
  CHECK ((system_role IS NULL) <> (custom_role_id IS NULL)),           -- exactly one kind of role
  CHECK ((scope_type IN ('own', 'group')) = (scope_id IS NULL)),       -- scope id only where needed
  CHECK (revoked_at IS NULL OR revoke_reason IS NOT NULL),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, custom_role_id) REFERENCES custom_roles (tenant_id, id)
);
-- The same role and scope cannot be granted twice while active.
CREATE UNIQUE INDEX user_roles_active_unique ON user_roles
  (tenant_id, user_id, coalesce(system_role, custom_role_id::text), scope_type, coalesce(scope_id, '00000000-0000-0000-0000-000000000000'))
  WHERE revoked_at IS NULL;
CREATE INDEX user_roles_user ON user_roles (tenant_id, user_id) WHERE revoked_at IS NULL;
CREATE INDEX user_roles_system_role ON user_roles (tenant_id, system_role) WHERE revoked_at IS NULL;
-- UPDATE is only used to revoke.
SELECT app_secure_tenant_table('user_roles', 'SELECT, INSERT, UPDATE');


-- Extra access to sensitive fields (spec §4: salary, bank, NID, complaints need a grant).
CREATE TABLE field_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  user_id       uuid NOT NULL,
  field_group   text NOT NULL CHECK (field_group IN ('salary', 'bank', 'identity', 'complaint')),
  granted_by    uuid DEFAULT app_current_user_id(),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  revoke_reason text,
  CHECK (revoked_at IS NULL OR revoke_reason IS NOT NULL),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users (tenant_id, id)
);
CREATE UNIQUE INDEX field_grants_active_unique ON field_grants (tenant_id, user_id, field_group) WHERE revoked_at IS NULL;
SELECT app_secure_tenant_table('field_grants', 'SELECT, INSERT, UPDATE');


-- An approver hands their approvals to someone else for a date range (spec §4).
CREATE TABLE delegations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  from_user_id  uuid NOT NULL,
  to_user_id    uuid NOT NULL,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid DEFAULT app_current_user_id(),
  revoked_at    timestamptz,
  revoked_by    uuid,
  CHECK (from_user_id <> to_user_id),
  CHECK (ends_on >= starts_on),
  FOREIGN KEY (tenant_id, from_user_id) REFERENCES users (tenant_id, id),
  FOREIGN KEY (tenant_id, to_user_id) REFERENCES users (tenant_id, id)
);
CREATE INDEX delegations_to ON delegations (tenant_id, to_user_id) WHERE revoked_at IS NULL;
SELECT app_secure_tenant_table('delegations', 'SELECT, INSERT, UPDATE');


-- -----------------------------------------------------------------------------
-- Salary bank / mobile-wallet accounts (guide §7.3). Owned by the bank-accounts module.
-- A new account starts 'pending' and becomes 'approved' only through the
-- approval engine; the previously approved account is then 'retired'.
-- -----------------------------------------------------------------------------
CREATE TABLE employee_bank_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  employee_id         uuid NOT NULL,
  kind                text NOT NULL CHECK (kind IN ('bank', 'wallet')),
  provider            text NOT NULL,          -- bank name, or wallet: bkash / nagad / rocket / upay
  details_encrypted   text NOT NULL,          -- account name, number, routing number ... (encrypted JSON)
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'retired')),
  approval_request_id uuid,
  approved_at         timestamptz,
  retired_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid DEFAULT app_current_user_id(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, employee_id) REFERENCES employees (tenant_id, id)
);
-- At most one approved and one pending account per employee.
CREATE UNIQUE INDEX one_approved_bank_account ON employee_bank_accounts (tenant_id, employee_id) WHERE status = 'approved';
CREATE UNIQUE INDEX one_pending_bank_account ON employee_bank_accounts (tenant_id, employee_id) WHERE status = 'pending';
CREATE TRIGGER touch BEFORE UPDATE ON employee_bank_accounts FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('employee_bank_accounts', 'SELECT, INSERT, UPDATE');
