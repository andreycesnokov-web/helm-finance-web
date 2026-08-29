-- Migration 052 — Payment provider credentials (encrypted vault, v1)
--
-- Stores provider secrets as AES-256-GCM ciphertext ONLY. There is deliberately no column
-- that can hold a plaintext secret: no `api_key`, no `secret`, no `token`, no `credentials`,
-- no `value`. The only value-bearing columns are `encrypted_value`, `encryption_iv` and
-- `encryption_tag`, which are useless without the key held in
-- PAYMENT_CREDENTIALS_ENCRYPTION_KEY (env, never in the database).
--
-- Consequence worth stating plainly: a database dump alone -- a backup, a support export, a
-- compromised read replica -- yields no usable secret. That property is the entire point of
-- this table, and it is why the plaintext columns are absent rather than merely unused.
--
-- SANDBOX ONLY in v1. The API refuses to store a credential against a connection whose
-- environment is 'production'. The schema does not encode that rule because environment is
-- a property of the connection and may legitimately change class in a later phase; the
-- refusal lives where the policy lives.
--
-- REVOKE, NEVER DELETE. A credential is retired by setting status='revoked' with a stamp.
-- History is evidence: knowing a key existed and when it was rotated matters during an
-- incident, and D9 (archive-first) applies.
--
-- INERT. Nothing here calls a provider, processes a webhook, creates an incoming_payment,
-- or touches transactions, debts or wallet balances.
--
-- ADDITIVE and IDEMPOTENT. One table, one partial unique index, three lookup indexes, one
-- guard trigger, one updated_at trigger. Requires 051. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_provider_credentials (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE: a credential is meaningless without its connection. Deleting the connection
  -- removes the ciphertext with it, which is the correct disposal path.
  connection_id       UUID        NOT NULL REFERENCES payment_provider_connections(id) ON DELETE CASCADE,
  business_id         UUID        NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,

  -- Denormalised from the connection so an admin metadata query needs no join, and so the
  -- guard trigger below can prove they agree. Kept in step by the trigger, not by trust.
  provider            TEXT        NOT NULL,
  environment         TEXT        NOT NULL,

  credential_type     TEXT        NOT NULL
    CHECK (credential_type IN ('api_key','secret_key','server_key','client_key',
                               'webhook_secret','merchant_id','other')),

  -- ── The only value-bearing columns. All three are required: GCM without its tag is
  -- unauthenticated, and without its IV undecryptable. Base64 text. ────────────────────
  encrypted_value     TEXT        NOT NULL CHECK (length(encrypted_value) > 0),
  encryption_iv       TEXT        NOT NULL CHECK (length(encryption_iv) > 0),
  encryption_tag      TEXT        NOT NULL CHECK (length(encryption_tag) > 0),

  -- Keyed HMAC of the plaintext, NOT a bare hash. A bare SHA-256 of a low-entropy secret
  -- (a short merchant id, a test key) is brute-forceable straight out of a dump; an HMAC
  -- under a server-side key is not. Used to recognise "the same value was submitted again".
  value_fingerprint   TEXT        NOT NULL CHECK (length(value_fingerprint) > 0),
  -- Last 4 characters, for human recognition in the UI. NULL for values short enough that
  -- 4 characters would be a meaningful fraction of the secret.
  value_last4         TEXT        NULL CHECK (value_last4 IS NULL OR length(value_last4) <= 4),

  status              TEXT        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revoked')),

  created_by_user_id  BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_user_id  BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
  revoked_at          TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A revocation stamp is all-or-nothing, and an active credential carries none.
  CONSTRAINT payment_credentials_revocation_stamp CHECK (
    (status = 'active'  AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
    OR
    (status = 'revoked' AND revoked_at IS NOT NULL)
  )
);

-- ── One ACTIVE credential per (connection, type) ─────────────────────────────────────────
-- Partial, so any number of revoked predecessors may remain as history. Without this, a
-- rotation that failed halfway would leave two live keys for the same purpose and nothing
-- would say which one is authoritative.
CREATE UNIQUE INDEX IF NOT EXISTS payment_credentials_one_active_uidx
  ON payment_provider_credentials (connection_id, credential_type)
  WHERE status = 'active';

-- ── Lookups ───────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS payment_credentials_connection_idx
  ON payment_provider_credentials (connection_id, status);
CREATE INDEX IF NOT EXISTS payment_credentials_business_idx
  ON payment_provider_credentials (business_id, status);
CREATE INDEX IF NOT EXISTS payment_credentials_fingerprint_idx
  ON payment_provider_credentials (business_id, value_fingerprint);

-- ── Guard: a credential may never disagree with its connection ───────────────────────────
-- The API checks tenancy too, but a credential filed under the wrong business would hand one
-- company's provider key to another company's UI. That belongs in the database. Same
-- approach as fn_incoming_payment_candidate_guard (050) and fn_ic_funding_guard (033).
CREATE OR REPLACE FUNCTION fn_payment_credential_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_biz UUID; v_provider TEXT; v_env TEXT;
BEGIN
  SELECT business_id, provider, environment
    INTO v_biz, v_provider, v_env
    FROM payment_provider_connections WHERE id = NEW.connection_id;

  IF v_biz IS NULL THEN
    RAISE EXCEPTION 'credential references a connection that does not exist';
  END IF;
  IF v_biz <> NEW.business_id THEN
    RAISE EXCEPTION 'credential business_id must match its connection';
  END IF;
  IF v_provider IS DISTINCT FROM NEW.provider THEN
    RAISE EXCEPTION 'credential provider must match its connection';
  END IF;
  IF v_env IS DISTINCT FROM NEW.environment THEN
    RAISE EXCEPTION 'credential environment must match its connection';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_payment_credential_guard ON payment_provider_credentials;
CREATE TRIGGER trg_payment_credential_guard
  BEFORE INSERT OR UPDATE ON payment_provider_credentials FOR EACH ROW
  EXECUTE FUNCTION fn_payment_credential_guard();

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────────
-- Expect the table, and ZERO rows from the plaintext-column check.
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'payment_provider_credentials';

SELECT column_name AS plaintext_column_that_should_not_exist
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'payment_provider_credentials'
  AND column_name IN ('api_key','secret','secret_key','token','credentials','value',
                      'plaintext','password','private_key');
