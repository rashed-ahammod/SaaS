-- =============================================================================
-- 0014  Notifications (spec §9, guide §15; WP10)
--
-- The core decides WHO gets WHAT (recipients, language, text); n8n only carries
-- email / SMS and reports back. In-app messages are delivered by the core itself.
--
--   notification_events   one row per outbox event already turned into messages
--   notifications         one message: event x kind x recipient x channel, UNIQUE,
--                         so replaying an event can never create a second message;
--                         a message is handed to n8n only while it is not sent yet
-- =============================================================================

CREATE TABLE notification_events (
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  event_id    uuid NOT NULL,
  event_type  text NOT NULL,
  messages    integer NOT NULL DEFAULT 0,
  planned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, event_id)
);
SELECT app_secure_tenant_table('notification_events', 'SELECT, INSERT');


CREATE TABLE notifications (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  event_id            uuid NOT NULL,
  event_type          text NOT NULL,
  -- approval_request, approval_reminder, approval_escalated, approval_passed_on,
  -- payslip_ready, attendance_digest, leave_decision
  kind                text NOT NULL,
  -- "user:<id>" or "employee:<id>" (an employee without a login still gets a payslip)
  recipient_key       text NOT NULL,
  user_id             uuid,                          -- for the in-app inbox
  employee_id         uuid,
  channel             text NOT NULL CHECK (channel IN ('in_app', 'email', 'sms')),
  address             text,                          -- e-mail address or mobile number (null for in-app)
  language            text NOT NULL CHECK (language IN ('bn', 'en')),
  subject             text NOT NULL,
  body                text NOT NULL,
  link                text,                          -- opens the app at the right screen
  attachment          jsonb,                         -- e.g. {"type": "payslip", "runId": "...", "employeeId": "..."}
  --   queued   waiting for n8n          sending  handed to n8n (claimed_at)
  --   sent     delivered to the provider (in-app: shown in the inbox)
  --   failed   every provider refused; handed out again on the next delivery of the event
  status              text NOT NULL CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempts            integer NOT NULL DEFAULT 0,
  claimed_at          timestamptz,
  sent_at             timestamptz,
  provider            text,                          -- e.g. sms-primary, sms-fallback, email
  provider_message_id text,
  last_error          text,
  read_at             timestamptz,                   -- in-app only
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (channel = 'in_app' OR address IS NOT NULL),
  CHECK (channel <> 'in_app' OR user_id IS NOT NULL),
  UNIQUE (tenant_id, event_id, kind, recipient_key, channel)
);
CREATE INDEX notifications_inbox ON notifications (tenant_id, user_id, created_at DESC) WHERE channel = 'in_app';
CREATE INDEX notifications_open ON notifications (tenant_id, event_id) WHERE status IN ('queued', 'sending', 'failed');
SELECT app_secure_tenant_table('notifications', 'SELECT, INSERT, UPDATE');
