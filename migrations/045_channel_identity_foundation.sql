-- ════════════════════════════════════════════════════════════════════════════
-- 045 — Channel identity foundation (PR1). ADDITIVE ONLY, schema only.
--
-- Nothing reads or writes these tables yet. PR1 creates them empty; PR2 adds the
-- resolver, PR3 moves active-workspace state onto them, PR4 adds the web connect flow.
-- Applying this migration changes NO runtime behaviour.
--
-- WHY THESE TABLES EXIST
-- ----------------------
-- Today `users.id` IS the Telegram user id for Telegram-origin accounts (positive ids),
-- while email-origin accounts get negative ids from app_user_id_seq (migration 042). That
-- conflation means an email-primary user can never link Telegram — /api/telegram/connect
-- literally requires `business_members.user_id == telegram_id` — and it makes the id SIGN
-- load-bearing for "does this person have Telegram".
--
-- These tables replace the assumption with a fact: a channel identity is a row, not an
-- arithmetic property of a primary key.
--
-- THE MODEL
-- ---------
--   channel + external_user_id  →  user_id  →  business_members  →  workspace
--
-- Deliberately NOT in these tables:
--   * business_id — membership and role live in business_members, which stays the single
--     authority. A link says "this Telegram account is this person", nothing about access.
--   * role — same reason. A link grants no permission of any kind.
--
-- `channel` is CHECK-constrained to 'telegram' only. WhatsApp and others are anticipated by
-- the shape, not enabled by it: widening the CHECK is a deliberate future migration, so a
-- typo or an unfinished integration cannot quietly write rows for a channel nothing handles.
--
-- `external_user_id` is TEXT even though Telegram ids are numeric — WhatsApp uses phone
-- numbers and other channels use opaque strings. Always compare as TEXT; never coerce.
--
-- NOT APPLIED BY DEPLOY. Apply under the gated process (backup → apply → verify).
-- No existing table, row or column is modified. No backfill.
-- ════════════════════════════════════════════════════════════════════════════

-- ── A. user_channel_links ───────────────────────────────────────────────────
-- One row per (channel, external account) linkage event. Revocation is a soft state, so
-- the table doubles as an audit trail of who linked what and when.
--
-- A surrogate primary key rather than (channel, external_user_id): a natural key would make
-- the table hold exactly one row per external account forever, which forbids the ordinary
-- unlink-then-relink cycle and destroys history. Uniqueness of the ACTIVE link is enforced
-- by partial indexes below instead, which is the property that actually matters.
CREATE TABLE IF NOT EXISTS user_channel_links (
  id                  BIGSERIAL   PRIMARY KEY,
  channel             TEXT        NOT NULL CHECK (channel IN ('telegram')),
  -- TEXT by design: future channels are not numeric. Compare as text, never as a number.
  external_user_id    TEXT        NOT NULL,
  user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Display only. A Telegram @username is mutable and can be re-registered by a DIFFERENT
  -- person after release, so it must never be used to identify anyone.
  display_handle      TEXT        NULL,
  -- Whitelisted on read. Never return this blob to a client verbatim.
  channel_metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  linked_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- How the link was established: 'link_token' (PR4) or 'legacy_migration' if ever needed.
  linked_via          TEXT        NOT NULL DEFAULT 'link_token',
  -- Soft revoke: the row survives for audit. NULL means the link is ACTIVE.
  revoked_at          TIMESTAMPTZ NULL,
  revoked_by_user_id  BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL
);

-- One ACTIVE link per external account: a Telegram account cannot be two people at once.
CREATE UNIQUE INDEX IF NOT EXISTS user_channel_links_active_external_uidx
  ON user_channel_links (channel, external_user_id) WHERE revoked_at IS NULL;

-- One ACTIVE link per user per channel: also the reverse lookup used by outbound
-- notifications (user_id → external_user_id). Today the notification path uses
-- business_members.user_id AS the Telegram chat id, which is wrong for any negative
-- (email-origin) id — a negative chat id is a GROUP in Telegram, not a person.
CREATE UNIQUE INDEX IF NOT EXISTS user_channel_links_active_user_uidx
  ON user_channel_links (channel, user_id) WHERE revoked_at IS NULL;

-- Full history for one user, including revoked rows (admin views, conflict diagnosis).
CREATE INDEX IF NOT EXISTS user_channel_links_user_channel_idx
  ON user_channel_links (user_id, channel);

-- ── B. channel_link_tokens ──────────────────────────────────────────────────
-- One-time tokens minted by the web app for an AUTHENTICATED user, consumed by the bot via
-- /start link_<token>. The token proves "the person holding this already proved they are
-- user_id in the web app", so consuming it is what makes the link trustworthy.
--
-- Only the HASH is stored. A leaked database row must not yield a usable token, so there is
-- deliberately no raw-token column.
--
-- No business_id: a token links an ACCOUNT, not a workspace. Workspace selection happens
-- afterwards, per channel, in user_channel_state.
CREATE TABLE IF NOT EXISTS channel_link_tokens (
  token_hash          TEXT        PRIMARY KEY,
  user_id             BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  intended_channel    TEXT        NOT NULL CHECK (intended_channel IN ('telegram')),
  expires_at          TIMESTAMPTZ NOT NULL,
  -- Single-use: set atomically with the link insert so a replay cannot double-link.
  used_at             TIMESTAMPTZ NULL,
  used_by_channel     TEXT        NULL,
  used_by_external_id TEXT        NULL,
  -- Explicit invalidation before use (user cancelled, admin action).
  revoked_at          TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS channel_link_tokens_user_idx
  ON channel_link_tokens (user_id, intended_channel);

-- Cleanup / expiry sweeps only care about tokens that were never used.
CREATE INDEX IF NOT EXISTS channel_link_tokens_expires_idx
  ON channel_link_tokens (expires_at) WHERE used_at IS NULL;

-- ── C. user_channel_state ───────────────────────────────────────────────────
-- The active workspace per user PER CHANNEL. Separate from the web app's active workspace
-- on purpose: someone at a desk and the same person answering on a phone are legitimately
-- in different contexts, and coupling them causes mis-filing.
--
-- Keyed on user_id, NOT external id — which is the whole point of PR1. Supersedes
-- telegram_user_state (043) in PR3; 043 stays untouched and live until then.
--
-- active_business_id is UUID because businesses.id is UUID.
CREATE TABLE IF NOT EXISTS user_channel_state (
  user_id            BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel            TEXT        NOT NULL CHECK (channel IN ('telegram')),
  -- ON DELETE SET NULL: if the business goes away the selection clears and the next action
  -- re-resolves, rather than the row vanishing and losing the channel context.
  active_business_id UUID        NULL REFERENCES businesses(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel)
);

-- updated_at maintained by a module-scoped trigger, matching 043 — no reliance on callers.
CREATE OR REPLACE FUNCTION fn_user_channel_state_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_user_channel_state_updated_at ON user_channel_state;
CREATE TRIGGER trg_user_channel_state_updated_at
  BEFORE UPDATE ON user_channel_state FOR EACH ROW
  EXECUTE FUNCTION fn_user_channel_state_set_updated_at();

-- ── Access control ──────────────────────────────────────────────────────────
-- Same posture as 043: identity linkage is backend-only. No browser role may read or write
-- these tables — a client that could read user_channel_links could enumerate which app users
-- own which Telegram accounts.
REVOKE ALL ON TABLE public.user_channel_links  FROM PUBLIC;
REVOKE ALL ON TABLE public.channel_link_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.user_channel_state  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_user_channel_state_set_updated_at() FROM PUBLIC;
REVOKE ALL ON SEQUENCE public.user_channel_links_id_seq FROM PUBLIC;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.user_channel_links  FROM anon;
    REVOKE ALL ON TABLE public.channel_link_tokens FROM anon;
    REVOKE ALL ON TABLE public.user_channel_state  FROM anon;
    REVOKE ALL ON FUNCTION public.fn_user_channel_state_set_updated_at() FROM anon;
    REVOKE ALL ON SEQUENCE public.user_channel_links_id_seq FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.user_channel_links  FROM authenticated;
    REVOKE ALL ON TABLE public.channel_link_tokens FROM authenticated;
    REVOKE ALL ON TABLE public.user_channel_state  FROM authenticated;
    REVOKE ALL ON FUNCTION public.fn_user_channel_state_set_updated_at() FROM authenticated;
    REVOKE ALL ON SEQUENCE public.user_channel_links_id_seq FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_channel_links  TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.channel_link_tokens TO service_role;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_channel_state  TO service_role;
    GRANT EXECUTE ON FUNCTION public.fn_user_channel_state_set_updated_at() TO service_role;
    GRANT USAGE, SELECT ON SEQUENCE public.user_channel_links_id_seq TO service_role;
  END IF;
END $$;
