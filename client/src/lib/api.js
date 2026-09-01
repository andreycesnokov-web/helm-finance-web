const BASE = '/api'

// Active business workspace — set by useAccess after /access/status,
// or by a future business switcher. All financial API calls carry it.
export function getActiveBusinessId() {
  try { return localStorage.getItem('activeBusinessId') || null } catch { return null }
}
export function setActiveBusinessId(id) {
  try {
    if (id) localStorage.setItem('activeBusinessId', id)
    else localStorage.removeItem('activeBusinessId')
  } catch { /* private mode */ }
}

// One-shot post-login destination (e.g. /invite/CODE set by JoinInvite before sending
// the user to email sign-in). Same-app paths only — never an external URL.
export function consumePostLoginRedirect() {
  try {
    const r = localStorage.getItem('post_login_redirect')
    localStorage.removeItem('post_login_redirect')
    if (r && r.startsWith('/') && !r.startsWith('//')) return r
  } catch { /* private mode */ }
  return null
}

export async function apiFetch(path, token, options = {}) {
  const businessId = getActiveBusinessId()
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(businessId ? { 'x-business-id': businessId } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await res.json()
  if (!res.ok) {
    // Stale/inaccessible workspace: clear the active id so the next load re-picks a
    // valid one (WorkspaceProvider refetches /api/workspaces). Only on explicit 403.
    if (res.status === 403 && data?.error === 'workspace_not_accessible') {
      try { setActiveBusinessId(null) } catch { /* */ }
    }
    // Keep the whole error payload: routes return actionable detail alongside the
    // code (e.g. upload-init 409 duplicate carries existing_document_id). Callers
    // that only read err.message/err.status are unaffected.
    const err = new Error(data.error || 'Request failed')
    err.status = res.status; err.code = data?.error || null; err.data = data
    throw err
  }
  return data
}

export function fmt(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(1) + 'B'
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(1) + 'M'
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(0) + 'K'
  return num.toLocaleString('ru-RU')
}

export function fmtFull(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return num.toLocaleString('ru-RU')
}

export function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - new Date()) / 86400000)
}
