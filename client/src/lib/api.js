import { financialActor, managedFinancialRequest } from './financialRecovery.js'
import { requestDescription } from '../../../server/lib/financialIntent.mjs'
const BASE = '/api'
let workspaceEpoch = 0

// Active business workspace — set by useAccess after /access/status,
// or by a future business switcher. All financial API calls carry it.
export function getActiveBusinessId() {
  try { return localStorage.getItem('activeBusinessId') || null } catch { return null }
}
export function setActiveBusinessId(id) {
  if (getActiveBusinessId() !== (id || null)) workspaceEpoch++
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
  const description = requestDescription(path)
  if (String(options.method).toUpperCase() !== 'POST' || !description || !options.body) return performApiFetch(path,token,options)
  const identity = token && typeof token === 'object' ? token : null
  if (identity && (!identity.businessId || !identity.isCurrent())) {
    const e = new Error('workspace_changed');e.name='AbortError';e.code='workspace_changed';throw e
  }
  const credential = identity ? identity.token : token
  const actor = financialActor(credential)
  const business = identity ? identity.businessId : options.headers?.['x-business-id'] || getActiveBusinessId()
  if (!actor || !business) {
    const e = new Error('Sign in and select a Business workspace before submitting this operation.')
    e.code = 'financial_identity_required'; e.status = 401; throw e
  }
  const epoch = workspaceEpoch
  let sessionWasStored = false
  try { sessionWasStored = !!localStorage.getItem('hf_token') } catch {}
  const assertCurrent = () => {
    let currentActor = actor
    try {
      const storedToken = localStorage.getItem('hf_token')
      if (sessionWasStored || storedToken) currentActor = financialActor(storedToken)
    } catch {}
    if (currentActor !== actor || identity && !identity.isCurrent()
        || !identity && (workspaceEpoch !== epoch || getActiveBusinessId() !== business)) {
      const e = new Error('workspace_changed');e.name='AbortError';e.code='workspace_changed';throw e
    }
  }
  return managedFinancialRequest(path,{actor,business,token:credential,assertCurrent},options,
    (managedOptions,journal) => performApiFetch(path,token,managedOptions,journal,assertCurrent))
}

async function performApiFetch(path, token, options = {}, journal = null, assertFinancialCurrent = null) {
  const recoveryRead = path.startsWith('/financial-operations/')
  const readActor = recoveryRead ? financialActor(token && typeof token === 'object' ? token.token : token) : null
  let readSessionStored = false
  try { readSessionStored = recoveryRead && !!localStorage.getItem('hf_token') } catch {}
  const mutation = !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())
    && /^\/(transactions|wallets|debts|payroll|bank-imports?|personal\/(wallets|transactions)|funding)(\/|$)/.test(path)
  const unconfirmed = (cause) => {
    if (!mutation) throw cause
    journal?.unknown()
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
    assertFinancialCurrent?.()
    if (recoveryRead && readSessionStored && financialActor(localStorage.getItem('hf_token')) !== readActor) {
      const err = new Error('workspace_changed');err.name='AbortError';err.code='workspace_changed';throw err
    }
    if (identity && (!identity.businessId || !identity.isCurrent())) {
      const err = new Error('workspace_changed')
      err.name = 'AbortError'; err.code = 'workspace_changed'
      throw err
    }
  }
  assertCurrent()
  const businessId = scoped ? identity.businessId : (options.headers?.['x-business-id'] || getActiveBusinessId())
  assertCurrent()
  const multipart = typeof FormData !== 'undefined' && options.body instanceof FormData
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      ...(multipart ? {} : { 'Content-Type': 'application/json' }),
      Authorization: `Bearer ${scoped ? identity.token : token}`,
      ...(businessId ? { 'x-business-id': businessId } : {}),
      ...options.headers,
      ...(journal || recoveryRead ? { Authorization: 'Bearer ' + (scoped ? identity.token : token) } : {}),
      ...(scoped ? { 'x-business-id': businessId } : {})
    },
    body: options.body ? multipart ? options.body : JSON.stringify(options.body) : undefined
  }).catch((e) => { assertCurrent(); return unconfirmed(e) })
  // Only this authenticated, non-financial GET may return an image body. Money
  // paths still require their usual JSON acknowledgement and durable receipt.
  if (path === '/me/avatar' && String(options.method || 'GET').toUpperCase() === 'GET' && options.responseType === 'avatar' && res.ok) {
    assertCurrent()
    if (!/^image\/(png|jpeg|webp|gif)(;|$)/i.test(res.headers.get('content-type') || '')) throw new Error('avatar_response_invalid')
    const image = await res.blob()
    assertCurrent()
    return image
  }
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
    // The shared recovery module retains the identity and reads its receipt.
    // Edited payloads cannot silently replace an unresolved financial intent.
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
