import { canonicalFinancialIntent, requestDescription, stableJson } from '../../../server/lib/financialIntent.mjs'
const memory = new Map(), queues = new Map()
const PREFIX = 'financialIntent:v1:', REVIEW = 'financialReviewed:v1:'
export function financialActor(token) {
  try {
    const p = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    const id = p.userId
    if (typeof id === 'number' && !Number.isSafeInteger(id)) return null
    return /^[+-]?\d+$/.test(String(id)) ? String(id) : null
  } catch { return null }
}
function emit(type = 'financial-intent-changed') {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(type))
}
function read(key) {
  try { const v = localStorage.getItem(key); if (v) return JSON.parse(v) } catch { /* unavailable storage */ }
  return memory.get(key) || null
}
function write(key, value) {
  memory.set(key, value)
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* private storage: server list remains available */ }
  emit()
}
function remove(key) { memory.delete(key); try { localStorage.removeItem(key) } catch { /* */ } emit() }
async function hash(value) {
  const bytes = new TextEncoder().encode(stableJson(value)), h = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join('')
}
export async function reviewNamespace(actor, business) { return REVIEW + await hash([actor, business, 'business']) }
export async function acknowledgeRecentOperations(actor, business) {
  write(await reviewNamespace(actor, business), { reviewed_at: Date.now() })
  emit('financial-recovery-reviewed')
}
export function pendingOperations(actor, business) {
  const all = new Map(memory)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) { const v = read(k); if (v) all.set(k, v) }
    }
  } catch { /* */ }
  return [...all.entries()].filter(([k, x]) => k.startsWith(PREFIX) && x.actor === actor && x.business === business && x.scope === 'business')
    .map(([storageKey, x]) => ({ ...x, storageKey }))
}
export function markRecovered(actor, business, operation, key) {
  for (const x of pendingOperations(actor, business)) {
    if (x.operation === operation && x.key === key) write(x.storageKey, { ...x, state: 'confirmed', updated_at: Date.now() })
  }
}
export function allowSeparateOperation(actor, business, operation, key) {
  // An explicit user action, not clearing keys on a transport/refusal error.
  for (const x of pendingOperations(actor, business)) if (x.operation === operation && x.key === key && x.state === 'confirmed') remove(x.storageKey)
}
function failure(code, message, status = 409) {
  const e = new Error(message); e.code = code; e.status = status
  e.data = { error: code, automatic_retry: false }
  return e
}
function confirmsResult(operation, result) {
  if (operation === 'bill_create') return !!result?.debt?.id && !!result.audit_id
  if (operation === 'wallet_create') return !!result?.wallet?.id
  if (operation === 'transaction_batch') return Number.isInteger(result?.saved) && result.saved >= 0
  if (operation === 'wallet_adjust') return result?.ok === true && result.new_balance != null && Number.isFinite(Number(result.new_balance))
  if (operation === 'debt_payment') return result?.ok === true && !!result.debt?.id
  if (operation === 'wallet_transfer') return result?.ok === true && (
    result.debit_transaction_id && result.credit_transaction_id && result.debit_transaction_id !== result.credit_transaction_id
    || Array.isArray(result.transactions) && result.transactions.length === 2)
  return false
}
async function locked(name, fn) {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request(name, fn)
  // Closed staging is opened over trustworthy localhost/HTTPS. Without browser
  // Web Locks, do not pretend an in-tab queue protects independent tabs.
  if (typeof window !== 'undefined') throw failure('financial_lock_unavailable', 'Use a secure browser connection to submit financial operations.')
  const previous = queues.get(name) || Promise.resolve()
  const promise = previous.catch(() => {}).then(fn)
  queues.set(name, promise)
  try { return await promise } finally { if (queues.get(name) === promise) queues.delete(name) }
}
async function recoveryRead(path, context) {
  context.assertCurrent()
  let r
  try {
    r = await fetch('/api/financial-operations/' + path, { headers: {
      Authorization: 'Bearer ' + context.token, 'x-business-id': context.business
    } })
  } catch (e) { context.assertCurrent(); throw e }
  let data
  try { data = await r.json() } catch { context.assertCurrent(); throw failure('financial_recovery_unavailable', 'The operation result could not be checked.', 503) }
  context.assertCurrent()
  if (!r.ok) {
    const e = failure(data.error || 'financial_recovery_unavailable', data.message || 'The operation result could not be checked.', r.status)
    e.data = data; throw e
  }
  return data
}
export async function managedFinancialRequest(path, context, options, execute) {
  const description = requestDescription(path), canonical = canonicalFinancialIntent(description.operation, options.body, description.target)
  const fingerprint = await hash([context.actor, context.business, description.operation, canonical]), storageKey = PREFIX + fingerprint
  return locked(storageKey, async () => {
    context.assertCurrent()
    let record = read(storageKey)
    const supplied = options.headers?.['Idempotency-Key'] || options.headers?.['idempotency-key'] || options.body[description.field]
    const existing = pendingOperations(context.actor, context.business)
    // An explicit key cannot silently be rebound to a different financial body.
    const bound = supplied && existing.find(x => x.key === supplied && x.operation === description.operation)
    if (bound && bound.storageKey !== storageKey) throw failure('idempotency_key_mismatch', 'This request key belongs to a different operation draft. Keep the draft and review the original result.')
    if (!record && existing.some(x => x.operation === description.operation && ['sent','unknown'].includes(x.state))) {
      emit('financial-recovery-open')
      throw failure('financial_pending_review_required', 'Check the unresolved operation before sending a different draft.')
    }
    if (record && ['sent','unknown','confirmed'].includes(record.state)) {
      let receipt
      try { receipt = await recoveryRead(description.operation + '/' + encodeURIComponent(record.key), context) }
      catch (e) {
        emit('financial-recovery-open')
        if (e.status === 404) throw failure('financial_outcome_unknown', 'No confirmed result was found yet. This does not prove rollback. Keep the original request and check again.')
        throw e
      }
      if (receipt.state !== 'confirmed' || !confirmsResult(description.operation, receipt.result)) throw failure('financial_recovery_unavailable', 'The operation result is still uncertain.', 503)
      write(storageKey, { ...record, state: 'confirmed', updated_at: Date.now() })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('financial-recovery-confirmed', {
        detail: { actor: context.actor, business: context.business, operation: description.operation, key: record.key }
      }))
      return { ...receipt.result, is_replay: true, result_is_historical: true, recovery: receipt }
    }
    if (!record) {
      const reviewed = read(await reviewNamespace(context.actor, context.business))
      if (!reviewed || Date.now() - reviewed.reviewed_at > 30 * 60000) {
        const recent = await recoveryRead('recent', context)
        if (!Array.isArray(recent.operations)) throw failure('financial_recovery_unavailable', 'Recent operation results could not be checked.', 503)
        if (recent.operations.length) {
          emit('financial-recovery-open')
          throw failure('financial_review_required', 'Review recent confirmed operations before creating a new one. A lost response may already have committed.')
        }
        await acknowledgeRecentOperations(context.actor, context.business)
      }
      record = { key: supplied || crypto.randomUUID(), operation: description.operation, scope: 'business',
        actor: context.actor, business: context.business, state: 'prepared', created_at: Date.now(), updated_at: Date.now() }
      write(storageKey, record)
    }
    context.assertCurrent()
    const previouslyUnknown = ['sent','unknown'].includes(record.state)
    record = { ...record, state: 'sent', updated_at: Date.now() }; write(storageKey, record)
    const journal = {
      unknown() { record = { ...record, state: 'unknown', updated_at: Date.now() }; write(storageKey, record) },
      reject(e) {
        // Only an explicit rollback of this first attempt establishes rejection.
        // A later refusal cannot resolve an earlier response-loss outcome.
        record = { ...record, state: !previouslyUnknown && e.data?.outcome === 'rolled_back' ? 'rejected' : 'unknown', updated_at: Date.now() }
        write(storageKey, record)
      }
    }
    try {
      const body = { ...options.body, [description.field]: record.key }
      const headers = { ...options.headers }
      if (description.field === 'idempotency_key') { delete headers['idempotency-key']; headers['Idempotency-Key'] = record.key }
      const result = await execute({ ...options, headers, body }, journal)
      context.assertCurrent()
      if (!confirmsResult(description.operation, result)) {
        journal.unknown()
        const e = failure('financial_outcome_unknown', 'The response did not confirm this financial operation.')
        e.data.outcome = 'unknown'; throw e
      }
      write(storageKey, { ...record, state: 'confirmed', updated_at: Date.now() })
      return result
    } catch (e) { journal.reject(e); throw e }
  })
}
