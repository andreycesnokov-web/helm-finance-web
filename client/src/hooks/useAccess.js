import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { apiFetch } from '../lib/api'

/**
 * useAccess — SaaS plan / trial / limits hook
 *
 * Calls GET /api/access/status on mount and whenever token changes.
 * Returns:
 *   access        — full access object (business, membership, plan, limits, usage)
 *   loading       — true while fetching
 *   error         — error message string or null
 *   refreshAccess — call to reload access state (e.g. after plan change)
 *
 * Helper computed values:
 *   planLabel     — human-readable badge ("Trial · 6d left", "Free Plan", etc.)
 *   isTrialActive — boolean shortcut
 *   effectivePlan — string shortcut ("free", "founder", ...)
 */
export function useAccess() {
  const { token } = useAuth()
  const [access,  setAccess]  = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const refreshAccess = useCallback(async () => {
    if (!token) { setLoading(false); return }
    setLoading(true)
    try {
      const data = await apiFetch('/access/status', token)
      setAccess(data)
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => { refreshAccess() }, [refreshAccess])

  // ── Computed helpers ──────────────────────────────────────────────────────
  const plan          = access?.plan
  const isTrialActive = plan?.is_trial_active  ?? false
  const effectivePlan = plan?.effective_plan   ?? 'free'

  const PLAN_LABELS = {
    free:       'Free Plan',
    starter:    'Starter',
    business:   'Business',
    founder:    'Founder',
    enterprise: 'Enterprise',
  }

  const planLabel = isTrialActive
    ? `Trial · ${plan.days_left_in_trial}d left`
    : (PLAN_LABELS[effectivePlan] || effectivePlan)

  return { access, loading, error, refreshAccess, planLabel, isTrialActive, effectivePlan }
}
