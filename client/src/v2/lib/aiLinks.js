// Clickable phrases in AI text (DESIGN_SPEC rule 6) — ONE general mechanism.
//
// An AI answer may carry a link to a page plus filter, in either form:
//   [April expansion](/business/performance?month=2026-04&compare=2026-03&focus=april-expansion)
//   [April expansion](cfo://performance?month=2026-04&compare=2026-03&focus=april-expansion)
// parseAiText() splits the text into plain segments and link segments. A link is kept
// ONLY when it points at an allow-listed /business page and every query parameter is
// allow-listed and well-formed; anything else (external URLs, javascript:, unknown
// pages, odd params) degrades to plain text. Nothing is fetched or executed — the
// target page reads the filter from its own URL. Pure; tested in v2AiLinks.test.mjs.

// cfo://<key> → route. Every target is a read-only screen.
export const LINK_PAGES = {
  pulse: '/business/pulse',
  radar: '/business/radar',
  performance: '/business/performance',
  'performance/cash': '/business/performance/cash',
  'performance/forecast': '/business/performance/forecast',
  transactions: '/business/transactions',
  bills: '/business/payables',
  payables: '/business/payables',
  receivables: '/business/receivables',
  counterparties: '/business/counterparties',
  accounts: '/business/accounts',
  payroll: '/business/payroll',
  approvals: '/business/approvals',
  documents: '/business/documents',
  accountant: '/business/accountant',
  assets: '/business/assets',
}
const ROUTES = new Set(Object.values(LINK_PAGES))

const PARAMS = {
  month: /^\d{4}-(0[1-9]|1[0-2])$/,
  compare: /^\d{4}-(0[1-9]|1[0-2])$/,
  focus: /^[a-z0-9][a-z0-9-]{0,39}$/,
  tab: /^[a-z]{1,20}$/,
  filter: /^[a-z]{1,20}$/,
  q: /^[\p{L}\p{N} .,'-]{1,60}$/u,
}

/** Validate a link target. Returns the safe in-app path, or null. */
export function safeTarget(raw) {
  if (typeof raw !== 'string' || raw.length > 300) return null
  let path, query = ''
  const s = raw.trim()
  if (s.startsWith('cfo://')) {
    const rest = s.slice(6)
    const i = rest.indexOf('?')
    const key = (i < 0 ? rest : rest.slice(0, i)).replace(/\/+$/, '')
    path = LINK_PAGES[key]
    query = i < 0 ? '' : rest.slice(i + 1)
    if (!path) return null
  } else if (s.startsWith('/business/')) {
    const i = s.indexOf('?')
    path = (i < 0 ? s : s.slice(0, i)).replace(/\/+$/, '')
    query = i < 0 ? '' : s.slice(i + 1)
    if (!ROUTES.has(path)) return null
  } else return null
  if (query.includes('#')) return null
  const out = new URLSearchParams()
  if (query) {
    for (const part of query.split('&')) {
      if (!part) continue
      const [k, v = ''] = part.split('=')
      let val
      try { val = decodeURIComponent(v.replace(/\+/g, ' ')) } catch { return null }
      if (!PARAMS[k] || !PARAMS[k].test(val) || out.has(k)) return null
      out.set(k, val)
    }
  }
  const qs = out.toString()
  return qs ? `${path}?${qs}` : path
}

const LINK_RE = /\[([^\]\n]{1,80})\]\(([^)\s]{1,300})\)/g

/** Split AI text into [{ type: 'text', text } | { type: 'link', text, to }]. */
export function parseAiText(text) {
  const s = String(text ?? '')
  const out = []
  let last = 0
  for (const m of s.matchAll(LINK_RE)) {
    const to = safeTarget(m[2])
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) })
    out.push(to ? { type: 'link', text: m[1], to } : { type: 'text', text: m[1] })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) })
  // Merge neighbouring text segments.
  return out.reduce((acc, seg) => {
    const prev = acc[acc.length - 1]
    if (prev && prev.type === 'text' && seg.type === 'text') prev.text += seg.text
    else acc.push({ ...seg })
    return acc
  }, [])
}

/** Build a drill-down link, e.g. for a highlighted phrase the UI writes itself. */
export function drillLink(page, { month, compare, focus } = {}) {
  const q = new URLSearchParams()
  if (month) q.set('month', month)
  if (compare) q.set('compare', compare)
  if (focus) q.set('focus', focus)
  const qs = q.toString()
  return safeTarget(`cfo://${page}${qs ? '?' + qs : ''}`)
}

/** Read the drill-down filter a target page received. Invalid values are dropped. */
export function readDrill(search) {
  const sp = new URLSearchParams(search || '')
  const pick = (k) => { const v = sp.get(k); return v && PARAMS[k].test(v) ? v : null }
  return { month: pick('month'), compare: pick('compare'), focus: pick('focus') }
}
