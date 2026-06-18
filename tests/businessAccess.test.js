// Unit tests for the per-business effective access resolver.
// Run: node tests/businessAccess.test.js
const { computeBusinessAccess } = require('../server/lib/businessAccess');

let pass = 0, fail = 0;
const eq = (name, got, exp) => { if (got === exp) { console.log(`OK  ${name} -> ${got}`); pass++; } else { console.log(`XX  ${name} -> ${got} (exp ${exp})`); fail++; } };

const NOW = new Date('2026-06-18T12:00:00Z');
const future = '2026-07-01T00:00:00Z', past = '2026-06-01T00:00:00Z';
const biz = (o) => ({ id: 'b', plan: 'free', subscription_status: null, trial_status: null, trial_ends_at: null, admin_override_plan: null, ...o });
const eff = (o) => computeBusinessAccess(biz(o), NOW).effective_plan;
const src = (o) => computeBusinessAccess(biz(o), NOW).effective_access_source;

// 10.2 access scenarios
eq('Free without trial', eff({}), 'free');
eq('Active future trial -> Founder', eff({ trial_status: 'active', trial_ends_at: future }), 'founder');
eq('Stored active + EXPIRED trial date -> Free', eff({ trial_status: 'active', trial_ends_at: past }), 'free');
eq('Paid Business -> Business', eff({ plan: 'business', subscription_status: 'active' }), 'business');
eq('Active Founder override -> Founder', eff({ admin_override_plan: 'founder', override_started_at: past }), 'founder');
eq('Expired override -> fallback Free', eff({ admin_override_plan: 'founder', override_started_at: past, override_ends_at: past }), 'free');
eq('Override + paid + trial -> override wins', eff({ admin_override_plan: 'enterprise', override_started_at: past, plan: 'business', subscription_status: 'active', trial_status: 'active', trial_ends_at: future }), 'enterprise');
eq('Paid + trial -> paid wins', eff({ plan: 'business', subscription_status: 'active', trial_status: 'active', trial_ends_at: future }), 'business');
eq('Invalid stored plan -> Free', eff({ plan: 'platinum_unicorn' }), 'free');

// sources
eq('source: trial', src({ trial_status: 'active', trial_ends_at: future }), 'trial');
eq('source: subscription', src({ plan: 'business', subscription_status: 'active' }), 'subscription');
eq('source: admin_override', src({ admin_override_plan: 'founder', override_started_at: past }), 'admin_override');
eq('source: free', src({}), 'free');

// stale trial_status reported separately from effective
const stale = computeBusinessAccess(biz({ trial_status: 'active', trial_ends_at: past }), NOW);
eq('stale trial_status reported', stale.trial_status_stored, 'active');
eq('effective trial expired', stale.trial_status_effective, 'expired');

// 'trialing' subscription is NOT paid-active
eq("subscription_status 'trialing' not paid", eff({ plan: 'founder', subscription_status: 'trialing' }), 'free');

// 10.3 multi-business: same function, two businesses, independent results
const A = computeBusinessAccess(biz({ id: 'A' }), NOW);
const B = computeBusinessAccess(biz({ id: 'B', admin_override_plan: 'founder', override_started_at: past }), NOW);
eq('multi-business A independent (free)', A.effective_plan, 'free');
eq('multi-business B independent (founder)', B.effective_plan, 'founder');

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
