-- =============================================================================
-- 0049  Signing out ends the session, not just the cookie
--
-- Access tokens are stateless JWTs with a 30-minute life (spec §11 session
-- timeout), and until now nothing could end one early. Signing out only deleted
-- the browser's cookie: anyone holding a copy of the token -- taken from a
-- shared machine, a proxy log, a stolen phone -- could keep using it for the
-- rest of the half hour, and the person signing out had no way to stop that.
--
-- Roles are a different matter and need nothing here: AuthGuard reloads them on
-- every request, so granting or revoking one already takes effect immediately.
--
-- A user's token is now valid only if it was issued at or after
-- users.tokens_valid_from. Moving that column forward invalidates every token
-- that user holds, on every device, immediately: one UPDATE ends every session.
-- AuthGuard already reads this row on every request to check `status`, so the
-- check costs nothing extra.
--
-- Why a timestamp and not a token id list: there is nothing to store per token,
-- nothing to clean up, and no shared cache to keep consistent -- which matters
-- because the API runs as a single free instance with no Redis.
--
-- now() is the default, so every existing token stays valid: the column is
-- read as "nothing has been revoked since", not as "revoked at".
-- =============================================================================

ALTER TABLE users
  ADD COLUMN tokens_valid_from timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN users.tokens_valid_from IS
  'Access tokens issued before this moment are refused. Moved forward by sign-out. See 0049.';

-- The API moves it forward on sign-out; it never reads past it, so SELECT is
-- already covered by the table grant.
GRANT UPDATE (tokens_valid_from) ON users TO erp_app;
