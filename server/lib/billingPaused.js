'use strict';
// Business. COMMERCIAL_BILLING_ENABLED=false for a commercial_v2 company = "billing paused": an operational kill
// switch, not a commercial state (V2_DYNAMIC_PLAN_MATRIX.md §6).
//  - Legacy Free limits NEVER apply to a commercial_v2 company.
//  - The company keeps the features of its effective plan version (trial / grant / paid), else of its selected
//    version, else the core financial set. Quotas are not counted and expiry does not restrict.
//  - Features that cost money outside the company (AI, AI Accountant, MCP/API, payment integrations) are refused:
//    they cannot run unmetered.
const CORE = { transactions: true, accounts: true, bills: true, documents: true, import: true, export: true, pulse: true, radar: true };
const COSTLY = ['ai', 'cfo_ai', 'ai_accountant', 'api', 'integrations'];

async function pausedAccess(supabase, business) {
  let features = null, plan = null;
  const { data: terms, error } = await supabase.rpc('billing_effective_terms', { p_business: business.id });
  if (error) throw error;
  if (terms && terms.features) { features = { ...terms.features }; plan = terms.plan; }
  else {
    const { data: acct } = await supabase.from('billing_accounts').select('selected_plan_version_id').eq('business_id', business.id).maybeSingle();
    if (acct && acct.selected_plan_version_id) {
      const [{ data: v }, { data: d }] = await Promise.all([
        supabase.from('plan_versions').select('plan, features').eq('id', acct.selected_plan_version_id).maybeSingle(),
        supabase.rpc('billing_feature_defaults')]);
      if (v) { features = { ...((d && d.absent) || {}), ...(v.features || {}), ...((d && d.always) || {}) }; plan = v.plan; }
    }
  }
  if (!features) features = { ...CORE };
  for (const k of COSTLY) features[k] = false;
  return {
    policy: 'commercial_paused', plan: plan || 'none', features,
    // Legacy-shaped limits: null = not limited (legacy checks skip null); AI/voice 0 = refused.
    limits: {
      max_businesses: null, max_users: null, max_wallets: null, max_transactions_per_month: null, max_invoices_per_month: null,
      max_ai_questions_per_month: 0, max_voice_inputs_per_month: 0,
      payroll_enabled: features.payroll === true, team_access_enabled: features.team === true, approval_flow_enabled: features.approvals === true,
      advanced_radar_enabled: features.radar === true, export_enabled: true, integrations_enabled: false,
    },
  };
}

module.exports = { pausedAccess, CORE, COSTLY };
