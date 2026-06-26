-- ════════════════════════════════════════════════════════════════════════════
-- 042 — Email Identity Foundation + Personal Account shell (Phase 1). PROPOSAL —
-- additive, NOT yet applied. Apply only after approval, under the gated process
-- (backup → apply → verify). No existing table/row/column is modified. Telegram auth
-- is untouched. EMAIL_AUTH_ENABLED stays OFF — these objects are inert until endpoints
-- ship.
--
-- Phase 1 is OTP / magic-link ONLY (no passwords). The "Personal Account" here is an
-- identity/profile SHELL (user_profiles) — NOT a financial workspace: no personal
-- wallets, no personal transactions, and NO businesses.type='personal' row. Zero
-- dependency on migrations 037–039.
--
-- Email uniqueness uses a functional UNIQUE INDEX on lower(email) — NO citext extension.
-- ════════════════════════════════════════════════════════════════════════════

-- ── shared: updated_at trigger fn (used by user_email_identities + user_profiles) ──
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ── 1. App-allocated NEGATIVE BIGINT ids (disjoint from positive Telegram ids) ──
CREATE SEQUENCE IF NOT EXISTS app_user_id_seq
  AS BIGINT
  INCREMENT BY -1
  START WITH -1
  MINVALUE -9223372036854775808
  MAXVALUE -1
  NO CYCLE;

CREATE OR REPLACE FUNCTION next_app_user_id()
RETURNS bigint
LANGUAGE sql
SET search_path = pg_catalog, public
AS $$ SELECT nextval('public.app_user_id_seq') $$;

-- ── 2. user_email_identities (one email ↔ one internal user) — OTP-only, no password ──
CREATE TABLE IF NOT EXISTS user_email_identities (
  user_id           BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  email             TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_email_identities_email_normalized CHECK (email = lower(btrim(email)))
);
CREATE UNIQUE INDEX IF NOT EXISTS user_email_identities_email_lower_uidx
  ON user_email_identities (lower(email));
DROP TRIGGER IF EXISTS trg_uei_updated_at ON user_email_identities;
CREATE TRIGGER trg_uei_updated_at
  BEFORE UPDATE ON user_email_identities FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── 3. user_profiles — Personal Account SHELL (identity/profile only) ───────
-- NOT a financial workspace: no wallets/transactions, no businesses.type='personal'.
-- Email users land on a personal home/profile after signup, from where they can create
-- a business, accept invited businesses, or connect Telegram later.
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id      BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NULL,
  locale       TEXT NULL,
  timezone     TEXT NULL,
  avatar_url   TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

-- ── 4. email_login_codes (OTP + magic-link tokens; HASH only) ───────────────
CREATE TABLE IF NOT EXISTS email_login_codes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email               TEXT NOT NULL,                  -- normalized
  code_hash           TEXT NOT NULL,                  -- HASH of the code/token; never plaintext
  purpose             TEXT NOT NULL DEFAULT 'login'
                        CHECK (purpose IN ('login','invite_accept')),
  expires_at          TIMESTAMPTZ NOT NULL,
  consumed_at         TIMESTAMPTZ NULL,
  consumed_by_user_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,  -- audit after verify
  attempts            INT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_login_codes_email_normalized CHECK (email = lower(btrim(email)))
);
CREATE INDEX IF NOT EXISTS email_login_codes_email_purpose_idx
  ON email_login_codes (email, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS email_login_codes_expires_idx
  ON email_login_codes (expires_at);

-- ── 5. Lock down: only the service role (backend) may touch these. ──────────
-- email identities, profiles, and login codes must never be readable by client roles.
-- Order: REVOKE from PUBLIC first, then conditional per-role revokes, then explicit
-- service_role grants (so the backend retains the access it needs).

-- 5a) functions: revoke from PUBLIC first.
REVOKE ALL ON FUNCTION public.next_app_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM PUBLIC;

DO $$ BEGIN
  -- 5b) client roles: no access to identity/profile/code tables or these functions.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.user_email_identities, public.email_login_codes, public.user_profiles FROM anon;
    REVOKE ALL ON FUNCTION public.next_app_user_id() FROM anon;
    REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.user_email_identities, public.email_login_codes, public.user_profiles FROM authenticated;
    REVOKE ALL ON FUNCTION public.next_app_user_id() FROM authenticated;
    REVOKE ALL ON FUNCTION public.fn_set_updated_at() FROM authenticated;
  END IF;

  -- 5c) service_role (backend): explicit table CRUD + sequence usage + function execute.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      public.user_email_identities, public.user_profiles, public.email_login_codes
      TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.app_user_id_seq TO service_role;
    GRANT EXECUTE ON FUNCTION public.next_app_user_id() TO service_role;
    -- fn_set_updated_at runs inside triggers (no client call needed); execute granted for completeness.
    GRANT EXECUTE ON FUNCTION public.fn_set_updated_at() TO service_role;
  END IF;
END $$;
