// Per-business effective access resolver (pure, unit-tested).
// Priority: active admin override > active paid subscription > active full trial
// > stored/default free. Trial is effective ONLY by trial_ends_at, never by the
// stale trial_status field. Stored / subscription / trial / override are reported
// SEPARATELY and never merged into one field.
const VALID_PLANS = ['free', 'starter', 'business', 'founder', 'enterprise'];

function computeBusinessAccess(business, now = new Date(), billing = null) {
  // Only a server-loaded, company-scoped billing snapshot opts into V2 policy.
  // Missing snapshots preserve the existing legacy policy until explicit migration.
  if (billing !== null) return computeCommercialAccess(business, now, billing);
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

const TRIAL_DURATION_MS = 168 * 60 * 60 * 1000;
const instant = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ? Date.parse(value) : NaN;
function intervalActive(start, end, now) {
  const a = instant(start), b = instant(end);
  return Number.isFinite(a) && Number.isFinite(b) && a < b && a <= now && now < b;
}
function computeCommercialAccess(business, now, billing) {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new Error('billing_invalid_server_time');
  if (!billing || String(billing.business_id) !== String(business.id)) throw new Error('billing_company_mismatch');
  // This projection never creates trials, changes roles or infers a payment from status.
  // Storage must supply immutable snapshots and verified payment-backed periods.
  const versions = new Map((billing.plan_versions || []).map(v => [String(v.id), v]));
  const version = id => {
    const v = versions.get(String(id));
    return v && typeof v.plan === 'string' && v.plan && v.terms_version
      && v.features && typeof v.features === 'object' && !Array.isArray(v.features)
      && v.limits && typeof v.limits === 'object' && !Array.isArray(v.limits) ? v : null;
  };
  const trialStart = instant(billing.trial_started_at), trialEnd = instant(billing.trial_ends_at);
  // An audited admin extension may exceed 168h; a client clock cannot extend access.
  const extension = billing.trial_extension;
  const validExtension = extension && extension.audit_id && extension.reason?.trim()
    && extension.after === billing.trial_ends_at && Number.isFinite(instant(extension.before))
    && instant(extension.before) >= trialStart + TRIAL_DURATION_MS
    && trialEnd > instant(extension.before);
  const validTrial = Number.isFinite(trialStart) && Number.isFinite(trialEnd)
    && (trialEnd - trialStart === TRIAL_DURATION_MS || validExtension);
  const trialVersion = version(billing.selected_plan_version_id);
  const trialActive = !!(validTrial && trialVersion && trialStart <= time && time < trialEnd);
  const grants = (billing.grants || []).filter(g => String(g.business_id) === String(business.id)
    && !g.revoked_at && g.audit_id && typeof g.reason === 'string' && g.reason.trim()
    && version(g.plan_version_id) && intervalActive(g.starts_at, g.ends_at, time));
  // Deterministic selection: persistence must prevent overlapping unrevoked grants.
  grants.sort((a,b) => instant(b.starts_at)-instant(a.starts_at) || String(a.id).localeCompare(String(b.id)));
  const periods = (billing.service_periods || []).filter(p => String(p.business_id) === String(business.id)
    && p.payment_id && p.payment_verified === true && !p.revoked_at
    && p.environment === billing.environment && ['sandbox','live'].includes(p.environment)
    && version(p.plan_version_id) && intervalActive(p.starts_at, p.ends_at, time));
  periods.sort((a,b) => instant(b.starts_at)-instant(a.starts_at) || String(a.id).localeCompare(String(b.id)));
  const grant = grants[0], paid = periods[0];
  const selected = grant ? version(grant.plan_version_id) : paid ? version(paid.plan_version_id) : trialActive ? trialVersion : null;
  const source = grant ? 'admin_override' : paid ? 'subscription' : trialActive ? 'trial' : 'restricted';
  const state = paid ? 'active' : trialActive ? 'trialing'
    : billing.pending_payment_id ? 'pending_payment' : Number.isFinite(trialStart) ? 'expired' : 'not_started';
  return {
    business_id: business.id, business_code: business.business_code || null,
    policy: 'commercial_v2', server_now: now.toISOString(), version: billing.version,
    effective_plan: selected?.plan || 'free', effective_plan_version_id: selected?.id || null,
    selected_plan_version_id: billing.selected_plan_version_id || null,
    effective_access_source: source, restricted: !selected,
    subscription_status: state, subscription_active: !!paid,
    subscription_plan: paid ? version(paid.plan_version_id).plan : null,
    paid_period_ends_at: paid?.ends_at || null, cancel_at_period_end: billing.cancel_at_period_end === true,
    trial_started_at: billing.trial_started_at || null, trial_ends_at: billing.trial_ends_at || null,
    trial_status_effective: trialActive ? 'active' : validTrial && time >= trialEnd ? 'expired' : 'none',
    trial_plan: trialActive ? trialVersion.plan : null,
    daysLeft: trialActive ? Math.ceil((trialEnd-time)/86400000) : 0,
    trial_seconds_remaining: trialActive ? Math.ceil((trialEnd-time)/1000) : 0,
    override_active: !!grant, override_ends_at: grant?.ends_at || null,
    // Clone so a caller cannot mutate a version snapshot through this result.
    features: selected ? structuredClone(selected.features) : {},
    limits: selected ? structuredClone(selected.limits) : {},
  };
}

module.exports = { VALID_PLANS, computeBusinessAccess, TRIAL_DURATION_MS };
