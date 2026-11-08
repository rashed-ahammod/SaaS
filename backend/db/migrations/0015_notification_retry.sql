-- =============================================================================
-- 0015  Retrying undelivered messages (WP10)
--
-- n8n answers the webhook as soon as the signature checks out and sends the
-- messages afterwards, so the dispatcher never waits for a slow mail run.
-- The worker therefore looks for messages that failed or got stuck and sends
-- their event to n8n again; claim() then hands out only those messages.
-- =============================================================================

GRANT SELECT ON notifications TO erp_worker;
CREATE POLICY worker_retry ON notifications TO erp_worker USING (true);
