import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { apiFetch, fmt, fmtFull } from '../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateShort(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Badge colours per transaction type
const TYPE_BADGE = {
  income:   { label: 'Income',   bg: 'var(--status-paid-bg)',    color: 'var(--status-paid)'    },
  expense:  { label: 'Expense',  bg: 'var(--status-overdue-bg)', color: 'var(--status-overdue)' },
  transfer: { label: 'Transfer', bg: 'var(--bg-3)',              color: 'var(--text-3)'          },
  payroll:  { label: 'Payroll',  bg: 'var(--amber-light)',       color: 'var(--amber-dark)'      },
}
function getTypeBadge(type) {
  return TYPE_BADGE[type] || { label: type || 'Other', bg: 'var(--bg-3)', color: 'var(--text-3)' }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

// ── Summary Card ──────────────────────────────────────────────────────────────
function SummaryCard({ label, value, sub, color }) {
  return (
    <div className="summary-card">
      <div className="summary-card-label">{label}</div>
      <div className="summary-card-value" style={{ color: color || 'var(--text)' }}>{value}</div>
      {sub && <div className="summary-card-sub">{sub}</div>}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Transactions() {
  const { token } = useAuth()
  const navigate = useNavigate()

  // Server-side filter state (triggers API call)
  const [period, setPeriod]     = useState('month')    // today | week | month
  const [scope, setScope]       = useState('all')       // all | business | personal

  // Client-side filter state (applied to loaded data)
  const [search, setSearch]     = useState('')
  const [typeFilter, setType]   = useState('all')       // all | income | expense | transfer | payroll

  // Data state
  const [txs, setTxs]           = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  // ── Load from API ─────────────────────────────────────────────────────────
  const load = () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (period !== 'all') params.set('period', period)
    if (scope  !== 'all') params.set('scope',  scope)
    const qs = params.toString()
    apiFetch(`/transactions${qs ? '?' + qs : ''}`, token)
      .then(data => setTxs(Array.isArray(data) ? data : []))
      .catch(e  => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [period, scope]) // eslint-disable-line

  // ── Client-side filters ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = txs
    if (typeFilter !== 'all') list = list.filter(t => t.type === typeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(t =>
        (t.description || '').toLowerCase().includes(q) ||
        (t.category    || '').toLowerCase().includes(q) ||
        (t.source      || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [txs, typeFilter, search])

  // ── Summary metrics (from filtered list) ──────────────────────────────────
  const totalIncome   = filtered.filter(t => t.type === 'income' ).reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const totalExpenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const netFlow       = totalIncome - totalExpenses

  // ── Amount display helper ──────────────────────────────────────────────────
  function displayAmount(t) {
    const sign   = t.type === 'income' ? '+' : t.type === 'expense' ? '−' : ''
    const amount = t.amount_original ?? t.amount_idr ?? 0
    const cur    = t.currency_original && t.currency_original !== 'IDR' ? t.currency_original : 'IDR'
    return `${sign}${fmt(amount)} ${cur}`
  }

  function amountClass(t) {
    if (t.type === 'income')  return 'amount-positive'
    if (t.type === 'expense') return 'amount-negative'
    return 'amount-neutral'
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page tx-page">

      {/* ── Page header ─── */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Transactions</div>
          <div className="page-header-sub">All money movements</div>
        </div>
        <button className="page-header-action" onClick={() => navigate('/add')}>
          <PlusIcon /> Add
        </button>
      </div>

      {/* ── Summary cards ─── */}
      <div className="summary-grid">
        <SummaryCard
          label="Total Income"
          value={fmt(totalIncome)}
          sub={`${filtered.filter(t => t.type === 'income').length} transactions`}
          color="var(--green)"
        />
        <SummaryCard
          label="Total Expenses"
          value={fmt(totalExpenses)}
          sub={`${filtered.filter(t => t.type === 'expense').length} transactions`}
          color="var(--red)"
        />
        <SummaryCard
          label="Net Flow"
          value={(netFlow >= 0 ? '+' : '') + fmt(netFlow)}
          sub="income − expenses"
          color={netFlow >= 0 ? 'var(--green)' : 'var(--red)'}
        />
        <SummaryCard
          label="Showing"
          value={filtered.length}
          sub="transactions"
          color="var(--text)"
        />
      </div>

      {/* ── Filter bar ─── */}
      <div className="filter-bar">
        {/* Search */}
        <div className="filter-search-wrap">
          <span className="filter-search-icon"><SearchIcon /></span>
          <input
            className="filter-search"
            placeholder="Search description, category, source…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="filter-search-clear" onClick={() => setSearch('')}>×</button>
          )}
        </div>

        {/* Type */}
        <select className="filter-select" value={typeFilter} onChange={e => setType(e.target.value)}>
          <option value="all">All types</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
          <option value="payroll">Payroll</option>
        </select>

        {/* Scope */}
        <select className="filter-select" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="all">All scopes</option>
          <option value="business">Business</option>
          <option value="personal">Personal</option>
        </select>

        {/* Period */}
        <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="month">This month</option>
          <option value="week">Last 7 days</option>
          <option value="today">Today</option>
        </select>
      </div>

      {/* ── Mobile filter chips (type) ─── */}
      <div className="filter-chips">
        {['all', 'income', 'expense'].map(t => (
          <button
            key={t}
            className={`filter-chip${typeFilter === t ? ' active' : ''}`}
            onClick={() => setType(t)}
          >
            {t === 'all' ? 'All' : t === 'income' ? '↓ Income' : '↑ Expense'}
          </button>
        ))}
        <select className="filter-chip-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="month">This month</option>
          <option value="week">Last 7d</option>
          <option value="today">Today</option>
        </select>
      </div>

      {/* ── Loading ─── */}
      {loading && (
        <div className="tx-state-center">
          <div className="tx-loading-spinner" />
          <div className="tx-state-text">Loading transactions…</div>
        </div>
      )}

      {/* ── Error ─── */}
      {!loading && error && (
        <div className="tx-state-center">
          <div className="tx-state-icon">⚠️</div>
          <div className="tx-state-text" style={{ color: 'var(--red)' }}>Could not load transactions.</div>
          <div className="tx-state-sub">{error}</div>
          <button className="tx-retry-btn" onClick={load}>Retry</button>
        </div>
      )}

      {/* ── Empty ─── */}
      {!loading && !error && filtered.length === 0 && (
        <div className="tx-state-center">
          <div className="tx-state-icon">💸</div>
          <div className="tx-state-text">No transactions found.</div>
          <div className="tx-state-sub">
            {search || typeFilter !== 'all'
              ? 'Try adjusting your filters.'
              : 'Add your first transaction to get started.'}
          </div>
          {!search && typeFilter === 'all' && (
            <button className="tx-retry-btn" onClick={() => navigate('/add')}>
              + Add Transaction
            </button>
          )}
          {(search || typeFilter !== 'all') && (
            <button className="tx-retry-btn" onClick={() => { setSearch(''); setType('all') }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* ── Desktop table ─── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="tx-table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th>Source</th>
                <th>Scope</th>
                <th className="tx-col-amount">Amount</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const badge = getTypeBadge(t.type)
                return (
                  <tr key={t.id}>
                    <td className="tx-col-date">{fmtDate(t.created_at)}</td>
                    <td className="tx-col-desc">
                      <div className="tx-desc-text">{t.description || '—'}</div>
                      {t.project && <div className="tx-desc-sub">{t.project}</div>}
                    </td>
                    <td className="tx-col-cat">
                      <span className="tx-cat-text">{t.category || 'Uncategorized'}</span>
                    </td>
                    <td className="tx-col-source">
                      <span className="tx-source-text">{t.source || 'No source'}</span>
                    </td>
                    <td>
                      <span className="tx-scope-badge" data-scope={t.scope || 'personal'}>
                        {t.scope === 'business' ? 'Business' : 'Personal'}
                      </span>
                    </td>
                    <td className={`tx-col-amount ${amountClass(t)}`}>
                      {displayAmount(t)}
                    </td>
                    <td>
                      <span
                        className="type-badge"
                        style={{ background: badge.bg, color: badge.color }}
                      >
                        {badge.label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Mobile card list ─── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="tx-card-list">
          {filtered.map(t => {
            const badge = getTypeBadge(t.type)
            return (
              <div key={t.id} className="tx-card">
                <div className="tx-card-left">
                  <div
                    className="tx-card-dot"
                    style={{ background: t.type === 'income' ? 'var(--green-light)' : t.type === 'expense' ? 'var(--red-light)' : 'var(--bg-3)' }}
                  >
                    <span style={{ fontSize: 14, color: t.type === 'income' ? 'var(--green)' : t.type === 'expense' ? 'var(--red)' : 'var(--text-3)' }}>
                      {t.type === 'income' ? '↓' : t.type === 'expense' ? '↑' : '↔'}
                    </span>
                  </div>
                </div>
                <div className="tx-card-body">
                  <div className="tx-card-desc">{t.description || '—'}</div>
                  <div className="tx-card-meta">
                    <span>{fmtDateShort(t.created_at)}</span>
                    {t.category && <><span className="tx-meta-dot">·</span><span>{t.category}</span></>}
                    {t.source   && <><span className="tx-meta-dot">·</span><span>{t.source}</span></>}
                  </div>
                </div>
                <div className="tx-card-right">
                  <div className={amountClass(t)} style={{ fontSize: 14, fontWeight: 600 }}>
                    {displayAmount(t)}
                  </div>
                  <span
                    className="type-badge"
                    style={{ background: badge.bg, color: badge.color, marginTop: 4 }}
                  >
                    {badge.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

    </div>
  )
}
