// Shared navigation only. These parameters never authorize an API request.
const SAFE_QUERY = new Set(['business_id', 'workspace_id', 'doc', 'tx', 'wallet_id', 'invoice_id', 'debt_id', 'tab', 'period', 'q', 'ask', 'month', 'kind'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEBT = /^[1-9][0-9]{0,18}$/

export function legacyDestination(location, fallback) {
  const [defaultPath, defaults = ''] = fallback.split('?')
  let path = defaultPath
  const params = new URLSearchParams(defaults)
  for (const [key, value] of new URLSearchParams(location.search || '')) {
    if (SAFE_QUERY.has(key) && value.length <= 1000) params.set(key, value)
  }
  const account = location.pathname.match(/^\/(?:business\/)?accounts\/([^/]+)$/)
  if (account && account[1] !== 'manage') path = '/business/accounts/' + encodeURIComponent(account[1])
  const invoice = location.pathname.match(/^\/(?:business\/)?(invoices|payables|receivables)\/([^/]+)$/)
  if (invoice && invoice[2] !== 'classic') path = '/business/' + invoice[1] + '/' + encodeURIComponent(invoice[2])
  if (/\/(tax-split|settlement)$/.test(location.pathname)) {
    const id = params.get('invoice_id') || params.get('debt_id')
    if (id && DEBT.test(id)) path = '/business/invoices/' + id
    else path = '/business/invoice-review/' + location.pathname.split('/').pop()
  }
  // A settings alias selects its intended tab, rather than accepting an unrelated tab.
  if (new URLSearchParams(defaults).has('tab')) params.set('tab', new URLSearchParams(defaults).get('tab'))
  const qs = params.toString()
  const hash = /^#[a-z0-9_-]{1,80}$/i.test(location.hash || '') ? location.hash : ''
  return path + (qs ? '?' + qs : '') + hash
}

export function requestedBusiness(search, workspaces) {
  const p = new URLSearchParams(search || '')
  const ids = [...p.getAll('business_id'), ...p.getAll('workspace_id')]
  if (!ids.length) return { status: 'unspecified' }
  if (!ids.every((id) => UUID.test(id)) || new Set(ids.map((id) => id.toLowerCase())).size !== 1) return { status: 'invalid' }
  const business = (workspaces.business || []).find((w) => String(w.id).toLowerCase() === ids[0].toLowerCase())
  return business ? { status: 'available', business } : { status: 'unavailable' }
}

// An entity belongs to its original company. A company switch clears that entity intent.
export function businessSwitchDestination(pathname) {
  if (/^\/business\/accounts\/[^/]+$/.test(pathname)) return '/business/accounts'
  if (/^\/business\/(invoices|payables|receivables)\/[^/]+$/.test(pathname)) return pathname.split('/').slice(0, 3).join('/')
  if (/^\/business\/counterparties\/[^/]+\/edit$/.test(pathname)) return '/business/counterparties'
  return pathname.startsWith('/business/') ? pathname : '/business/pulse'
}
