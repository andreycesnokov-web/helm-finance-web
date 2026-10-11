// Per-business effective access resolver (pure, unit-tested).
// Priority: active admin override > active paid subscription > active full trial
// > stored/default free. Trial is effective ONLY by trial_ends_at, never by the
// stale trial_status field. Stored / subscription / trial / override are reported
// SEPARATELY and never merged into one field.
const VALID_PLANS = ['free', 'starter', 'business', 'founder', 'enterprise'];

function computeBusinessAccess(business, now = new Date()) {
  const trialEnd = business.trial_ends_at ? new Date(business.trial_ends_at) : null;
  const trialEffectiveActive = !!(trialEnd && now < trialEnd);
  const overrideStart = business.override_started_at ? new Date(business.override_started_at) : null;
  const overrideEnd = business.override_ends_at ? new Date(business.override_ends_at) : null;
  const overrideActive = !!(business.admin_override_plan && VALID_PLANS.includes(business.admin_override_plan)
    && (!overrideStart || overrideStart <= now) && (!overrideEnd || overrideEnd > now));
  // Only an explicitly 'active' subscription counts as paid (NOT trialing/cancelled/past_due/expired).
  const subActive = business.subscription_status === 'active' && VALID_PLANS.includes(business.plan) && business.plan !== 'free';

  let effective_plan, source;
  if (overrideActive) { effective_plan = business.admin_override_plan; source = 'admin_override'; }
  else if (subActive) { effective_plan = business.plan; source = 'subscription'; }
  else if (trialEffectiveActive) { effective_plan = 'founder'; source = 'trial'; }
  else { effective_plan = 'free'; source = 'free'; }

  const daysLeft = trialEffectiveActive ? Math.max(0, Math.ceil((trialEnd - now) / 86400000)) : 0;
  return {
    business_id: business.id, business_code: business.business_code || null,
    stored_plan: VALID_PLANS.includes(business.plan) ? business.plan : 'free',
    subscription_plan: subActive ? business.plan : null,
    subscription_status: business.subscription_status || null,
    subscription_active: subActive,
    trial_status_stored: business.trial_status || null,
    trial_status_effective: trialEffectiveActive ? 'active' : (trialEnd ? 'expired' : 'none'),
    trial_started_at: business.trial_started_at || null,
    trial_ends_at: business.trial_ends_at || null,
    trial_plan: trialEffectiveActive ? 'founder' : null,
    admin_override_plan: business.admin_override_plan || null,
    override_started_at: business.override_started_at || null,
    override_ends_at: business.override_ends_at || null,
    override_active: overrideActive,
    effective_plan, effective_access_source: source, daysLeft,
  };
}

module.exports = { VALID_PLANS, computeBusinessAccess };
