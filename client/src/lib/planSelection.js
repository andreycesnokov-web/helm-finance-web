export const VALID_COMMERCIAL_PLANS = ['starter', 'control', 'pro']
export const PLAN_STORAGE_KEY = 'cfo_selected_plan'

export const PLAN_DETAILS = {
  starter: {
    code: 'starter',
    name: 'Starter',
    priceUsd: 59,
    priceMonthly: '$59',
    trialDays: 7,
    trialHours: 168,
    featuresSummary: '1 company, 5 users',
  },
  control: {
    code: 'control',
    name: 'Control',
    priceUsd: 149,
    priceMonthly: '$149',
    trialDays: 7,
    trialHours: 168,
    featuresSummary: '2 companies, 10 users',
  },
  pro: {
    code: 'pro',
    name: 'Pro',
    priceUsd: 249,
    priceMonthly: '$249',
    trialDays: 7,
    trialHours: 168,
    featuresSummary: '5 companies, 30 users',
  },
}

export function normalizePlan(plan) {
  if (!plan || typeof plan !== 'string') return null
  const p = plan.trim().toLowerCase()
  return VALID_COMMERCIAL_PLANS.includes(p) ? p : null
}

export function captureSelectedPlan(search) {
  try {
    const rawSearch = search !== undefined ? search : (typeof window !== 'undefined' ? window.location.search : '')
    if (rawSearch) {
      const params = new URLSearchParams(rawSearch)
      const p = normalizePlan(params.get('plan'))
      if (p) {
        localStorage.setItem(PLAN_STORAGE_KEY, p)
        return p
      }
    }
  } catch {
    // Ignore storage issues in restricted modes
  }
  return getSelectedPlan()
}

export function getSelectedPlan() {
  try {
    if (typeof localStorage === 'undefined') return null
    const stored = localStorage.getItem(PLAN_STORAGE_KEY)
    return normalizePlan(stored)
  } catch {
    return null
  }
}

export function clearSelectedPlan() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(PLAN_STORAGE_KEY)
    }
  } catch {}
}

export function appendPlanParam(path, plan = getSelectedPlan()) {
  if (!plan || !path) return path
  try {
    const [base, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    if (!params.has('plan')) {
      params.set('plan', plan)
    }
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  } catch {
    return path
  }
}
