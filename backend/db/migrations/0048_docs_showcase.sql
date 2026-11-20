-- =============================================================================
-- 0048  The /docs showcase: pitch deck + technical documentation, published by
--       the admin for a window of time (judging, investor preview, demo day)
--
--   docs_settings           one row per tenant: the master switch, the window the page is
--                           public for, and the three lines of text above the deck
--   docs_sections           the page itself, one row per section, in order. Each section
--                           holds the text the public sees (published_body) and, separately,
--                           the admin's unpublished work (draft_body) — so an edit is never
--                           live until it is published, even mid-judging.
--   docs_section_revisions  append-only history: every publish keeps the text it replaced,
--                           so a bad edit during a showcase window can be put back in one click
--   docs_team_members       the team grid: name, role, e-mail, photo, in display order
--
-- Why the page's text lives in the database and not in the repository: the window is
-- opened and closed, and the deck reworded, by whoever is presenting — on the day, from
-- the portal, with no deploy. The text the product ships with is in
-- backend/src/modules/docs/docs-content.ts and is written into these rows the first time
-- an admin opens the screen, so /docs is complete before anyone has typed anything.
--
-- Guarantees the database itself keeps:
--   - a window cannot end before it starts (closes_after_opens);
--   - a section's key is unique per tenant and is a URL anchor, so #problem is stable
--     across edits and reorderings;
--   - the revision history cannot be edited or deleted, only appended to (the same
--     app_reject_change the audit log uses);
--   - every revision number is used once per section.
--
-- There is no company_id anywhere here: the showcase is the tenant's one public page,
-- not a per-company screen.
-- =============================================================================

CREATE TABLE docs_settings (
  tenant_id     uuid PRIMARY KEY DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  -- the master switch. Off = /docs answers "not available" to everyone, whatever the window says.
  is_enabled    boolean NOT NULL DEFAULT false,
  -- the window, in absolute time (the admin screen shows and takes it in Asia/Dhaka).
  -- NULL opens_at = open as soon as the switch is on; NULL closes_at = no end.
  opens_at      timestamptz,
  closes_at     timestamptz,
  -- the three lines above the deck; NULL falls back to the shipped text
  headline      text CHECK (headline IS NULL OR length(headline) BETWEEN 1 AND 160),
  tagline       text CHECK (tagline IS NULL OR length(tagline) BETWEEN 1 AND 400),
  team_name     text CHECK (team_name IS NULL OR length(team_name) BETWEEN 1 AND 120),
  -- whether a visitor may download the Markdown and print the page
  allow_export  boolean NOT NULL DEFAULT true,
  -- whether the live figures block is shown (aggregate counts only, never a person's data)
  show_live     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid DEFAULT app_current_user_id(),
  version       integer NOT NULL DEFAULT 1,
  CONSTRAINT closes_after_opens CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)
);
CREATE TRIGGER touch BEFORE UPDATE ON docs_settings FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('docs_settings', 'SELECT, INSERT, UPDATE');

CREATE TABLE docs_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  -- the URL anchor (/docs#problem) and the id the shipped content is matched by
  key             text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,40}$'),
  -- which part of the page it belongs to: the deck read in two minutes, the technical
  -- layer read in ten, or the appendix at the end
  part            text NOT NULL DEFAULT 'deck' CHECK (part IN ('deck', 'technical', 'appendix')),
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  title_bn        text,
  -- one line under the heading, used by the section nav and the search box
  summary         text CHECK (summary IS NULL OR length(summary) <= 300),
  -- a diagram, the team grid or the live figures are drawn by the page, not written as
  -- text; the body above them is still the admin's. NULL = text only.
  widget          text CHECK (widget IS NULL OR widget IN ('architecture', 'data-flow', 'team', 'live', 'features', 'api', 'changelog')),
  position        integer NOT NULL,
  is_visible      boolean NOT NULL DEFAULT true,
  -- a shipped section can be reset to the product's own text; a section the admin added is theirs to delete
  is_custom       boolean NOT NULL DEFAULT false,
  -- what the public sees. NULL = never published, so the section is not on the public page.
  published_body  text,
  -- the admin's work in progress. NULL = nothing unpublished.
  draft_body      text,
  revision        integer NOT NULL DEFAULT 0,
  published_at    timestamptz,
  published_by    uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid DEFAULT app_current_user_id(),
  version         integer NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, key)
);
CREATE TRIGGER touch BEFORE UPDATE ON docs_sections FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('docs_sections');

-- the public page reads exactly this: the published, visible sections in order
CREATE INDEX docs_sections_public ON docs_sections (tenant_id, part, position)
  WHERE is_visible AND published_body IS NOT NULL;

CREATE TABLE docs_section_revisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  section_id  uuid NOT NULL REFERENCES docs_sections (id) ON DELETE CASCADE,
  revision    integer NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  -- a short note the admin can leave ("reworded traction for the judges")
  note        text CHECK (note IS NULL OR length(note) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid DEFAULT app_current_user_id(),
  UNIQUE (tenant_id, section_id, revision)
);
-- history, like the audit log: append-only, never corrected after the fact
CREATE TRIGGER no_change BEFORE UPDATE OR DELETE ON docs_section_revisions
  FOR EACH ROW EXECUTE FUNCTION app_reject_change();
SELECT app_secure_tenant_table('docs_section_revisions', 'SELECT, INSERT');

CREATE TABLE docs_team_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT app_current_tenant_id() REFERENCES tenants (id),
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  -- what they do in THIS application ("Payroll engine, rule packs"), not their job grade
  role        text NOT NULL CHECK (length(role) BETWEEN 1 AND 120),
  role_bn     text,
  -- shown on a public page, so it is the address they chose to publish
  email       text NOT NULL CHECK (email = lower(email) AND position('@' IN email) > 1),
  -- a square image in the bucket ("<tenant>/docs-team/<uuid>"), cropped and sized by the
  -- browser before it is sent, so every card is the same shape without an image library
  photo_key   text,
  photo_type  text CHECK (photo_type IS NULL OR photo_type IN ('image/jpeg', 'image/png', 'image/webp')),
  links       jsonb NOT NULL DEFAULT '{}'::jsonb,
  position    integer NOT NULL,
  is_visible  boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid DEFAULT app_current_user_id(),
  version     integer NOT NULL DEFAULT 1,
  CONSTRAINT photo_type_with_key CHECK ((photo_key IS NULL) = (photo_type IS NULL))
);
CREATE TRIGGER touch BEFORE UPDATE ON docs_team_members FOR EACH ROW EXECUTE FUNCTION app_touch_row();
SELECT app_secure_tenant_table('docs_team_members');

CREATE INDEX docs_team_members_order ON docs_team_members (tenant_id, position);
