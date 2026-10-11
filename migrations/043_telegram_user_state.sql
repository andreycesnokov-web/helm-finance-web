-- ════════════════════════════════════════════════════════════════════════════
-- 043 — Telegram per-user active-business state (multi-business routing). PROPOSAL —
-- additive, NOT yet applied. Apply only after approval, under the gated process
-- (backup → apply → verify). No existing table/row/column is modified.
--
-- Stores the active business a Telegram user is currently posting to (per user, never
-- global to the bot). Keyed by user_id (the internal app user). TODAY user_id ==
-- telegram_id; when Telegram linking (Phase 2, migration 044+) ships, the resolver swaps
-- to user_telegram_links.user_id — this table needs NO change (it already keys on the
-- app user id).
--
-- ON DELETE SET NULL: if the active business is deleted, the selection clears and the
-- next bot action re-resolves (auto/choose). This is NOT one of the gated Personal/
-- Funding migrations (037–039) or 040/041/042.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS telegram_user_state (
  user_id            BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_business_id UUID NULL REFERENCES businesses(id) ON DELETE SET NULL,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at maintained by a module-scoped trigger (no reliance on the backend).
CREATE OR REPLACE FUNCTION fn_telegram_user_state_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_telegram_user_state_updated_at ON telegram_user_state;
CREATE TRIGGER trg_telegram_user_state_updated_at
  BEFORE UPDATE ON telegram_user_state FOR EACH ROW EXECUTE FUNCTION fn_telegram_user_state_set_updated_at();

-- Lock down: only the service role (backend / bot-secret routes) may touch it.
REVOKE ALL ON TABLE public.telegram_user_state FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_telegram_user_state_set_updated_at() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.telegram_user_state FROM anon;
    REVOKE ALL ON FUNCTION public.fn_telegram_user_state_set_updated_at() FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.telegram_user_state FROM authenticated;
    REVOKE ALL ON FUNCTION public.fn_telegram_user_state_set_updated_at() FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.telegram_user_state TO service_role;
    GRANT EXECUTE ON FUNCTION public.fn_telegram_user_state_set_updated_at() TO service_role;
  END IF;
END $$;
