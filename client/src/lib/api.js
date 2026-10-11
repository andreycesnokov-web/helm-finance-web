const BASE = '/api'
const pendingCreates = new Map()

// Only guarded keyed RPCs support these receipts. Preserve an unknown
// intent across a page reload without storing the financial payload or token.
async function createIntent(path, token, businessId, options) {
  const field = /^\/debts\/[^/]+\/pay$/.test(path) ? 'idempotency_key' : path === '/wallets/transfer' ? 'transfer_id' : 'request_key'
  const payload = { ...options.body }; delete payload[field]
  const bytes = new TextEncoder().encode(JSON.stringify([token, businessId, path, payload]))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const storageKey = 'financialCreateIntent:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
  let key = pendingCreates.get(storageKey)
  try { key ||= localStorage.getItem(storageKey) } catch { /* private mode */ }
  key ||= options.body[field] || crypto.randomUUID()
  pendingCreates.set(storageKey, key)
  try { localStorage.setItem(storageKey, key) } catch { /* memory survives while the page is open */ }
  return { key, field, clear() {
    pendingCreates.delete(storageKey)
    try { localStorage.removeItem(storageKey) } catch { /* */ }
  } }
}

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
  const mutation = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())
    && /^\/(transactions|wallets|debts|payroll|bank-imports?|personal\/(wallets|transactions)|funding)(\/|$)/.test(path)
  const unconfirmed = (cause) => {
    if (!mutation) throw cause
    let lang = 'en'; try { lang = localStorage.getItem('hf_lang') || 'en' } catch { /* */ }
    const messages = {
      en: 'The result could not be confirmed. Refresh the operation status before resubmitting. Keep the original payment or transfer request open.',
      ru: 'Результат не подтверждён. Обновите статус операции перед повтором. Сохраните открытым текущий платёж или перевод.',
      id: 'Hasil belum terkonfirmasi. Muat ulang status sebelum mengirim lagi. Pertahankan permintaan pembayaran atau transfer ini.'
    }
    const err = new Error(messages[lang] || messages.en)
    err.code = 'financial_outcome_unknown'; err.cause = cause
    err.data = { error: err.code, outcome: 'unknown', automatic_retry: false }
    throw err
  }
  // V2 forms pass an explicit request identity. Bare tokens keep the legacy API.
  const scoped = token && typeof token === 'object'
  const identity = scoped ? token : null
  const assertCurrent = () => {
    if (identity && (!identity.businessId || !identity.isCurrent())) {
      const err = new Error('workspace_changed')
      err.name = 'AbortError'; err.code = 'workspace_changed'
      throw err
    }
  }
  assertCurrent()
  const businessId = scoped ? identity.businessId : (options.headers?.['x-business-id'] || getActiveBusinessId())
  const keyedPayment = /^\/debts\/[^/]+\/pay$/.test(path) || path === '/wallets/transfer'
  const guardedCreate = String(options.method).toUpperCase() === 'POST' && options.body
    && !options.headers?.['Idempotency-Key'] && !options.headers?.['idempotency-key']
    && (keyedPayment || (!options.body.request_key && (['/wallets','/transactions/batch'].includes(path) || /^\/wallets\/[^/]+\/adjust-balance$/.test(path))))
  const intent = guardedCreate ? await createIntent(path, scoped ? identity.token : token, businessId, options) : null
  assertCurrent()
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${scoped ? identity.token : token}`,
      ...(businessId ? { 'x-business-id': businessId } : {}),
      ...options.headers,
      ...(scoped ? { 'x-business-id': businessId } : {})
    },
    body: options.body ? JSON.stringify(intent ? { ...options.body, [intent.field]: intent.key } : options.body) : undefined
  }).catch((e) => { assertCurrent(); return unconfirmed(e) })
  let data = null
  const text = await res.text().catch((e) => { assertCurrent(); return unconfirmed(e) })
  assertCurrent()
  if (mutation && res.ok && !text) return unconfirmed(new Error('Empty financial response'))
  try {
    data = text ? JSON.parse(text) : {}
  } catch (parseError) {
    // A successful HTML/proxy response is not a confirmed financial booking.
    if (res.ok) return unconfirmed(parseError)
    data = { error: text || res.statusText || 'Request failed' }
  }
  if (mutation && res.ok && (data?.error || data?.ok === false))
    return unconfirmed(new Error('Financial response did not confirm success'))
  if (!res.ok) {
    // A proxy/backend 5xx can arrive after commit. Only an explicit database
    // rollback permits treating it as cancelled; retain the original intent.
    if (mutation && res.status >= 500 && data?.outcome !== 'rolled_back')
      return unconfirmed(new Error(data?.message || data?.error || `HTTP ${res.status}`))
    // A refusal/rollback of THIS attempt cannot resolve a prior lost response.
    // Keep the same intent until confirmed success; retrying a known rollback
    // under the same key is also safe. Edited payloads have a different hash.
    // Stale/inaccessible workspace: clear the active id so the next load re-picks a
    // valid one (WorkspaceProvider refetches /api/workspaces). Only on explicit 403.
    if (res.status === 403 && data?.error === 'workspace_not_accessible' && getActiveBusinessId() === businessId) {
      try { setActiveBusinessId(null) } catch { /* */ }
    }
    // Keep the whole error payload: routes return actionable detail alongside the
    // code (e.g. upload-init 409 duplicate carries existing_document_id). Callers
    // that only read err.message/err.status are unaffected.
    const err = new Error(data?.message || data?.error || `Request failed with status ${res.status}`)
    err.status = res.status; err.code = data?.error || null; err.data = data
    throw err
  }
  intent?.clear()
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
