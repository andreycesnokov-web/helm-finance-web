-- Migration 053 — Support Center foundation
--
-- In-app support conversations: a user opens a thread, an AI answers first (later), and a
-- human manager takes over when the AI is out of its depth (later). This migration builds
-- the record-keeping only.
--
-- FOUNDATION ONLY. Nothing here calls an AI, sends an email, opens a websocket, or reaches
-- an external helpdesk. `ai_mode` and `ai_confidence` are columns an AI phase will write;
-- today nothing sets them beyond their defaults.
--
-- NO FINANCIAL EFFECT. Support records are correspondence. Nothing in this migration or its
-- routes touches transactions, wallets, debts, incoming_payments, payment connections or
-- credentials. A support conversation can describe money; it can never move it.
--
-- ⚠ SECRETS MUST NOT BE POSTED HERE. `support_messages.body` is plaintext by design -- it is
-- correspondence, and redacting it would make threads unreadable. There is deliberately NO
-- automatic redaction in v1. That means a user or manager who pastes an API key, a password
-- or a card number into a message has stored it in the clear, readable by anyone with
-- support access and preserved in backups. The UI must warn against it, support staff must
-- be trained not to ask for secrets, and a later phase should add detection/redaction before
-- this is opened to a wide audience. Credentials belong in the vault (052), never in a
-- message body.
--
-- ADDITIVE and IDEMPOTENT. Four tables, eleven indexes, three functions, three triggers.
-- No backfill; all four tables start empty, matching the default-OFF posture of
-- SUPPORT_CENTER_ENABLED. Safe to re-run.
--
-- NOTE ON TYPES: businesses.id is UUID; users.id is BIGINT (005/011).

BEGIN;

-- ── 1. Conversations ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_conversations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- NULLABLE on purpose: a user with no business yet (a fresh email signup, someone stuck
  -- during onboarding) is exactly the person most likely to need support. A NOT NULL here
  -- would lock out the case support exists for.
  business_id          UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by_user_id   BIGINT      NOT NULL REFERENCES users(id),
  assigned_to_user_id  BIGINT      NULL REFERENCES users(id),

  channel              TEXT        NOT NULL DEFAULT 'in_app'
    CHECK (channel IN ('in_app','email','telegram','admin_created')),
  status               TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','waiting_user','ai_answered','human_needed','assigned','closed')),
  priority             TEXT        NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  category             TEXT        NOT NULL DEFAULT 'general'
    CHECK (category IN ('general','billing','accounting','documents','payment_connections',
                        'incoming_payments','tax_compliance','bug','feature_request')),
  subject              TEXT        NULL,

  -- Reserved for the AI phase. Nothing writes these today.
  ai_mode              TEXT        NOT NULL DEFAULT 'not_started'
    CHECK (ai_mode IN ('not_started','ai_active','handoff_recommended','human_only')),
  ai_confidence        NUMERIC(5,4) NULL
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),

  last_message_at      TIMESTAMPTZ NULL,
  closed_at            TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A closed conversation carries its closing time, and an open one does not. Without this a
  -- "closed" thread with no closed_at would silently break any resolution-time reporting.
  CONSTRAINT support_conversations_closed_stamp CHECK (
    (status = 'closed' AND closed_at IS NOT NULL)
    OR (status <> 'closed' AND closed_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS support_conversations_business_idx
  ON support_conversations (business_id, last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS support_conversations_creator_idx
  ON support_conversations (created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_conversations_status_idx
  ON support_conversations (status);
CREATE INDEX IF NOT EXISTS support_conversations_priority_idx
  ON support_conversations (priority);
CREATE INDEX IF NOT EXISTS support_conversations_last_message_idx
  ON support_conversations (last_message_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS support_conversations_assignee_idx
  ON support_conversations (assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

-- ── 2. Messages ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_messages (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id      UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,

  sender_type      TEXT        NOT NULL CHECK (sender_type IN ('user','ai','manager','system')),
  sender_user_id   BIGINT      NULL REFERENCES users(id),

  -- ⚠ Plaintext correspondence. See the header note: no secret, API key, password or card
  -- number may be posted here, and nothing redacts one automatically in v1.
  body             TEXT        NOT NULL CHECK (length(trim(body)) > 0),
  metadata         JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- TRUE = an internal note between staff. The user-facing API must never return these.
  -- Defaulting to FALSE is the safe direction: a note accidentally created with the default
  -- is merely visible to the user who is already in the thread, whereas the reverse default
  -- would hide a genuine reply from the person waiting for it.
  is_internal      BOOLEAN     NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Only staff write internal notes. A user or the AI marking a message internal would hide
  -- it from the very person the thread belongs to.
  CONSTRAINT support_messages_internal_sender CHECK (
    is_internal = false OR sender_type IN ('manager','system')
  )
);

CREATE INDEX IF NOT EXISTS support_messages_conversation_idx
  ON support_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS support_messages_business_idx
  ON support_messages (business_id, created_at DESC);

-- ── 3. Escalations ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_escalations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID        NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id          UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,

  reason               TEXT        NOT NULL CHECK (length(trim(reason)) > 0),
  status               TEXT        NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','assigned','resolved','cancelled')),
  requested_by         TEXT        NOT NULL DEFAULT 'ai'
    CHECK (requested_by IN ('user','ai','manager','system')),

  assigned_to_user_id  BIGINT      NULL REFERENCES users(id),
  resolved_by_user_id  BIGINT      NULL REFERENCES users(id),
  resolved_at          TIMESTAMPTZ NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A resolved escalation records when it was resolved; an unresolved one does not claim to.
  CONSTRAINT support_escalations_resolved_stamp CHECK (
    (status IN ('resolved','cancelled') AND resolved_at IS NOT NULL)
    OR (status IN ('open','assigned') AND resolved_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS support_escalations_status_idx
  ON support_escalations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_escalations_business_idx
  ON support_escalations (business_id, status);
CREATE INDEX IF NOT EXISTS support_escalations_conversation_idx
  ON support_escalations (conversation_id, created_at DESC);

-- ── 4. Events (append-only history of what happened to a thread) ─────────────────────────
CREATE TABLE IF NOT EXISTS support_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
  business_id      UUID        NULL REFERENCES businesses(id) ON DELETE CASCADE,
  actor_user_id    BIGINT      NULL REFERENCES users(id),
  event_type       TEXT        NOT NULL CHECK (length(trim(event_type)) > 0),
  -- ⚠ Never put a message body or anything secret in here. This is a timeline, not a copy
  -- of the correspondence.
  event_payload    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_events_conversation_idx
  ON support_events (conversation_id, created_at);

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────

-- updated_at on conversations, matching 043/045/046/048/051.
CREATE OR REPLACE FUNCTION fn_support_conversations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_support_conversations_updated_at ON support_conversations;
CREATE TRIGGER trg_support_conversations_updated_at
  BEFORE UPDATE ON support_conversations FOR EACH ROW
  EXECUTE FUNCTION fn_support_conversations_updated_at();

-- A new message advances the conversation clock and records a timeline event, in the
-- database rather than in the route. Two callers already exist (user reply, internal note)
-- and an AI writer is coming; keeping this here means every writer gets it, including a
-- future one nobody remembers to update.
--
-- Deliberately does NOT change `status`: whether a reply means waiting_user, ai_answered or
-- human_needed is a policy decision that belongs to the application, not to an INSERT.
CREATE OR REPLACE FUNCTION fn_support_message_touch_conversation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE support_conversations
     SET last_message_at = NEW.created_at
   WHERE id = NEW.conversation_id;

  INSERT INTO support_events (conversation_id, business_id, actor_user_id, event_type, event_payload)
  VALUES (NEW.conversation_id, NEW.business_id, NEW.sender_user_id, 'message_created',
          -- Metadata only. The body stays in support_messages and is never copied here.
          jsonb_build_object('message_id', NEW.id,
                             'sender_type', NEW.sender_type,
                             'is_internal', NEW.is_internal));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_support_message_touch_conversation ON support_messages;
CREATE TRIGGER trg_support_message_touch_conversation
  AFTER INSERT ON support_messages FOR EACH ROW
  EXECUTE FUNCTION fn_support_message_touch_conversation();

-- A new conversation gets its opening timeline entry the same way.
CREATE OR REPLACE FUNCTION fn_support_conversation_created_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO support_events (conversation_id, business_id, actor_user_id, event_type, event_payload)
  VALUES (NEW.id, NEW.business_id, NEW.created_by_user_id, 'conversation_created',
          jsonb_build_object('channel', NEW.channel, 'category', NEW.category,
                             'priority', NEW.priority));
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_support_conversation_created_event ON support_conversations;
CREATE TRIGGER trg_support_conversation_created_event
  AFTER INSERT ON support_conversations FOR EACH ROW
  EXECUTE FUNCTION fn_support_conversation_created_event();

COMMIT;

-- ── Verification ──────────────────────────────────────────────────────────────────────────
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('support_conversations','support_messages','support_escalations','support_events')
ORDER BY table_name;
