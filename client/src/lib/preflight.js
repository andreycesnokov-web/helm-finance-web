// Cleanup-preflight gating logic, kept in plain JS so it can be unit-tested directly.
//
// FAIL CLOSED: a destructive-ish admin action (archive/restore) may only be offered when the
// backend EXPLICITLY confirms it read every critical metric. Anything else — an older
// backend that never sends the field, a malformed payload, a partial read — must present as
// incomplete. Never treat "not false" as "fine".

// Only the literal boolean true counts as complete.
export function isPreflightComplete(payload) {
  return payload?.preflight_complete === true
}

// 'error'      → nothing usable came back
// 'incomplete' → payload arrived but the backend could not read every critical metric
// 'ok'         → explicitly complete; archive/restore may be offered
export function preflightState(payload) {
  if (!payload || !payload.business || !payload.counts) return 'error'
  return isPreflightComplete(payload) ? 'ok' : 'incomplete'
}

// Tri-state identity/boolean display: true → yes, false → no, null/undefined → unknown.
// Prevents "could not read" from rendering as a confident "not linked".
export function triState(value, { yes = 'linked', no = 'not linked', unknown = 'n/a' } = {}) {
  if (value === true) return yes
  if (value === false) return no
  return unknown
}
