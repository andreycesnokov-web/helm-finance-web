import { useState, useEffect, useCallback } from 'react'
import { useAuth } from './useAuth'
import { apiFetch, setActiveBusinessId } from '../lib/api'
import { t } from '../i18n/index'

/**
 * useAccess — SaaS plan / trial / limits hook
 *
 * Calls GET /api/access/status on mount and whenever token changes.
 * Returns:
 *   access          — full access object (business, membership, plan, limits, usage)
 *   limits          — shortcut to access.limits (feature flags + numeric caps)
 *   usage           — shortcut to access.usage
 *   loading         — true while fetching
 *   error           — error message string or null
 *   refreshAccess   — call to reload access state (e.g. after plan change)
 *   hasFeature(key) — returns true if boolean feature flag is enabled
 *
 * Helper computed values:
 *   planLabel       — human-readable badge ("Trial · 6d left", "Free Plan", etc.)
 *   isTrialActive   — boolean shortcut
 *   effectivePlan   — string shortcut ("free", "founder", ...)
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
      // Persist active business so every apiFetch carries x-business-id
      if (data?.business?.id) setActiveBusinessId(data.business.id)
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
  const limits        = access?.limits  ?? {}
  const usage         = access?.usage   ?? {}
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
    ? t('aicfo.trialLeft').replace('{n}', plan.days_left_in_trial)
    : (PLAN_LABELS[effectivePlan] || effectivePlan)

  /**
   * hasFeature — check if a boolean feature flag is enabled for current plan.
   * Fails open (returns true) if access has not loaded yet, to avoid false locks.
   * Fails closed (returns false) once loaded and feature is explicitly false.
   */
  const hasFeature = useCallback((featureName) => {
    if (loading) return true          // loading → optimistic open
    if (!access) return true          // no access data → don't hard-block
    return limits[featureName] === true
  }, [loading, access, limits])

  /**
   * isOverLimit — check if a numeric usage limit is reached.
   * Returns false if loading or no access (fail open).
   */
  const isOverLimit = useCallback((limitName, currentUsage) => {
    if (loading || !access) return false
    const cap = limits[limitName]
    if (cap === null || cap === undefined) return false
    return (currentUsage ?? 0) >= cap
  }, [loading, access, limits])

  return {
    access,
    limits,
    usage,
    loading,
    error,
    refreshAccess,
    planLabel,
    isTrialActive,
    effectivePlan,
    hasFeature,
    isOverLimit,
  }
}
