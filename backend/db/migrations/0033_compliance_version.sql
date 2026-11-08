-- =============================================================================
-- 0033  compliance_items.version (WP21): the touch trigger bumps it on every update
--       (0032 created the table without it).
-- =============================================================================

ALTER TABLE compliance_items ADD COLUMN version integer NOT NULL DEFAULT 1;
