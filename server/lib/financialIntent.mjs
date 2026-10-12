// Pure shared identity contract. Credentials, generated FX output and UI field
// order are not operation identity. It never rewrites the body sent to a writer.
export const RECOVERY_OPERATIONS = Object.freeze(['wallet_create', 'transaction_batch', 'wallet_adjust', 'debt_payment', 'wallet_transfer'])
const numeric = new Set(['amount','opening_balance','target_balance','expected_balance','target_amount','rate','booked_rate','amount_idr','sort_order'])
export function decimalIdentity(value) {
  const s = String(value).trim()
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(s)) return s
  const sign = s.startsWith('-') ? '-' : ''
  const [integer, fraction = ''] = s.replace(/^[+-]/, '').split('.')
  const i = integer.replace(/^0+(?=\d)/, ''), f = fraction.replace(/0+$/, '')
  return (i === '0' && !f ? '' : sign) + i + (f ? '.' + f : '')
}
export function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => {
    const v = value[k]
    return [k, v == null ? null : numeric.has(k) && (typeof v === 'number' || typeof v === 'string') ? decimalIdentity(v) : canonicalJson(v)]
  }))
  return value
}
export function requestDescription(path) {
  if (path === '/wallets') return { operation: 'wallet_create', field: 'request_key' }
  if (path === '/transactions/batch') return { operation: 'transaction_batch', field: 'request_key' }
  let m = path.match(/^\/wallets\/([^/]+)\/adjust-balance$/)
  if (m) return { operation: 'wallet_adjust', field: 'request_key', target: decodeURIComponent(m[1]) }
  m = path.match(/^\/debts\/([^/]+)\/pay$/)
  if (m) return { operation: 'debt_payment', field: 'idempotency_key', target: decodeURIComponent(m[1]) }
  if (path === '/wallets/transfer') return { operation: 'wallet_transfer', field: 'transfer_id' }
  return null
}
export function canonicalFinancialIntent(operation, body, target = null) {
  if (!RECOVERY_OPERATIONS.includes(operation)) throw Error('unsupported_financial_operation')
  if (body?.scope && body.scope !== 'business') throw Error('wallet_scope_mismatch: Recovery is limited to Business operations')
  const checkSecrets = value => {
    if (Array.isArray(value)) return value.forEach(checkSecrets)
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:jwt|token|authorization|password|secret|access_token|refresh_token|api_key|service_role)$/i.test(key))
          throw Error('invalid_financial_intent: Credentials cannot be part of an operation intent')
        checkSecrets(child)
      }
    } else if (typeof value === 'string' && /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/.test(value))
      throw Error('invalid_financial_intent: Credentials cannot be part of an operation intent')
  }
  checkSecrets(body)
  const p = { ...body }
  delete p.request_key; delete p.idempotency_key; delete p.transfer_id
  if (operation === 'transaction_batch') {
    // Preserve sequence and every transaction field. Key/order differences are
    // harmless; changing any native money, target, date or provenance is not.
    return canonicalJson({ version: 1, operation, scope: 'business', payload: Array.isArray(body) ? body : body.transactions })
  }
  if (operation === 'wallet_create') {
    Object.assign(p, { name: body.name, currency: String(body.currency || 'IDR').toUpperCase(), type: body.type || null,
      entity_name: body.entity_name || null, color: body.color || null, sort_order: body.sort_order ?? 0,
      opening_balance: body.opening_balance ?? 0, scope: body.scope || 'business' })
  }
  if (operation === 'wallet_adjust') p.wallet_id = String(target)
  if (operation === 'debt_payment') {
    p.debt_id = String(target)
    p.wallet_id = body.wallet_id || null
    // Explicit wallet ID determines the account. Its changing display name is
    // not a different payment. Legacy name-only requests remain distinct.
    p.account = body.wallet_id ? null : body.account || null
    p.date = body.date || null
  }
  if (operation === 'wallet_transfer') {
    p.date = body.date || null; p.description = body.description || null
    p.target_amount = body.target_amount ?? null; p.rate = body.rate ?? null
    p.rate_source = body.rate_source || null
  }
  return canonicalJson({ version: 1, operation, scope: 'business', payload: p })
}
export function stableJson(value) { return JSON.stringify(canonicalJson(value)) }
