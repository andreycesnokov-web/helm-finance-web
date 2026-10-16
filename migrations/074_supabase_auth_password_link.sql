-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 074 — Email + Password sign-in through Supabase Auth (GoTrue) (Personal identity / Platform). ADDITIVE.
--
-- Supabase Auth owns the credential (hashing, email confirmation, password reset). The application keeps
-- its own identity (users / user_email_identities, negative ids), roles, memberships and app-JWT contract.
-- This migration only adds the bridge between the two:
--
--  1. auth_user_links: app user ↔ Supabase auth user id. Immutable once written. The link is made only for
--     a CONFIRMED auth email; an existing app identity is reused only when its own email is verified too
--     (never on an unverified email match). One auth user ↔ one app user.
--  2. auth_app_sessions: server-side record of every password session (the app JWT carries its id as `sid`).
--     Logout and password reset revoke rows here; the session check refuses revoked or expired rows.
--  3. rpc_auth_password_session: link (or create) the app user AND open the session in ONE transaction,
--     serialized per email and per auth user id (no duplicate users/profiles on concurrent sign-in).
--  4. rpc_auth_end_session / rpc_auth_revoke_all_sessions: logout of one session, revocation of all.
--
-- Every function is SECURITY INVOKER with a pinned search_path and executable by service_role only.
-- No existing table, function or policy is changed.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $$ BEGIN
  IF to_regclass('public.user_email_identities') IS NULL OR to_regclass('public.user_profiles') IS NULL
     OR to_regprocedure('public.next_app_user_id()') IS NULL THEN
    RAISE EXCEPTION 'auth_password_link_requires_042';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.auth_user_links (
  user_id      bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  auth_user_id uuid NOT NULL UNIQUE,
  email        text NOT NULL CHECK (email = lower(btrim(email))),
  link_method  text NOT NULL CHECK (link_method IN ('registration', 'verified_email_match')),
  linked_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, auth_user_id)
);

CREATE TABLE IF NOT EXISTS public.auth_app_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       bigint NOT NULL,
  auth_user_id  uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  revoke_reason text CHECK (revoke_reason IN ('logout', 'password_reset', 'admin')),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL)),
  FOREIGN KEY (user_id, auth_user_id) REFERENCES public.auth_user_links(user_id, auth_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS auth_app_sessions_active_user ON public.auth_app_sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS auth_app_sessions_active_auth_user ON public.auth_app_sessions(auth_user_id) WHERE revoked_at IS NULL;

-- A link never changes; it disappears only with its user (ON DELETE CASCADE runs after the user row is gone).
CREATE OR REPLACE FUNCTION public.fn_auth_user_links_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'auth_user_link_immutable' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = OLD.user_id) THEN
    RAISE EXCEPTION 'auth_user_link_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS auth_user_links_guard ON public.auth_user_links;
CREATE TRIGGER auth_user_links_guard BEFORE UPDATE OR DELETE ON public.auth_user_links
  FOR EACH ROW EXECUTE FUNCTION public.fn_auth_user_links_guard();

-- A session can only be revoked (once); its identity, creation and expiry never change.
CREATE OR REPLACE FUNCTION public.fn_auth_app_sessions_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'auth_app_session_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS auth_app_sessions_guard ON public.auth_app_sessions;
CREATE TRIGGER auth_app_sessions_guard BEFORE UPDATE ON public.auth_app_sessions
  FOR EACH ROW EXECUTE FUNCTION public.fn_auth_app_sessions_guard();

CREATE OR REPLACE FUNCTION public.rpc_auth_password_session(
  p_auth_user_id uuid, p_email text, p_email_confirmed_at timestamptz, p_ttl_seconds integer)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_user    bigint;
  v_method  text;
  v_created boolean := false;
  v_ident   public.user_email_identities%ROWTYPE;
  v_session public.auth_app_sessions%ROWTYPE;
  v_name    text;
BEGIN
  IF p_auth_user_id IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'auth_link_invalid' USING ERRCODE = '22023';
  END IF;
  IF p_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'auth_email_not_confirmed' USING ERRCODE = '42501';
  END IF;
  IF p_ttl_seconds IS NULL OR p_ttl_seconds < 300 OR p_ttl_seconds > 2592000 THEN
    RAISE EXCEPTION 'auth_session_ttl_invalid' USING ERRCODE = '22023';
  END IF;
  -- Fixed order: email, then auth user id. Concurrent first sign-ins of one person serialize here.
  PERFORM pg_advisory_xact_lock(hashtextextended('cfo_auth_link:email:' || v_email, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('cfo_auth_link:id:' || p_auth_user_id::text, 0));

  SELECT user_id, link_method INTO v_user, v_method FROM public.auth_user_links WHERE auth_user_id = p_auth_user_id;
  IF v_user IS NULL THEN
    SELECT * INTO v_ident FROM public.user_email_identities WHERE lower(email) = v_email FOR UPDATE;
    IF FOUND THEN
      -- Reuse an existing app identity only when BOTH sides proved ownership of the mailbox.
      IF v_ident.email_verified_at IS NULL THEN
        RAISE EXCEPTION 'auth_link_unverified_identity' USING ERRCODE = '42501';
      END IF;
      IF EXISTS (SELECT 1 FROM public.auth_user_links WHERE user_id = v_ident.user_id) THEN
        RAISE EXCEPTION 'auth_link_conflict' USING ERRCODE = '42501';
      END IF;
      v_user := v_ident.user_id; v_method := 'verified_email_match';
    ELSE
      v_user := public.next_app_user_id(); v_method := 'registration'; v_created := true;
      INSERT INTO public.users(id, username, first_name) VALUES (v_user, '', split_part(v_email, '@', 1));
      INSERT INTO public.user_email_identities(user_id, email, email_verified_at) VALUES (v_user, v_email, p_email_confirmed_at);
      INSERT INTO public.user_profiles(user_id, display_name) VALUES (v_user, split_part(v_email, '@', 1))
        ON CONFLICT (user_id) DO NOTHING;
    END IF;
    INSERT INTO public.auth_user_links(user_id, auth_user_id, email, link_method) VALUES (v_user, p_auth_user_id, v_email, v_method);
  END IF;

  INSERT INTO public.auth_app_sessions(user_id, auth_user_id, expires_at)
  VALUES (v_user, p_auth_user_id, now() + make_interval(secs => p_ttl_seconds))
  RETURNING * INTO v_session;
  SELECT display_name INTO v_name FROM public.user_profiles WHERE user_id = v_user;
  RETURN jsonb_build_object('user_id', v_user, 'display_name', v_name, 'link_method', v_method, 'created', v_created,
    'session_id', v_session.id, 'expires_at', v_session.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_auth_end_session(p_user_id bigint, p_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_n integer;
BEGIN
  UPDATE public.auth_app_sessions SET revoked_at = now(), revoke_reason = 'logout'
   WHERE id = p_session_id AND user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('revoked', v_n);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_auth_revoke_all_sessions(p_auth_user_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE v_n integer;
BEGIN
  IF p_reason NOT IN ('password_reset', 'admin') THEN RAISE EXCEPTION 'auth_revoke_reason_invalid' USING ERRCODE = '22023'; END IF;
  UPDATE public.auth_app_sessions SET revoked_at = now(), revoke_reason = p_reason
   WHERE auth_user_id = p_auth_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('revoked', v_n);
END $$;

ALTER TABLE public.auth_user_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_app_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_user_links, public.auth_app_sessions FROM PUBLIC;
DO $$
DECLARE f text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON public.auth_user_links, public.auth_app_sessions FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON public.auth_user_links, public.auth_app_sessions FROM authenticated; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT ON public.auth_user_links TO service_role;
    GRANT SELECT, INSERT, UPDATE ON public.auth_app_sessions TO service_role;
  END IF;
  FOREACH f IN ARRAY ARRAY['public.rpc_auth_password_session(uuid,text,timestamptz,integer)',
    'public.rpc_auth_end_session(bigint,uuid)', 'public.rpc_auth_revoke_all_sessions(uuid,text)',
    'public.fn_auth_user_links_guard()', 'public.fn_auth_app_sessions_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f); END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AND f LIKE 'public.rpc_%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;

COMMIT;
