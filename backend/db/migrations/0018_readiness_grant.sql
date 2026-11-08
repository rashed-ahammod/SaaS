-- =============================================================================
-- 0018  Readiness check (WP12): the API may read which migrations are applied,
-- so GET /health/ready can refuse traffic until a deploy's migrations have run.
-- =============================================================================

GRANT SELECT ON schema_migrations TO erp_app;
