-- ---------------------------------------------------------------------------
-- One-time production setup for a managed PostgreSQL that gives you no
-- superuser: Supabase, Neon, and the like.
--
-- `npm run db:setup` cannot be used there. That script is for a server you own:
-- it creates databases, changes the owner of the public schema and creates a
-- BYPASSRLS role, all of which need rights a managed provider keeps to itself.
-- The script says so itself ("Production databases are provisioned by
-- infrastructure code, not by this script").
--
-- This file does the part that production actually needs: the three roles the
-- application logs in as, and the one extension the migrations need. The tables,
-- the row-level security policies and every GRANT to erp_app / erp_worker are
-- created by the migrations themselves (db/migrations/0001_platform_helpers.sql,
-- function app_secure_tenant_table), so they are NOT repeated here.
--
-- HOW TO RUN IT (Supabase)
--   1. Replace the three passwords below with long random ones. Generate each:
--        node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
--   2. Supabase dashboard -> SQL Editor -> paste -> Run. The editor connects as
--      `postgres`, which may create roles.
--   3. Put the same three passwords in Render as PG_OWNER_PASSWORD,
--      PG_APP_PASSWORD and PG_WORKER_PASSWORD. Then run the migrations:
--        npm run db:migrate
--   4. Do NOT keep this file with the passwords in it. It is a template.
--
-- WHY THREE ROLES (guide §6, docs/adr/0002): the API logs in as erp_app, which
-- owns no table and has no BYPASSRLS, so PostgreSQL itself keeps one tenant from
-- reading another's rows. Connecting as `postgres` instead would silently defeat
-- every tenant isolation test in this repository.
-- ---------------------------------------------------------------------------

-- 1. The three roles. NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS matters:
--    it is the same shape `npm run db:setup` creates locally.
--    Running this file again is safe; it only ever updates the password.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'erp_owner') then
    create role erp_owner login nosuperuser nocreatedb nocreaterole nobypassrls
      password 'REPLACE_WITH_OWNER_PASSWORD';
  else
    alter role erp_owner password 'REPLACE_WITH_OWNER_PASSWORD';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'erp_app') then
    create role erp_app login nosuperuser nocreatedb nocreaterole nobypassrls
      password 'REPLACE_WITH_APP_PASSWORD';
  else
    alter role erp_app password 'REPLACE_WITH_APP_PASSWORD';
  end if;

  if not exists (select 1 from pg_roles where rolname = 'erp_worker') then
    create role erp_worker login nosuperuser nocreatedb nocreaterole nobypassrls
      password 'REPLACE_WITH_WORKER_PASSWORD';
  else
    alter role erp_worker password 'REPLACE_WITH_WORKER_PASSWORD';
  end if;
end $$;

-- 2. erp_owner creates the tables (the migrations run as erp_owner); the other
--    two only need to see the schema. Their table rights come from the
--    migrations, table by table.
grant usage, create on schema public to erp_owner;
grant usage on schema public to erp_app, erp_worker;

-- If step 2 fails with "must be owner of schema public", this provider does not
-- let `postgres` hand out CREATE on public. Then run, as postgres:
--     alter schema public owner to erp_owner;
--     grant usage on schema public to postgres, anon, authenticated, service_role;
-- On Supabase keep that second line: its own services use the public schema too.

-- 3. btree_gist: the "no overlapping periods" exclusion constraints need it
--    (guide §7.3). Locally `npm run db:setup` installs it as superuser; here the
--    provider allows it from the SQL editor.
create extension if not exists btree_gist;

-- 4. Check what was created. erp_app MUST show rolbypassrls = false.
select rolname, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
from pg_roles
where rolname in ('erp_owner', 'erp_app', 'erp_worker')
order by rolname;
