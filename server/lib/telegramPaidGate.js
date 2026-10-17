'use strict';

/**
 * Creates the Telegram Paid Gate evaluator.
 * Controls access to Telegram bot financial endpoints for both legacy and commercial V2 companies.
 *
 * Entitlement rules:
 * 1. If both TELEGRAM_PAID_GATE_ENABLED and COMMERCIAL_BILLING_ENABLED are false, gate is dark (returns null).
 * 2. Commercial V2 companies (billing_policy === 'commercial_v2'):
 *    - Allowed if the company has an active commercial trial (e.g. Pro, Control, Starter), active paid subscription,
 *      or active admin override grant (restricted === false).
 *    - Denied with 402 telegram_paid_plan_required if access is restricted (trial expired or no active entitlement).
 * 3. Legacy companies (billing_policy !== 'commercial_v2'):
 *    - Allowed if TELEGRAM_PAID_GATE_ENABLED is false.
 *    - When TELEGRAM_PAID_GATE_ENABLED is true, allowed only if effective_plan !== 'free'.
 *    - Denied with 402 telegram_paid_plan_required if effective_plan === 'free'.
 */
function createTelegramPaidGate({
  supabase,
  getBusinessAccess,
  computeBusinessAccess,
  isTelegramPaidGateEnabled = () => process.env.TELEGRAM_PAID_GATE_ENABLED === 'true',
  isCommercialBillingEnabled = () => process.env.COMMERCIAL_BILLING_ENABLED === 'true',
}) {
  return async function telegramPaidGate(businessId, actorUserId = null) {
    const paidGateEnabled = typeof isTelegramPaidGateEnabled === 'function' ? isTelegramPaidGateEnabled() : !!isTelegramPaidGateEnabled;
    const commercialEnabled = typeof isCommercialBillingEnabled === 'function' ? isCommercialBillingEnabled() : !!isCommercialBillingEnabled;

    if ((!paidGateEnabled && !commercialEnabled) || !businessId) return null;

    const { data } = await supabase.from('businesses').select('*').eq('id', businessId).limit(1);
    const business = data?.[0];
    if (!business) return null; // let the route's own not-found handling answer

    // Commercial V2: resolve company subscription / trial access
    if (commercialEnabled && business.billing_policy === 'commercial_v2') {
      const actor = actorUserId || business.owner_user_id;
      let accessInfo = actor ? await getBusinessAccess(actor, business.id).catch(() => null) : null;
      if (!accessInfo && business.owner_user_id && business.owner_user_id !== actor) {
        accessInfo = await getBusinessAccess(business.owner_user_id, business.id).catch(() => null);
      }
      if (!accessInfo || !accessInfo.access || accessInfo.access.restricted) {
        return {
          error: 'telegram_paid_plan_required',
          message: 'The Telegram assistant is a paid add-on. Upgrade your plan in CFO AI (app.cfo-ai.site → Settings) to keep using it.',
          upgrade_url: 'https://app.cfo-ai.site/business/settings',
        };
      }
      return null;
    }

    // Legacy V1 policy: free plan requires upgrade when paid gate is ON
    if (!paidGateEnabled) return null;
    if (computeBusinessAccess(business).effective_plan !== 'free') return null;
    return {
      error: 'telegram_paid_plan_required',
      message: 'The Telegram assistant is a paid add-on. Upgrade your plan in CFO AI (app.cfo-ai.site → Settings) to keep using it.',
      upgrade_url: 'https://app.cfo-ai.site/business/settings',
    };
  };
}

module.exports = { createTelegramPaidGate };
