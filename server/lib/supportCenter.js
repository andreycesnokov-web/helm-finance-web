// Support Center validation (pure, no I/O, unit-tested).
//
// Correspondence only. Nothing here touches financial data, calls an AI, or sends anything
// anywhere -- it decides whether a submitted conversation or message is well-formed and what
// a given audience is allowed to see.

const CHANNELS = ['in_app', 'email', 'telegram', 'admin_created'];
const STATUSES = ['open', 'waiting_user', 'ai_answered', 'human_needed', 'assigned', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const CATEGORIES = ['general', 'billing', 'accounting', 'documents', 'payment_connections',
                    'incoming_payments', 'tax_compliance', 'bug', 'feature_request'];
const SENDER_TYPES = ['user', 'ai', 'manager', 'system'];
const AI_MODES = ['not_started', 'ai_active', 'handoff_recommended', 'human_only'];
const ESCALATION_REQUESTERS = ['user', 'ai', 'manager', 'system'];

// A user opens a thread from the app; they cannot claim it arrived by email, Telegram, or
// that an admin created it. Those channels are set by the systems that own them.
const USER_CREATABLE_CHANNELS = ['in_app'];
// A user may not self-assign priority above `high`: `urgent` is a triage decision that
// belongs to support staff, or every ticket becomes urgent.
const USER_SETTABLE_PRIORITIES = ['low', 'normal', 'high'];
// Statuses an admin may set directly. `closed` goes through the close path so the closing
// timestamp is always written with it.
const ADMIN_SETTABLE_STATUSES = ['open', 'waiting_user', 'ai_answered', 'human_needed', 'assigned', 'closed'];

const MAX_SUBJECT = 200;
const MAX_BODY = 10000;
const MAX_REASON = 500;

function fail(error, message) { return { ok: false, error, message }; }

function cleanText(raw, max) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s ? s.slice(0, max) : null;
}

/** Validate a user-initiated conversation. */
function validateCreateConversation(body = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected a conversation object.');
  }

  const category = (cleanText(body.category, 50) || 'general').toLowerCase();
  if (!CATEGORIES.includes(category)) {
    return fail('invalid_category', 'Supported categories: ' + CATEGORIES.join(', ') + '.');
  }

  const priority = (cleanText(body.priority, 20) || 'normal').toLowerCase();
  if (!PRIORITIES.includes(priority)) return fail('invalid_priority', 'That priority is not recognised.');
  if (!USER_SETTABLE_PRIORITIES.includes(priority)) {
    return fail('priority_not_settable',
      'Urgent priority is set by the support team after triage.');
  }

  const channel = (cleanText(body.channel, 20) || 'in_app').toLowerCase();
  if (!USER_CREATABLE_CHANNELS.includes(channel)) {
    return fail('invalid_channel', 'Conversations can only be opened in-app.');
  }

  // A first message is optional: someone may open a thread from a "contact support" button
  // and type afterwards. When present it must be real text, not whitespace.
  let firstMessage = null;
  if (body.message !== undefined && body.message !== null) {
    firstMessage = cleanText(body.message, MAX_BODY);
    if (!firstMessage) return fail('empty_message', 'A message cannot be blank.');
  }

  return {
    ok: true,
    value: {
      channel, status: 'open', priority, category,
      subject: cleanText(body.subject, MAX_SUBJECT),
      ai_mode: 'not_started',
      firstMessage,
    },
  };
}

/** Validate a message being appended to an existing thread. */
function validateMessage(body = {}, { allowInternal = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail('invalid_body', 'Expected a message object.');
  }
  const text = cleanText(body.body, MAX_BODY);
  if (!text) return fail('empty_message', 'A message cannot be blank.');
  if (String(body.body).length > MAX_BODY) {
    return fail('message_too_long', `A message cannot exceed ${MAX_BODY} characters.`);
  }

  // Only staff routes pass allowInternal. A user route silently accepting is_internal would
  // let someone hide a message from their own thread, or from the staff reading it.
  const wantsInternal = body.is_internal === true;
  if (wantsInternal && !allowInternal) {
    return fail('internal_not_allowed', 'Internal notes can only be added by the support team.');
  }

  return { ok: true, value: { body: text, is_internal: wantsInternal } };
}

/** Validate an escalation request. */
function validateEscalation(body = {}, requestedBy = 'user') {
  if (!ESCALATION_REQUESTERS.includes(requestedBy)) {
    return fail('invalid_requester', 'Unknown escalation requester.');
  }
  const reason = cleanText(body?.reason, MAX_REASON);
  if (!reason) return fail('missing_reason', 'Tell us briefly why this needs a person.');
  return { ok: true, value: { reason, requested_by: requestedBy, status: 'open' } };
}

/** Validate an admin status change. */
function validateStatusChange(next) {
  const status = cleanText(next, 30)?.toLowerCase();
  if (!status) return fail('missing_status', 'status is required.');
  if (!STATUSES.includes(status)) return fail('invalid_status', 'That status is not recognised.');
  if (!ADMIN_SETTABLE_STATUSES.includes(status)) {
    return fail('status_not_settable', 'That status is set by the system.');
  }
  return { ok: true, value: status };
}

/**
 * What a NON-STAFF audience may see of a message.
 *
 * Internal notes are removed entirely rather than blanked, so their existence, count and
 * timing leak nothing either -- a user counting redacted placeholders learns when staff were
 * talking about them, which is exactly what an internal note is meant to avoid.
 */
function visibleMessagesForUser(rows = []) {
  return rows.filter((m) => m.is_internal !== true).map(toMessageDto);
}

function toMessageDto(m = {}) {
  return {
    id: m.id,
    conversation_id: m.conversation_id,
    sender_type: m.sender_type,
    sender_user_id: m.sender_user_id ?? null,
    body: m.body,
    metadata: m.metadata ?? {},
    is_internal: m.is_internal === true,
    created_at: m.created_at,
  };
}

function toConversationDto(c = {}) {
  return {
    id: c.id,
    business_id: c.business_id ?? null,
    created_by_user_id: c.created_by_user_id,
    assigned_to_user_id: c.assigned_to_user_id ?? null,
    channel: c.channel,
    status: c.status,
    priority: c.priority,
    category: c.category,
    subject: c.subject ?? null,
    ai_mode: c.ai_mode,
    ai_confidence: c.ai_confidence ?? null,
    last_message_at: c.last_message_at ?? null,
    closed_at: c.closed_at ?? null,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

/**
 * May this user see this conversation on a NON-ADMIN route?
 *
 * Two independent grounds: they opened it, or it belongs to the business workspace they are
 * currently acting in. A conversation with no business (opened before the user had one) is
 * reachable only by its creator.
 */
function canUserAccessConversation(conversation, { userId, businessId }) {
  if (!conversation) return false;
  if (String(conversation.created_by_user_id) === String(userId)) return true;
  if (conversation.business_id && businessId && conversation.business_id === businessId) return true;
  return false;
}

module.exports = {
  CHANNELS, STATUSES, PRIORITIES, CATEGORIES, SENDER_TYPES, AI_MODES, ESCALATION_REQUESTERS,
  USER_CREATABLE_CHANNELS, USER_SETTABLE_PRIORITIES, ADMIN_SETTABLE_STATUSES,
  MAX_SUBJECT, MAX_BODY, MAX_REASON,
  validateCreateConversation, validateMessage, validateEscalation, validateStatusChange,
  visibleMessagesForUser, toMessageDto, toConversationDto, canUserAccessConversation,
};
