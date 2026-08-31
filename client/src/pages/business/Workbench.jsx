// Shared workbench layer for the Documents and Invoices queues.
//
// One toolbar, one grouping/sorting engine, one "More" menu — so both pages behave
// identically as they scale, without duplicating the pattern.
//
// DATA HONESTY: every filter, group and sort key is a function the caller supplies over
// fields the API genuinely returns. Option lists for open-ended dimensions (source,
// counterparty) are DERIVED FROM THE ROWS PRESENT, so the UI can never offer a filter for
// a value that does not exist in this workspace.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Btn, Icon } from '../../shell/ui'
import './Workbench.css'

/* ── month helpers (real document_date only) ──────────────────────────────── */

const monthKey = (d) => (d ? String(d).slice(0, 7) : null)
const monthLabel = (k) => (k
  ? new Date(`${k}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
  : 'No date')
const thisMonth = () => new Date().toISOString().slice(0, 7)
const lastMonth = () => {
  const d = new Date(); d.setMonth(d.getMonth() - 1)
  return d.toISOString().slice(0, 7)
}

export const DATE_OPTIONS = [
  { value: '', label: 'All dates' },
  { value: 'this', label: 'This month' },
  { value: 'last', label: 'Last month' },
  { value: 'none', label: 'No date' },
]
export const AMOUNT_OPTIONS = [
  { value: '', label: 'Any amount' },
  { value: 'has', label: 'Has amount' },
  { value: 'missing', label: 'Missing amount' },
]

/**
 * Workbench state: search, filters, grouping, sorting, density.
 *
 * `cfg` supplies accessors so the same engine drives both pages:
 *   text(row)    → the searchable blob
 *   date(row)    → ISO date string or null
 *   amount(row)  → number or null
 *   priority(row)→ lower sorts first for "Needs action first"
 *   filters      → [{ key, label, options | derive, match(row, value) }]
 *   groups       → [{ value, label, of(row) → { key, label } }]
 */
export function useWorkbench(rows, cfg) {
  const [query, setQuery] = useState('')
  const [values, setValues] = useState({})
  const [group, setGroup] = useState('')
  const [sort, setSort] = useState('action')
  const [density, setDensity] = useState('comfortable')

  const setFilter = useCallback((k, v) => setValues((s) => ({ ...s, [k]: v })), [])
  const clear = useCallback(() => { setQuery(''); setValues({}) }, [])

  // Options for open-ended dimensions come from the data itself.
  const filters = useMemo(() => cfg.filters.map((f) => {
    if (f.options) return f
    const seen = new Map()
    rows.forEach((r) => {
      const o = f.derive(r)
      if (o && o.value && !seen.has(o.value)) seen.set(o.value, o.label || o.value)
    })
    return { ...f, options: [{ value: '', label: f.allLabel || `All ${f.label.toLowerCase()}` },
      ...[...seen].map(([value, label]) => ({ value, label }))] }
  }), [cfg.filters, rows])

  const activeCount = Object.values(values).filter(Boolean).length + (query.trim() ? 1 : 0)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = rows.filter((r) => {
      if (q && !cfg.text(r).toLowerCase().includes(q)) return false
      for (const f of cfg.filters) {
        const v = values[f.key]
        if (v && !f.match(r, v)) return false
      }
      return true
    })
    const amt = (r) => { const a = cfg.amount(r); return a === null ? -Infinity : a }
    const time = (r) => { const d = cfg.date(r); return d ? new Date(d).getTime() : 0 }
    const by = {
      action: (a, b) => cfg.priority(a) - cfg.priority(b) || time(b) - time(a),
      newest: (a, b) => time(b) - time(a),
      oldest: (a, b) => time(a) - time(b),
      amountDesc: (a, b) => amt(b) - amt(a),
      amountAsc: (a, b) => amt(a) - amt(b),
    }
    return [...out].sort(by[sort] || by.action)
  }, [rows, query, values, sort, cfg])

  const grouped = useMemo(() => {
    if (!group) return [{ key: '_all', label: null, rows: visible }]
    const def = cfg.groups.find((g) => g.value === group)
    if (!def) return [{ key: '_all', label: null, rows: visible }]
    const map = new Map()
    visible.forEach((r) => {
      const { key, label } = def.of(r)
      if (!map.has(key)) map.set(key, { key, label, rows: [] })
      map.get(key).rows.push(r)
    })
    return [...map.values()]
  }, [visible, group, cfg.groups])

  return { query, setQuery, values, setFilter, filters, group, setGroup, sort, setSort,
    density, setDensity, visible, grouped, activeCount, clear }
}

/* helpers callers can reuse for their group definitions */
export const monthGroup = (dateOf) => (r) => {
  const k = monthKey(dateOf(r))
  return { key: k || 'none', label: monthLabel(k) }
}

/* ── toolbar ──────────────────────────────────────────────────────────────── */

export const SORTS = [
  { value: 'action', label: 'Needs action first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'amountDesc', label: 'Amount high to low' },
  { value: 'amountAsc', label: 'Amount low to high' },
]

export function WorkbenchToolbar({ wb, placeholder, groups, selection }) {
  return (
    <div className="wb-toolbar">
      <div className="wb-search">
        <Icon.list width="15" height="15" aria-hidden="true" />
        <input value={wb.query} onChange={(e) => wb.setQuery(e.target.value)}
          placeholder={placeholder} aria-label="Search" />
        {wb.query && (
          <button type="button" className="wb-search-x" onClick={() => wb.setQuery('')} aria-label="Clear search">
            <Icon.plus width="13" height="13" style={{ transform: 'rotate(45deg)' }} />
          </button>
        )}
      </div>

      <div className="wb-filters">
        {wb.filters.map((f) => (
          <label key={f.key} className="wb-select">
            <span className="wb-select-label">{f.label}</span>
            <select value={wb.values[f.key] || ''} onChange={(e) => wb.setFilter(f.key, e.target.value)}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}

        <label className="wb-select">
          <span className="wb-select-label">Group by</span>
          <select value={wb.group} onChange={(e) => wb.setGroup(e.target.value)}>
            <option value="">None</option>
            {groups.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>

        <label className="wb-select">
          <span className="wb-select-label">Sort</span>
          <select value={wb.sort} onChange={(e) => wb.setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>

        <div className="wb-density" role="group" aria-label="Row density">
          {['comfortable', 'compact'].map((d) => (
            <button key={d} type="button" aria-pressed={wb.density === d}
              className={`wb-density-btn${wb.density === d ? ' is-active' : ''}`}
              onClick={() => wb.setDensity(d)}>{d === 'compact' ? 'Compact' : 'Comfortable'}</button>
          ))}
        </div>

        {wb.activeCount > 0 && (
          <button type="button" className="wb-clear" onClick={wb.clear}>
            Clear filters<span className="wb-clear-n">{wb.activeCount}</span>
          </button>
        )}
      </div>

      {selection}
    </div>
  )
}

/* ── selection bar (bulk archive uses the real archive route) ─────────────── */

export function SelectionBar({ count, busy, onArchive, onClear }) {
  if (!count) return null
  return (
    <div className="wb-selbar">
      <span className="wb-selbar-n">{count} selected</span>
      <Btn sm variant="ghost" onClick={onArchive} disabled={busy}>Archive selected</Btn>
      <Btn sm variant="ghost" onClick={onClear} disabled={busy}>Clear selection</Btn>
    </div>
  )
}

/* ── group header ─────────────────────────────────────────────────────────── */

export function GroupHeader({ label, count }) {
  if (!label) return null
  return (
    <div className="wb-group">
      <span className="wb-group-label">{label}</span>
      <span className="wb-group-n">{count}</span>
    </div>
  )
}

/* ── overflow menu — keeps the primary action visible on narrow rows ─────── */

export function MoreMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])
  const real = items.filter(Boolean)
  if (!real.length) return null
  return (
    <div className="wb-more" ref={ref}>
      <button type="button" className="wb-more-btn" aria-label="More actions"
        aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon.dots width="16" height="16" />
      </button>
      {open && (
        <div className="wb-more-menu" role="menu">
          {real.map((it) => (
            <button key={it.label} type="button" role="menuitem" className="wb-more-item"
              onClick={() => { setOpen(false); it.onClick() }}>{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── empty state for an over-filtered queue ───────────────────────────────── */

export function NoMatches({ onClear }) {
  return (
    <div className="wb-nomatch">
      <span className="wb-nomatch-ic"><Icon.list width="18" height="18" aria-hidden="true" /></span>
      <div>
        <p className="wb-nomatch-title">No documents match these filters.</p>
        <p className="wb-nomatch-body">Widen the search or clear the filters to see everything again.</p>
      </div>
      <Btn sm variant="ghost" onClick={onClear}>Clear filters</Btn>
    </div>
  )
}

/* ── created-record id resolution ─────────────────────────────────────────── */

/**
 * Pull the new record's id out of whatever POST /api/debts returned.
 *
 * Today it answers the raw row (res.json(computeDebtStatus(data))), so `res.id` is right —
 * but the create→link chain must not silently break if that is ever wrapped. Returns null
 * when no id can be found, so the caller can report honestly instead of linking `undefined`.
 */
export function resolveRecordId(res) {
  if (res == null) return null
  if (typeof res === 'string' || typeof res === 'number') return res
  return res.id ?? res.debt?.id ?? res.data?.id ?? res.record?.id ?? null
}
