// Onboarding API client — the migration 054 routes, and nothing else.
//
// Onboarding DESCRIBES the product; it never operates it. Every call here reads flow
// content or records the caller's own progress. Nothing in this file touches
// transactions, wallets, debts, documents, payments, credentials or support.
//
// FLAG: the backend guards every route with ONBOARDING_ENABLED and answers 404 when it is
// off. That is a valid deployment state, not a fault — `isFeatureDisabled` tells the two
// apart so the UI can render an explanatory state instead of an error.
import { getActiveBusinessId } from './api'

const BASE = '/api/onboarding'

// Mirrors server/lib/onboarding.js. The server normalises the locale too; doing it here as
// well means a stray `?locale=zz` in the address bar never reaches the network.
export const SUPPORTED_LOCALES = ['en', 'id', 'ru']
export const FALLBACK_LOCALE = 'en'

// The three seeded flows. Keys are looked up from API data, never assumed to exist: a flow
// the deployment has not seeded simply does not render.
export const FLOW_KEYS = {
  quick: 'quick_business_setup',
  tour: 'full_business_tour',
  accountant: 'ai_accountant_company_setup',
}

/** Normalise a requested locale. Accepts `ru`, `RU`, `ru-RU`; anything else → English. */
export function resolveLocale(requested) {
  if (!requested || typeof requested !== 'string') return FALLBACK_LOCALE
  const base = requested.trim().toLowerCase().split(/[-_]/)[0]
  return SUPPORTED_LOCALES.includes(base) ? base : FALLBACK_LOCALE
}

/**
 * Render-safe text.
 *
 * The user routes resolve `title`/`description`/`instructions` server-side and deliberately
 * withhold the raw `*_i18n` maps. This is the client-side half of that contract: anything
 * that is not a non-empty string renders as the fallback, so an object could never reach
 * the DOM as "[object Object]" or as a dump of every translation.
 */
export function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function fail(status, code, message) {
  const err = new Error(message || code || 'Request failed')
  err.status = status
  err.code = code
  return err
}

/** True when the backend feature flag is off (or the flow was never seeded). */
export function isFeatureDisabled(err) {
  return err?.status === 404 && (err.code === 'not_found' || err.code === 'request_failed')
}

async function request(path, token, { method = 'GET' } = {}) {
  const businessId = getActiveBusinessId()
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Business scope. Absent for a user with no workspace yet — the backend treats that
        // as the null scope and, critically, does NOT provision a business.
        ...(businessId ? { 'x-business-id': businessId } : {}),
      },
    })
  } catch {
    throw fail(0, 'network_error')
  }
  // Parsed defensively: a proxy or a non-JSON 404 must surface as a clean error rather than
  // an unhandled SyntaxError, which would leave the page spinning forever.
  let data = null
  try { data = await res.json() } catch { data = null }
  if (!res.ok) throw fail(res.status, data?.error || 'request_failed', data?.message)
  return data || {}
}

const withLocale = (path, locale) =>
  `${path}${path.includes('?') ? '&' : '?'}locale=${encodeURIComponent(resolveLocale(locale))}`

export const onboardingApi = {
  /** GET /api/onboarding/flows — active flows, text already resolved for `locale`. */
  flows: (token, locale) => request(withLocale('/flows', locale), token),

  /** GET /api/onboarding/flows/:flowKey — one flow with its steps and the caller's progress. */
  flow: (token, flowKey, locale) =>
    request(withLocale(`/flows/${encodeURIComponent(flowKey)}`, locale), token),

  /** GET /api/onboarding/progress — every flow this caller has started, in this scope. */
  progress: (token) => request('/progress', token),

  /** POST /api/onboarding/flows/:flowKey/start */
  start: (token, flowKey) =>
    request(`/flows/${encodeURIComponent(flowKey)}/start`, token, { method: 'POST' }),

  /** POST /api/onboarding/steps/:stepId/view — first-look telemetry; never blocks the UI. */
  view: (token, stepId) =>
    request(`/steps/${encodeURIComponent(stepId)}/view`, token, { method: 'POST' }),

  /** POST /api/onboarding/steps/:stepId/complete */
  complete: (token, stepId) =>
    request(`/steps/${encodeURIComponent(stepId)}/complete`, token, { method: 'POST' }),

  /** POST /api/onboarding/steps/:stepId/skip — rejected by the backend when !skippable. */
  skip: (token, stepId) =>
    request(`/steps/${encodeURIComponent(stepId)}/skip`, token, { method: 'POST' }),

  /** POST /api/onboarding/flows/:flowKey/dismiss — hide the flow, keep the history. */
  dismiss: (token, flowKey) =>
    request(`/flows/${encodeURIComponent(flowKey)}/dismiss`, token, { method: 'POST' }),

  /** POST /api/onboarding/flows/:flowKey/reset — start over; history is kept. */
  reset: (token, flowKey) =>
    request(`/flows/${encodeURIComponent(flowKey)}/reset`, token, { method: 'POST' }),
}

export default onboardingApi
