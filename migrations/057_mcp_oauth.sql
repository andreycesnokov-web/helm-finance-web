-- 057_mcp_oauth.sql — OAuth 2.1 authorization server storage for the CFO Finance MCP connector.
--
-- ADDITIVE ONLY. Four new tables, no change to any existing table, no data migration.
--
-- Lets an AI client (Claude Connectors, ChatGPT, Claude Code) connect to /mcp with
-- "Sign in with CFO Finance": the client registers itself (RFC 7591 dynamic client
-- registration), the user signs in with the EXISTING CFO login and approves a consent screen,
-- and the client receives tokens bound to that CFO user (public.users.id). There is no second
-- identity system: the OAuth identity IS the CFO user, so no auth.users linking is involved.
--
-- Security model encoded here:
--   * Clients are PUBLIC (PKCE, no client secret) — nothing secret is stored for them.
--   * Authorization codes and tokens are stored ONLY as SHA-256 hashes; a database dump does
--     not yield a usable code or token.
--   * Codes are single-use (used_at) and short-lived (expires_at).
--   * Tokens of one consent share a grant_id so a whole grant can be revoked at once
--     (e.g. on refresh-token reuse).
--   * Deleting a CFO user deletes their codes and tokens (ON DELETE CASCADE).
--   * Backend-only: RLS on, no policies, PUBLIC/anon/authenticated revoked, service_role granted.

-- ── 1. registered clients ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
  client_id     TEXT        PRIMARY KEY,
  client_name   TEXT        NULL,
  redirect_uris TEXT[]      NOT NULL,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- registered metadata; never a secret
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mcp_oauth_clients_redirects_nonempty CHECK (cardinality(redirect_uris) > 0)
);

-- ── 2. pending authorization requests (waiting for the user's decision) ──────
CREATE TABLE IF NOT EXISTS mcp_oauth_requests (
  id             TEXT        PRIMARY KEY,                    -- random, unguessable
  client_id      TEXT        NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri   TEXT        NOT NULL,
  code_challenge TEXT        NOT NULL,
  state          TEXT        NULL,
  scopes         TEXT[]      NOT NULL DEFAULT '{}',
  resource       TEXT        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  decided_at     TIMESTAMPTZ NULL,
  decision       TEXT        NULL CHECK (decision IN ('approved', 'denied')),
  decided_by_user_id BIGINT  NULL REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_requests_expires_idx ON mcp_oauth_requests (expires_at);

-- ── 3. authorization codes (hash only, single use) ──────────────────────────
CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
  code_hash      TEXT        PRIMARY KEY,
  client_id      TEXT        NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id        BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri   TEXT        NOT NULL,
  code_challenge TEXT        NOT NULL,
  scopes         TEXT[]      NOT NULL DEFAULT '{}',
  resource       TEXT        NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_codes_user_idx ON mcp_oauth_codes (user_id);

-- ── 4. access + refresh tokens (hash only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  token_hash  TEXT        PRIMARY KEY,
  kind        TEXT        NOT NULL CHECK (kind IN ('access', 'refresh')),
  grant_id    UUID        NOT NULL,
  client_id   TEXT        NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
  user_id     BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes      TEXT[]      NOT NULL DEFAULT '{}',
  resource    TEXT        NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_grant_idx ON mcp_oauth_tokens (grant_id);
CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_user_idx  ON mcp_oauth_tokens (user_id);

-- ── 5. backend-only access ──────────────────────────────────────────────────
ALTER TABLE mcp_oauth_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE mcp_oauth_tokens   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.mcp_oauth_clients, public.mcp_oauth_requests,
                    public.mcp_oauth_codes, public.mcp_oauth_tokens FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.mcp_oauth_clients, public.mcp_oauth_requests,
                        public.mcp_oauth_codes, public.mcp_oauth_tokens FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.mcp_oauth_clients, public.mcp_oauth_requests,
                        public.mcp_oauth_codes, public.mcp_oauth_tokens FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.mcp_oauth_clients, public.mcp_oauth_requests,
      public.mcp_oauth_codes, public.mcp_oauth_tokens
      TO service_role;
  END IF;
END $$;
