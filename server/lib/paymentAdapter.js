'use strict';
// Business + Platform/admin. Provider-neutral payment adapter CONTRACT for commercial billing (Phase 2).
// No provider is connected: the only adapter is 'none', which refuses everything. Business logic never
// depends on a provider: a verified, normalized event is the only thing that may later become a
// billing_service_periods row (payment_verified=true) — never a redirect, a status page or a client claim.
//
// An adapter implements:
//   createCheckout({businessId, planVersionId, interval:'month'|'year', amountMinor, currency, idempotencyKey, returnUrl})
//     → {checkoutUrl, providerReference}                     (no access is granted at this point)
//   verifyWebhook(rawBody:Buffer, headers) → boolean          (signature / callback token, constant-time)
//   parseEvent(rawBody) → NormalizedEvent                      (see validateEvent)
//   fetchPayment(providerPaymentId) → NormalizedEvent          (server-side re-check before granting access)
const EVENT_TYPES = ['payment_succeeded', 'payment_failed', 'payment_refunded', 'subscription_renewed', 'subscription_cancelled'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A normalized event is accepted only when every field needed for an exact, idempotent grant is present.
function validateEvent(e) {
  const bad = (why) => { throw Object.assign(new Error('payment_event_invalid'), { why }) };
  if (!e || typeof e !== 'object') bad('object');
  if (!EVENT_TYPES.includes(e.type)) bad('type');
  if (typeof e.provider !== 'string' || !e.provider) bad('provider');
  if (typeof e.eventId !== 'string' || !e.eventId) bad('eventId');                 // idempotency of delivery
  if (typeof e.providerPaymentId !== 'string' || !e.providerPaymentId) bad('providerPaymentId');
  if (!UUID.test(e.businessId || '') || !UUID.test(e.planVersionId || '')) bad('ids');
  if (!Number.isSafeInteger(e.amountMinor) || e.amountMinor < 0 || !/^[A-Z]{3}$/.test(e.currency || '')) bad('amount');
  if (!['sandbox', 'live'].includes(e.environment)) bad('environment');
  if (['payment_succeeded', 'subscription_renewed'].includes(e.type)) {
    const a = Date.parse(e.periodStart), b = Date.parse(e.periodEnd);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) bad('period');
  }
  return e;
}

const none = {
  name: 'none',
  connected: false,
  createCheckout: async () => { throw new Error('payments_not_connected') },
  verifyWebhook: () => false,
  parseEvent: () => { throw new Error('payments_not_connected') },
  fetchPayment: async () => { throw new Error('payments_not_connected') },
};
// Eventstripe (event ticketing, Xendit-based) and direct Xendit are NOT adapters here: neither is verified for
// SaaS subscriptions of CFO AI. See the billing enforcement report for the open questions.
function adapter() { return none }

module.exports = { EVENT_TYPES, validateEvent, adapter };
