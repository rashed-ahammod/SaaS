-- =============================================================================
-- 0008  Compliance rule pack (spec §7, guide §18)
--
-- Every statutory or tax value (maternity days, festival holidays, overtime
-- rate, tax slabs ...) is data, never code:
--
--   rule_packs          a published version, e.g. BD-LABOUR 2026.1        (central)
--   rule_values         dated values inside a pack, with source and status (central)
--   rule_value_history  who created / verified / unverified a value       (central)
--   tenant_rule_packs   which pack version a tenant uses, from which date (per tenant)
--
-- The central tables have NO tenant_id: a pack is published once for every
-- customer and belongs to none of them (documented exception to guide §5
-- rule 2, ADR 0006). The API role may only read them; publishing and
-- verification are operator tools (scripts/rules.ts) running as erp_owner.
-- =============================================================================

CREATE TABLE rule_packs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,30}$'),          -- e.g. BD-LABOUR
  version      text NOT NULL CHECK (version ~ '^[0-9]{4}\.[0-9]{1,3}$'),  -- e.g. 2026.1
  title        text NOT NULL,
  notes        text,
  status       text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'retired')),
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text NOT NULL,
  UNIQUE (code, version)
);

CREATE TABLE rule_values (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id        uuid NOT NULL REFERENCES rule_packs (id),
  rule_key       text NOT NULL CHECK (rule_key ~ '^[a-z_]+(\.[a-z_0-9]+)+$'),   -- e.g. leave.maternity.days
  value_type     text NOT NULL CHECK (value_type IN ('integer', 'decimal', 'money', 'boolean', 'text', 'json')),
  value          jsonb NOT NULL,
  unit           text,                             -- e.g. days, months, percent, multiplier
  description_en text NOT NULL,
  description_bn text,
  effective_from date NOT NULL,
  effective_to   date,                             -- exclusive; NULL = until further notice
  source_url     text,                             -- official gazette / NBR document once verified
  source_note    text,
  -- 'verify' values may be used in development and tests only (guide §18)
  status         text NOT NULL DEFAULT 'verify' CHECK (status IN ('verify', 'verified')),
  verified_by    text,
  verified_at    timestamptz,
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (status = 'verify' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL AND source_url IS NOT NULL)),
  -- one value per key per day inside a pack
  CONSTRAINT rule_values_no_overlap EXCLUDE USING gist (
    pack_id WITH =,
    rule_key WITH =,
    daterange(effective_from, effective_to, '[)') WITH &&
  )
);
CREATE INDEX rule_values_lookup ON rule_values (pack_id, rule_key, effective_from);

-- A published value never changes; only its verification status may.
-- A correction is a new pack version.
CREATE FUNCTION rule_values_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'rule_values: values are never deleted; publish a new pack version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.pack_id IS DISTINCT FROM OLD.pack_id
     OR NEW.rule_key IS DISTINCT FROM OLD.rule_key
     OR NEW.value_type IS DISTINCT FROM OLD.value_type
     OR NEW.value IS DISTINCT FROM OLD.value
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
    RAISE EXCEPTION 'rule_values: a published value cannot be changed; publish a new pack version' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard BEFORE UPDATE OR DELETE ON rule_values FOR EACH ROW EXECUTE FUNCTION rule_values_guard();

CREATE TABLE rule_value_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_value_id uuid NOT NULL REFERENCES rule_values (id),
  action        text NOT NULL CHECK (action IN ('published', 'verified', 'unverified')),
  by_name       text NOT NULL,                 -- the compliance owner, e.g. "Adv. Nasrin Sultana (labour counsel)"
  source_url    text,
  note          text,
  at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER append_only BEFORE UPDATE OR DELETE ON rule_value_history
  FOR EACH ROW EXECUTE FUNCTION app_reject_change();

-- The API reads the published packs; it never writes them.
GRANT SELECT ON rule_packs, rule_values, rule_value_history TO erp_app;


-- Which pack version a tenant uses, from which date (guide §18: "each tenant
-- accepts a version with an effective date"). The latest acceptance on or
-- before a date decides which pack answers for that date.
CREATE TABLE tenant_rule_packs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  pack_id        uuid NOT NULL REFERENCES rule_packs (id),
  effective_from date NOT NULL,
  accepted_by    uuid DEFAULT app_current_user_id(),
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  note           text,
  UNIQUE (tenant_id, effective_from)
);
SELECT app_secure_tenant_table('tenant_rule_packs', 'SELECT, INSERT');
