-- =============================================================================
-- 0047  Expiry alerts for employee documents (Phase 3 WP31)
--
-- An employee document with an expiry date (contract, NID copy, work permit, licence) is
-- listed by GET /companies/:id/document-expiries, but nothing told HR about it. These three
-- flags make the reminder sendable ONCE per document per stage, the same way the compliance
-- calendar (WP21) and the collection reminders (WP27) do it: the flag is set first, and the
-- event is published only by the call that set it, so two workers or a replay send one alert
-- between them.
--
-- Company renewals (trade licence, insurance, vendor agreements) stay the compliance
-- calendar's job: it already reminds at 7 days, 1 day and overdue for any item kind.
-- =============================================================================

ALTER TABLE employee_documents ADD COLUMN reminded_30 boolean NOT NULL DEFAULT false;
ALTER TABLE employee_documents ADD COLUMN reminded_7 boolean NOT NULL DEFAULT false;
ALTER TABLE employee_documents ADD COLUMN reminded_expired boolean NOT NULL DEFAULT false;
GRANT UPDATE (reminded_30, reminded_7, reminded_expired) ON employee_documents TO erp_app;

-- the job reads exactly this: active documents of active people with a date, not yet alerted
CREATE INDEX employee_documents_expiring ON employee_documents (tenant_id, expires_on)
  WHERE status = 'active' AND expires_on IS NOT NULL;
