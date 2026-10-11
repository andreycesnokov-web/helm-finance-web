-- Migration 051 — Payment provider connections (foundation)
--
-- Records WHICH payment provider a business intends to receive money through, and where
-- that money should be routed for accounting. It is a routing/config record and nothing
-- more.
--
-- NO CREDENTIALS ARE STORED HERE, BY DESIGN. There is deliberately no api_key,
-- secret_key, webhook_secret, access_token or credentials column, and none may be added
-- to this table later: secrets belong in a secret manager or a dedicated encrypted store
-- with its own access controls and audit trail, not alongside business configuration that
-- ordinary admin queries and support tooling read. `provider_account_id` is a public
-- merchant identifier, not a secret.
--
-- INERT. A row here connects nothing and syncs nothing. No webhook is processed, no
-- provider API is called, no incoming_payment is created from it, and no transaction,
-- debt or wallet balance is touched. `status` records intent, not a live session:
-- 'connected' means an operator has recorded the account, not that a handshake happened.
--
-- ADDITIVE and IDEMPOTENT. One table, one partial unique index, four lookup indexes, one
-- updated_at trigger. No backfill; the table starts empty, matching the default-OFF
-- posture of PAYMENT_CONNECTIONS_ENABLED. Safe to re-run.
--
-- NOTE ON TYPES: businesses.id and wallets.id are UUID; users.id is BIGINT (005/011).

BEGIN;

CREATE TABLE IF NOT EXISTS payment_provider_connections (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- RESTRICT, matching the evidence convention in 031/048: a connection describes how a
  -- workspace receives money, and must not be swept away as a side effect of removing the
  -- workspace. Hard purge stays an explicit admin procedure (D9, archive-first).
  business_id         UUID        NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,

  -- Closed vocabulary: this names an integration this codebase knows how to reason about,
  -- unlike incoming_payments.provider which is free text because a receipt may arrive from
  -- a gateway nobody has integrated. A connection is the opposite -- it is a deliberate
  -- configuration choice, so an unrecognised value is a mistake, not a new provider.
  provider            TEXT        NOT NULL
    CHECK (provider IN ('midtrans','xendit','doku','hitpay','duitku','ipaymu','manual','bank')),

  -- Sandbox by default. Production must be an explicit, deliberate choice.
  environment         TEXT        NOT NULL DEFAULT 'sandbox'
    CHECK (environment IN ('sandbox','production')),

  -- Intent, not a live session. Nothing in this migration or its routes verifies a
  -- provider is reachable, so 'connected' asserts only that an operator recorded it.
  status              TEXT        NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('disconnected','connected','error','disabled')),

  display_name        TEXT        NULL,
  -- Public merchant/account identifier (e.g. a Midtrans merchant id). NOT a secret.
  provider_account_id TEXT        NULL,

  -- Where money from this provider should be routed for accounting. Nullable: a connection
  -- may be recorded before the receiving wallet exists. Same-business ownership is enforced
  -- by the API (wallets.business_id is nullable for legacy rows, so a composite FK is not
  -- available without a backfill -- same constraint as 048).
  linked_wallet_id    UUID        NULL REFERENCES wallets(id) ON DELETE SET NULL,

  -- Observability columns for a LATER sync/webhook phase. Nothing writes them today.
  last_sync_at        TIMESTAMPTZ NULL,
  last_webhook_at     TIMESTAMPTZ NULL,
  last_error          TEXT        NULL,

  created_by_user_id  BIGINT      NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Uniqueness ────────────────────────────────────────────────────────────────────────
-- One connection per (business, provider, environment, account). Partial, because
-- provider_account_id is optional: a business may record several placeholder connections
-- for the same provider before it knows its merchant id, but once an account id is set it
-- must not be registered twice -- that would route the same provider account two ways.
CREATE UNIQUE INDEX IF NOT EXISTS payment_provider_connections_account_uidx
  ON payment_provider_connections (business_id, provider, environment, provider_account_id)
  WHERE provider_account_id IS NOT NULL;

-- ── Lookups ───────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS payment_provider_connections_business_idx
  ON payment_provider_connections (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_provider_connections_provider_idx
  ON payment_provider_connections (provider);
CREATE INDEX IF NOT EXISTS payment_provider_connections_status_idx
  ON payment_provider_connections (status);
CREATE INDEX IF NOT EXISTS payment_provider_connections_wallet_idx
  ON payment_provider_connections (linked_wallet_id)
  WHERE linked_wallet_id IS NOT NULL;

-- ── updated_at trigger (matches 043/045/046/048 — no reliance on callers) ─────────────
CREATE OR REPLACE FUNCTION fn_payment_provider_connections_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_payment_provider_connections_updated_at ON payment_provider_connections;
CREATE TRIGGER trg_payment_provider_connections_updated_at
  BEFORE UPDATE ON payment_provider_connections FOR EACH ROW
  EXECUTE FUNCTION fn_payment_provider_connections_updated_at();

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'payment_provider_connections';
