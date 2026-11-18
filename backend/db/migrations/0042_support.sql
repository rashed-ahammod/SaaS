-- =============================================================================
-- 0042  Support tickets (Phase 3 WP28; spec §6.8 step 7, §5 "SLA in working hours",
--       §9 events ticket.created and ticket.sla_breached)
--
--   support_categories      what a ticket is about, per company (complaint, delivery,
--                           product fault, billing, ...), each with a default priority
--   support_sla_policies    per company x priority: first response and resolution in
--                           WORKING hours (the same clock as approvals: weekends and
--                           holidays do not count, ADR 0005)
--   support_tickets         the ticket: customer, contact, category, priority, state,
--                           who it is assigned to, the two SLA deadlines and whether each
--                           was breached
--   support_ticket_messages replies to the customer and internal notes, in one thread;
--                           the first reply to the customer stops the response clock
--
-- Guarantees the database itself keeps:
--   - a breach is recorded once per ticket per clock (the breached_at columns are set
--     from NULL only, and the job's UPDATE ... WHERE breached_at IS NULL does it);
--   - a resolved or closed ticket has a resolution note and a resolved_at;
--   - an internal note is never sent to the customer (kind is part of the row, and the
--     customer-visible thread is the 'reply' rows);
--   - the SLA policy of a priority exists once per company.
-- =============================================================================

CREATE TABLE support_categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id        uuid NOT NULL,
  code              text NOT NULL CHECK (code ~ '^[A-Z0-9-]{1,20}$'),
  name              text NOT NULL,
  name_bn           text,
  default_priority  text NOT NULL DEFAULT 'normal' CHECK (default_priority IN ('urgent', 'high', 'normal', 'low')),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON support_categories FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('support_categories', 'SELECT, INSERT, UPDATE');

-- Working hours, not calendar hours (spec §5). Defaults the product ships with are in
-- support-rules.ts and written here the first time a company opens the screen.
CREATE TABLE support_sla_policies (
  tenant_id             uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id            uuid NOT NULL,
  priority              text NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  first_response_hours  numeric(6,2) NOT NULL CHECK (first_response_hours > 0 AND first_response_hours <= 2000),
  resolution_hours      numeric(6,2) NOT NULL CHECK (resolution_hours > 0 AND resolution_hours <= 2000),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  updated_by            uuid DEFAULT app_current_user_id(),
  PRIMARY KEY (tenant_id, company_id, priority),
  CONSTRAINT resolution_after_response CHECK (resolution_hours >= first_response_hours)
);
SELECT app_secure_tenant_table('support_sla_policies', 'SELECT, INSERT, UPDATE');

CREATE TABLE support_tickets (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  company_id               uuid NOT NULL,
  number                   text NOT NULL,                 -- T/2026-27/00001
  customer_id              uuid NOT NULL REFERENCES customers (id),
  contact_id               uuid REFERENCES customer_contacts (id),
  category_id              uuid NOT NULL REFERENCES support_categories (id),
  subject                  text NOT NULL,
  -- what the customer said: outside content, stored and shown as text, never acted on
  -- (spec §8 guardrail 9)
  description              text NOT NULL,
  priority                 text NOT NULL CHECK (priority IN ('urgent', 'high', 'normal', 'low')),
  source                   text NOT NULL DEFAULT 'phone' CHECK (source IN ('phone', 'email', 'walk_in', 'portal', 'field_visit', 'other')),
  state                    text NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'open', 'waiting_customer', 'resolved', 'closed')),
  assignee_id              uuid REFERENCES users (id),
  -- the SLA clock: set when the ticket is raised, moved only when the priority changes
  sla_from                 timestamptz NOT NULL DEFAULT now(),
  first_response_due_at    timestamptz NOT NULL,
  resolution_due_at        timestamptz NOT NULL,
  first_response_at        timestamptz,
  first_response_breached_at timestamptz,
  resolution_breached_at   timestamptz,
  -- the customer waited: time the ticket sat in waiting_customer is not the team's delay,
  -- so the resolution clock is pushed out by it when the customer answers
  waiting_since            timestamptz,
  resolved_at              timestamptz,
  resolution_note          text,
  closed_at                timestamptz,
  reopened_count           integer NOT NULL DEFAULT 0 CHECK (reopened_count >= 0),
  opened_by                uuid DEFAULT app_current_user_id(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  version                  integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, company_id, number),
  -- resolved and closed tickets always say how they were resolved
  CONSTRAINT resolution_recorded CHECK (
    (state IN ('resolved', 'closed')) = (resolved_at IS NOT NULL)
    AND (resolved_at IS NULL OR resolution_note IS NOT NULL)
  ),
  CONSTRAINT closed_has_time CHECK ((state = 'closed') = (closed_at IS NOT NULL)),
  CONSTRAINT waiting_has_time CHECK ((state = 'waiting_customer') = (waiting_since IS NOT NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION app_touch_row();
CREATE INDEX support_tickets_customer ON support_tickets (tenant_id, customer_id);
CREATE INDEX support_tickets_assignee ON support_tickets (tenant_id, assignee_id) WHERE state NOT IN ('resolved', 'closed');
-- the SLA job reads exactly this: open tickets whose deadline has passed and which have not
-- been reported yet
CREATE INDEX support_tickets_response_due ON support_tickets (tenant_id, first_response_due_at)
  WHERE first_response_at IS NULL AND first_response_breached_at IS NULL;
CREATE INDEX support_tickets_resolution_due ON support_tickets (tenant_id, resolution_due_at)
  WHERE resolved_at IS NULL AND resolution_breached_at IS NULL;
SELECT app_secure_tenant_table('support_tickets', 'SELECT, INSERT, UPDATE');

CREATE TABLE support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  ticket_id   uuid NOT NULL REFERENCES support_tickets (id),
  -- reply: goes to the customer (and stops the response clock). note: internal only.
  kind        text NOT NULL CHECK (kind IN ('reply', 'note', 'customer')),
  body        text NOT NULL,
  author_id   uuid DEFAULT app_current_user_id(),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX support_ticket_messages_ticket ON support_ticket_messages (tenant_id, ticket_id, created_at);
SELECT app_secure_tenant_table('support_ticket_messages', 'SELECT, INSERT');
