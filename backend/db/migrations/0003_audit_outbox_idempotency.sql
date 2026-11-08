-- =============================================================================
-- 0003  Platform tables: audit log, event outbox, idempotency keys (guide §7.8)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Audit log (guide §14)
-- Append-only and tamper-evident: per tenant, each row stores
--   hash = SHA-256(prev_hash || canonical_json(entry))
-- Written only through AuditService.record(), in the same transaction as the change.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  tenant_id     uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  seq           bigint NOT NULL,                 -- 1, 2, 3 ... per tenant, no gaps
  occurred_at   timestamptz NOT NULL,
  actor_user_id uuid,                            -- NULL for system jobs
  action        text NOT NULL,                   -- e.g. 'auth.login', 'leave.approved'
  entity        text NOT NULL,                   -- e.g. 'user', 'leave_request'
  entity_id     text,
  before        jsonb,
  after         jsonb,
  ip            text,
  device        text,
  prev_hash     text NOT NULL,
  hash          text NOT NULL,
  PRIMARY KEY (tenant_id, seq)
);

-- erp_app may read and append, never change (guide §14).
SELECT app_secure_tenant_table('audit_log', 'SELECT, INSERT');
-- Even the table owner cannot edit or delete entries.
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app_reject_change();
CREATE TRIGGER append_only_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION app_reject_change();

-- The nightly verifier re-computes every tenant's chain.
CREATE POLICY worker_verify ON audit_log FOR SELECT TO erp_worker USING (true);
GRANT SELECT ON audit_log TO erp_worker;


-- ---------------------------------------------------------------------------
-- Event outbox (guide §15)
-- Written in the same transaction as the business change; the dispatcher
-- (erp_worker) sends pending rows to n8n as signed webhooks.
-- ---------------------------------------------------------------------------
CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- event ID; receivers de-duplicate on it
  seq             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- dispatch order
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  type            text NOT NULL CHECK (type ~ '^[a-z_]+(\.[a-z_]+)+$'),   -- e.g. 'leave.approved'
  entity_id       text,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid DEFAULT app_current_user_id(),
  sent_at         timestamptz
);

CREATE INDEX outbox_events_due ON outbox_events (next_attempt_at, seq) WHERE status = 'pending';
CREATE INDEX outbox_events_dead ON outbox_events (tenant_id, created_at) WHERE status = 'dead';

-- erp_app writes events and may re-queue dead ones (System Admin "replay").
SELECT app_secure_tenant_table('outbox_events', 'SELECT, INSERT, UPDATE');

-- The dispatcher works across all tenants, but only on this table.
CREATE POLICY worker_dispatch ON outbox_events TO erp_worker USING (true) WITH CHECK (true);
GRANT SELECT, UPDATE ON outbox_events TO erp_worker;


-- ---------------------------------------------------------------------------
-- Idempotency keys (guide §5 rule 7)
-- A repeated Idempotency-Key returns the stored first response.
-- ---------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  key             text NOT NULL CHECK (length(key) BETWEEN 8 AND 200),
  user_id         uuid,
  endpoint        text NOT NULL,                  -- "POST /leave/requests"
  request_hash    text NOT NULL,                  -- same key + different body = error
  response_status integer,
  response_body   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

SELECT app_secure_tenant_table('idempotency_keys', 'SELECT, INSERT, UPDATE');

-- Keys are kept at least 7 days, then the worker removes them.
CREATE POLICY worker_cleanup ON idempotency_keys TO erp_worker
  USING (created_at < now() - interval '7 days');
GRANT SELECT, DELETE ON idempotency_keys TO erp_worker;
