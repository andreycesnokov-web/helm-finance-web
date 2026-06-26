-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Email Identity Foundation (Phase 1). PROPOSAL — additive, NOT yet applied.
-- Apply only after approval, under the gated process (backup → apply → verify).
-- No existing table/row/column is modified. Telegram auth is untouched.
-- EMAIL_AUTH_ENABLED stays OFF; these objects are inert until the endpoints ship.
--
-- Email uniqueness uses a functional UNIQUE INDEX on lower(email) + a CHECK that email
-- is stored already-normalized — NO citext extension required (safer, easy rollback).
-- (Alternative, if you prefer citext: CREATE EXTENSION IF NOT EXISTS citext; and make
--  email CITEXT UNIQUE. Not used here to avoid an extension dependency.)
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. App-allocated NEGATIVE BIGINT ids (disjoint from positive Telegram ids) ──
CREATE SEQUENCE IF NOT EXISTS app_user_id_seq
  AS BIGINT
  INCREMENT BY -1
  START WITH -1
  MINVALUE -9223372036854775808
  MAXVALUE -1
  NO CYCLE;

-- Optional helper: returns the next negative app user id (server uses this for new
-- email-first users). Pure wrapper over the sequence.
CREATE OR REPLACE FUNCTION next_app_user_id()
RETURNS bigint
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$ SELECT nextval('public.app_user_id_seq') $$;

-- ── 2. user_email_identities (one email ↔ one internal user) ────────────────
CREATE TABLE IF NOT EXISTS user_email_identities (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  password_hash     TEXT NULL,                       -- NULL in v1 (OTP-only)
  email_verified_at TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- store only normalized (lowercased, trimmed) email
  CONSTRAINT user_email_identities_email_normalized CHECK (email = lower(btrim(email)))
);
-- case-insensitive uniqueness without citext
CREATE UNIQUE INDEX IF NOT EXISTS user_email_identities_email_lower_uidx
  ON user_email_identities (lower(email));

-- updated_at maintained by trigger (no reliance on the backend remembering)
CREATE OR REPLACE FUNCTION fn_uei_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_uei_updated_at ON user_email_identities;
CREATE TRIGGER trg_uei_updated_at
  BEFORE UPDATE ON user_email_identities FOR EACH ROW EXECUTE FUNCTION fn_uei_set_updated_at();

-- ── 3. email_login_codes (OTP + magic-link tokens; HASH only) ───────────────
CREATE TABLE IF NOT EXISTS email_login_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,                          -- normalized
  code_hash    TEXT NOT NULL,                          -- HASH of the 6-digit code / token; never plaintext
  purpose      TEXT NOT NULL DEFAULT 'login'
                 CHECK (purpose IN ('login','invite_accept')),
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  attempts     INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_login_codes_email_normalized CHECK (email = lower(btrim(email)))
);
CREATE INDEX IF NOT EXISTS email_login_codes_email_purpose_idx
  ON email_login_codes (email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS email_login_codes_expires_idx
  ON email_login_codes (expires_at);

-- ── 4. Lock down: only the service role (backend) may touch these. ──────────
-- Supabase auto-grants table privileges to anon/authenticated via default privileges;
-- email identities + login codes must never be readable by client roles.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.user_email_identities, public.email_login_codes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.user_email_identities, public.email_login_codes FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON FUNCTION public.next_app_user_id() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON FUNCTION public.next_app_user_id() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.next_app_user_id() TO service_role;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.next_app_user_id() FROM PUBLIC;
