-- =============================================================================
-- 0016  AI gateway, Phase 1 (spec §8, guide §16; WP11)
--
--   ai_settings            per tenant: AI on/off, each feature on/off, quota override
--   ai_usage               calls and tokens per tenant x month x feature (metered cost)
--   ai_interactions        every AI output: who, feature, model, prompt version,
--                          masked input, output, and what the human did with it
--   ai_policy_documents    the tenant's own policy texts (the assistant answers from these)
--   ai_policy_chunks       the same texts cut into searchable pieces (full-text search)
--   ai_release_gates       results of the fixed test set per model x prompt version
--                          (global, written by the eval script with the owner role)
-- =============================================================================

CREATE TABLE ai_settings (
  tenant_id                 uuid PRIMARY KEY DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  enabled                   boolean NOT NULL DEFAULT false,
  assistant_enabled         boolean NOT NULL DEFAULT true,
  payroll_explain_enabled   boolean NOT NULL DEFAULT true,
  -- set by the platform operator (sold credits); null = the plan tier's included quota
  monthly_quota             integer CHECK (monthly_quota >= 0),
  extra_credits             integer NOT NULL DEFAULT 0 CHECK (extra_credits >= 0),
  updated_by                uuid,
  updated_at                timestamptz NOT NULL DEFAULT now()
);
SELECT app_secure_tenant_table('ai_settings', 'SELECT');
-- the tenant's admin switches features; the quota columns stay with the platform operator
GRANT INSERT (tenant_id, enabled, assistant_enabled, payroll_explain_enabled, updated_by, updated_at) ON ai_settings TO erp_app;
GRANT UPDATE (enabled, assistant_enabled, payroll_explain_enabled, updated_by, updated_at) ON ai_settings TO erp_app;


CREATE TABLE ai_usage (
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  month          text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  feature        text NOT NULL CHECK (feature IN ('assistant', 'payroll_flag_explanation')),
  calls          integer NOT NULL DEFAULT 0,
  input_tokens   bigint NOT NULL DEFAULT 0,
  output_tokens  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, month, feature)
);
SELECT app_secure_tenant_table('ai_usage', 'SELECT, INSERT, UPDATE');


CREATE TABLE ai_interactions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  user_id         uuid NOT NULL,
  feature         text NOT NULL CHECK (feature IN ('assistant', 'payroll_flag_explanation')),
  provider        text NOT NULL,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  language        text NOT NULL CHECK (language IN ('bn', 'en')),
  -- what it was about, e.g. "question" or "payroll_flag:<id>"
  input_ref       text NOT NULL,
  -- the input as sent, after masking (never contains NID, bank or tax numbers)
  input_text      text NOT NULL,
  output_text     text,
  tools_used      jsonb NOT NULL DEFAULT '[]',
  sources         jsonb NOT NULL DEFAULT '[]',     -- policy pieces the answer was based on
  --   ok  answered     refused  the model declined     timeout / error  no answer, normal screens still work
  status          text NOT NULL CHECK (status IN ('ok', 'refused', 'timeout', 'error')),
  error           text,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  latency_ms      integer NOT NULL DEFAULT 0,
  -- what the human did with the output (spec §8 guardrail 6)
  human_action    text CHECK (human_action IN ('helpful', 'not_helpful')),
  human_note      text,
  acted_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_interactions_recent ON ai_interactions (tenant_id, created_at DESC);
CREATE INDEX ai_interactions_ref ON ai_interactions (tenant_id, input_ref, language) WHERE status = 'ok';
SELECT app_secure_tenant_table('ai_interactions', 'SELECT, INSERT, UPDATE');


CREATE TABLE ai_policy_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  title           text NOT NULL,
  language        text NOT NULL CHECK (language IN ('bn', 'en')),
  body            text NOT NULL,
  chunks          integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT true,
  uploaded_by     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deactivated_at  timestamptz
);
SELECT app_secure_tenant_table('ai_policy_documents', 'SELECT, INSERT, UPDATE');


CREATE TABLE ai_policy_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  document_id  uuid NOT NULL REFERENCES ai_policy_documents (id),
  chunk_no     integer NOT NULL,
  heading      text NOT NULL DEFAULT '',
  content      text NOT NULL,
  -- 'simple' keeps Bangla words as they are; 'english' adds stemming for English
  tsv          tsvector GENERATED ALWAYS AS (
                 to_tsvector('simple', heading || ' ' || content) || to_tsvector('english', heading || ' ' || content)
               ) STORED,
  UNIQUE (document_id, chunk_no)
);
CREATE INDEX ai_policy_chunks_search ON ai_policy_chunks USING gin (tsv);
SELECT app_secure_tenant_table('ai_policy_chunks', 'SELECT, INSERT');


-- Global: one row per run of the fixed test set (guide §16 release gate).
CREATE TABLE ai_release_gates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature         text NOT NULL,
  provider        text NOT NULL,
  model           text NOT NULL,
  prompt_version  text NOT NULL,
  cases           integer NOT NULL,
  passed_cases    integer NOT NULL,
  pass_rate       numeric(5, 4) NOT NULL,
  required_rate   numeric(5, 4) NOT NULL,
  passed          boolean NOT NULL,
  details         jsonb NOT NULL DEFAULT '[]',
  run_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_release_gates_lookup ON ai_release_gates (feature, model, prompt_version, run_at DESC);
GRANT SELECT ON ai_release_gates TO erp_app;
