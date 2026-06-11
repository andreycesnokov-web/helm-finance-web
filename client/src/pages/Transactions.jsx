import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useTranslation } from '../hooks/useTranslation'
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

function fmtDateTime(dateStr) {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// Badge colours per transaction type
const TYPE_BADGE = {
  income:   { labelKey: 'transactions.income',   bg: 'var(--status-paid-bg)',    color: 'var(--status-paid)'    },
  expense:  { labelKey: 'transactions.expense',  bg: 'var(--status-overdue-bg)', color: 'var(--status-overdue)' },
  transfer: { labelKey: 'transactions.transfer', bg: '#E8EDFB',                  color: '#1e3a6e'                },
  payroll:  { labelKey: 'transactions.payroll',  bg: 'var(--amber-light)',       color: 'var(--amber-dark)'      },
}
function getTypeBadge(type) {
  return TYPE_BADGE[type] || { labelKey: null, label: type || 'Other', bg: 'var(--bg-3)', color: 'var(--text-3)' }
}

// Cash impact — labels are translated inside TransactionDetailsDrawer using tr()
const CASH_IMPACT_KEYS = {
  income:   { labelKey: 'transactions.increasesTotal', color: '#085041', bg: '#E1F5EE', icon: '↑' },
  expense:  { labelKey: 'transactions.decreasesTotal', color: '#991B1B', bg: '#FEE2E2', icon: '↓' },
  payroll:  { labelKey: 'transactions.decreasesTotal', color: '#92400E', bg: '#FEF3C7', icon: '↓' },
  transfer: { labelKey: 'transactions.noEffect',       color: '#1e3a6e', bg: '#E8EDFB', icon: '↔' },
}
function getCashImpact(type) {
  return CASH_IMPACT_KEYS[type] || { labelKey: 'transactions.unknownImpact', color: 'var(--text-3)', bg: 'var(--bg-3)', icon: '?' }
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
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

// ── Detail row helper ─────────────────────────────────────────────────────────
function DetailRow({ label, value, valueStyle }) {
  const { t: tr } = useTranslation()
  return (
    <div className="tx-detail-row">
      <span className="tx-detail-label">{label}</span>
      <span className="tx-detail-value" style={valueStyle}>{value || <span className="tx-detail-empty">{tr('transactions.notSet')}</span>}</span>
    </div>
  )
}

// ── Transaction Details Drawer ────────────────────────────────────────────────
function TransactionDetailsDrawer({ tx, onClose, refDirections = [], refActivityTypes = [], refWallets = [] }) {
  const { t: tr } = useTranslation()
  // Escape key
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!tx) return null

  const badge     = getTypeBadge(tx.type)
  const impact    = getCashImpact(tx.type)
  const isTransfer = tx.type === 'transfer'
  const isIncome   = tx.type === 'income'
  const isExpense  = tx.type === 'expense'
  const isPayroll  = tx.type === 'payroll'

  const amount    = Number(tx.amount_original ?? tx.amount_idr ?? 0)
  const currency  = tx.currency_original || 'IDR'

  // Amount display
  const amountSign  = isIncome ? '+' : (isExpense || isPayroll) ? '−' : ''
  const amountColor = isIncome ? '#085041' : (isExpense) ? '#991B1B' : isPayroll ? '#92400E' : '#1e3a6e'

  // Try to parse destination from description for transfers
  // Format saved by Add page: "Transfer → BCA" or just description
  let destination = null
  if (isTransfer && tx.description) {
    const m = tx.description.match(/→\s*(.+)$/)
    if (m) destination = m[1].trim()
  }

  return createPortal(
    <>
      {/* Backdrop */}
      <div className="tx-drawer-backdrop" onClick={onClose} />

      {/* Drawer panel */}
      <div className="tx-drawer" role="dialog" aria-modal="true" aria-label="Transaction details">

        {/* ── Header ── */}
        <div className="tx-drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className="type-badge"
              style={{ background: badge.bg, color: badge.color, fontSize: 12, padding: '4px 12px' }}
            >
              {badge.labelKey ? tr(badge.labelKey) : badge.label}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-3)', letterSpacing: '0.04em' }}>
              {fmtDate(tx.created_at)}
            </span>
          </div>
          <button className="tx-drawer-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Big amount ── */}
        <div className="tx-drawer-amount-block">
          <div className="tx-drawer-desc">{tx.description || tr('transactions.noDescription')}</div>
          <div className="tx-drawer-amount" style={{ color: amountColor }}>
            {amountSign}{fmtFull(amount)}
            <span className="tx-drawer-currency">{currency}</span>
          </div>
        </div>

        {/* ── Cash impact ── */}
        <div className="tx-detail-section">
          <div className="tx-detail-section-title">{tr('transactions.cashImpact')}</div>
          <div className="tx-cash-impact" style={{ background: impact.bg, color: impact.color }}>
            <span className="tx-cash-impact-icon">{impact.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{tr(impact.labelKey)}</div>
              {isTransfer && (
                <div style={{ fontSize: 'var(--text-xs)', marginTop: 3, opacity: 0.8 }}>
                  {tr('transactions.transferNeutral')}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Transaction details ── */}
        <div className="tx-detail-section">
          <div className="tx-detail-section-title">{tr('transactions.details')}</div>
          <div className="tx-detail-card">
            <DetailRow label={tr('transactions.description')} value={tx.description} />
            <DetailRow label={tr('transactions.category')}    value={tx.category} />
            <DetailRow label={tr('transactions.scope')}       value={tx.scope === 'business' ? '💼 Business' : '👤 Personal'} />
            <DetailRow label={tr('transactions.project') || 'Project'}     value={tx.project} />
            <DetailRow label={tr('transactions.date')}        value={fmtDateTime(tx.created_at)} />
            <DetailRow
              label={tr('transactions.amount')}
              value={`${amountSign}${fmtFull(amount)} ${currency}`}
              valueStyle={{ color: amountColor, fontWeight: 700 }}
            />
          </div>
        </div>

        {/* ── Reference data (Phase 1) — show if any field is set ── */}
        {(tx.counterparty_name || tx.counterparty_id || tx.business_direction_id || tx.activity_type_id) && (() => {
          const dirName = tx.business_direction_id
            ? (refDirections.find(d => d.id === tx.business_direction_id)?.name || tx.business_direction_id)
            : null
          const actName = tx.activity_type_id
            ? (refActivityTypes.find(a => a.id === tx.activity_type_id)?.name || tx.activity_type_id)
            : null
          return (
            <div className="tx-detail-section">
              <div className="tx-detail-section-title">{tr('transactions.classification')}</div>
              <div className="tx-detail-card">
                {tx.counterparty_name && <DetailRow label={tr('transactions.counterparty')} value={tx.counterparty_name} />}
                {dirName && <DetailRow label={tr('transactions.businessDirection')} value={dirName} />}
                {actName && <DetailRow label={tr('transactions.activityType')} value={actName} />}
              </div>
            </div>
          )
        })()}

        {/* ── Account / source ── */}
        {(() => {
          const walletName = tx.wallet_id
            ? (refWallets.find(w => w.id === tx.wallet_id)?.name || tx.wallet_id)
            : null
          const walletObj = tx.wallet_id
            ? refWallets.find(w => w.id === tx.wallet_id)
            : null
          return (
            <div className="tx-detail-section">
              <div className="tx-detail-section-title">{isTransfer ? tr('transactions.transferRoute') : tr('transactions.account')}</div>
              <div className="tx-detail-card">
                {isTransfer ? (
                  <>
                    <DetailRow label={tr('transactions.from')} value={walletName || tx.source} />
                    <DetailRow label={tr('transactions.to')}   value={destination} />
                  </>
                ) : (
                  <>
                    <DetailRow
                      label={tr('transactions.wallet')}
                      value={walletName
                        ? `${walletName}${walletObj?.currency && walletObj.currency !== 'IDR' ? ` · ${walletObj.currency}` : ''}`
                        : null}
                    />
                    {tx.source && <DetailRow label={tr('transactions.legacySource')} value={tx.source} />}
                  </>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── Meta ── */}
        <div className="tx-detail-section">
          <div className="tx-detail-section-title">{tr('transactions.recordInfo')}</div>
          <div className="tx-detail-card">
            <DetailRow label={tr('transactions.transactionID')} value={tx.id} valueStyle={{ fontFamily: 'monospace', fontSize: 12 }} />
            <DetailRow label={tr('transactions.createdAt')} value={fmtDateTime(tx.created_at)} />
          </div>
        </div>

      </div>
    </>,
    document.body
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Transactions() {
  const { token } = useAuth()
  const navigate = useNavigate()
  const { t: tr } = useTranslation()

  // Server-side filter state
  const [period, setPeriod]     = useState('month')
  const [scope, setScope]       = useState('all')

  // Client-side filter state
  const [search, setSearch]     = useState('')
  const [typeFilter, setType]   = useState('all')

  // Data state
  const [txs, setTxs]           = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  // Drawer state
  const [selectedTx, setSelectedTx] = useState(null)
  const closeDrawer = useCallback(() => setSelectedTx(null), [])

  // Reference data for resolving IDs → names in drawer
  const [refDirections,    setRefDirections]   = useState([])
  const [refActivityTypes, setRefActivityTypes] = useState([])
  const [refWallets,       setRefWallets]       = useState([])

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

  // Load reference data for resolving IDs in drawer (non-blocking)
  useEffect(() => {
    if (!token) return
    apiFetch('/business-directions', token).then(d => setRefDirections(d.directions || [])).catch(() => {})
    apiFetch('/activity-types', token).then(d => setRefActivityTypes(d.activityTypes || [])).catch(() => {})
    apiFetch('/wallets', token).then(d => setRefWallets(d.wallets || [])).catch(() => {})
  }, [token])

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

  // ── Summary metrics ───────────────────────────────────────────────────────
  const totalIncome   = filtered.filter(t => t.type === 'income' ).reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const totalExpenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount_original || t.amount_idr || 0), 0)
  const netFlow       = totalIncome - totalExpenses

  // ── Amount display helper ──────────────────────────────────────────────────
  function displayAmount(t) {
    const sign   = t.type === 'income' ? '+' : (t.type === 'expense' || t.type === 'payroll') ? '−' : ''
    const amount = t.amount_original ?? t.amount_idr ?? 0
    const cur    = t.currency_original && t.currency_original !== 'IDR' ? t.currency_original : 'IDR'
    return `${sign}${fmt(amount)} ${cur}`
  }

  function amountClass(t) {
    if (t.type === 'income')  return 'amount-positive'
    if (t.type === 'expense') return 'amount-negative'
    if (t.type === 'payroll') return 'amount-payroll'
    return 'amount-neutral'
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page tx-page">

      {/* ── Page header ─── */}
      <div className="hf-page-header" style={{ padding: '28px 28px 0', marginBottom: 0 }}>
        <div>
          <div className="hf-page-title">{tr('transactions.title')}</div>
          <div className="hf-page-subtitle">{tr('transactions.subtitle')}</div>
        </div>
        <div className="hf-page-actions">
          <button className="btn btn-primary btn-md" onClick={() => navigate('/add')}>
            {tr('transactions.addBtn')}
          </button>
        </div>
      </div>

      {/* ── Summary cards ─── */}
      <div className="summary-grid">
        <SummaryCard label={tr('transactions.totalIncome')}   value={fmt(totalIncome)}   sub={`${filtered.filter(tx => tx.type === 'income').length} ${tr('transactions.transactionsLabel')}`}  color="var(--green)" />
        <SummaryCard label={tr('transactions.totalExpenses')} value={fmt(totalExpenses)} sub={`${filtered.filter(tx => tx.type === 'expense').length} ${tr('transactions.transactionsLabel')}`} color="var(--red)"   />
        <SummaryCard label={tr('transactions.netFlow')}       value={(netFlow >= 0 ? '+' : '') + fmt(netFlow)} sub={tr('transactions.incomeExpenses')} color={netFlow >= 0 ? 'var(--green)' : 'var(--red)'} />
        <SummaryCard label={tr('transactions.showing')}        value={filtered.length}    sub={tr('transactions.transactionsLabel')}    color="var(--text)" />
      </div>

      {/* ── Filter bar ─── */}
      <div className="filter-bar">
        <div className="filter-search-wrap">
          <span className="filter-search-icon"><SearchIcon /></span>
          <input
            className="filter-search"
            placeholder={tr('transactions.searchPlaceholder')}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && <button className="filter-search-clear" onClick={() => setSearch('')}>×</button>}
        </div>
        <select className="filter-select" value={typeFilter} onChange={e => setType(e.target.value)}>
          <option value="all">{tr('transactions.allTypes')}</option>
          <option value="income">{tr('transactions.income')}</option>
          <option value="expense">{tr('transactions.expense')}</option>
          <option value="transfer">{tr('transactions.transfer')}</option>
          <option value="payroll">{tr('transactions.payroll')}</option>
        </select>
        <select className="filter-select" value={scope} onChange={e => setScope(e.target.value)}>
          <option value="all">{tr('transactions.allScopes')}</option>
          <option value="business">{tr('common.business')}</option>
          <option value="personal">{tr('common.personal')}</option>
        </select>
        <select className="filter-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="month">{tr('transactions.thisMonth')}</option>
          <option value="week">{tr('transactions.last7Days')}</option>
          <option value="today">{tr('transactions.today')}</option>
        </select>
      </div>

      {/* ── Mobile filter chips ─── */}
      <div className="filter-chips">
        {['all', 'income', 'expense'].map(tp => (
          <button
            key={tp}
            className={`filter-chip${typeFilter === tp ? ' active' : ''}`}
            onClick={() => setType(tp)}
          >
            {tp === 'all' ? tr('transactions.allScopesMobile') : tp === 'income' ? `↓ ${tr('transactions.income')}` : `↑ ${tr('transactions.expense')}`}
          </button>
        ))}
        <select className="filter-chip-select" value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="month">{tr('transactions.thisMonth')}</option>
          <option value="week">{tr('transactions.last7DaysShort')}</option>
          <option value="today">{tr('transactions.today')}</option>
        </select>
      </div>

      {/* ── Loading ─── */}
      {loading && (
        <div className="tx-state-center">
          <div className="tx-loading-spinner" />
          <div className="tx-state-text">{tr('transactions.loadingTransactions')}</div>
        </div>
      )}

      {/* ── Error ─── */}
      {!loading && error && (
        <div className="tx-state-center">
          <div className="tx-state-icon">⚠️</div>
          <div className="tx-state-text" style={{ color: 'var(--red)' }}>{tr('transactions.couldNotLoad')}</div>
          <div className="tx-state-sub">{error}</div>
          <button className="tx-retry-btn" onClick={load}>{tr('common.retry')}</button>
        </div>
      )}

      {/* ── Empty ─── */}
      {!loading && !error && filtered.length === 0 && (
        <div className="tx-state-center">
          <div className="tx-state-icon">💸</div>
          <div className="tx-state-text">{tr('transactions.noTransactions')}</div>
          <div className="tx-state-sub">
            {search || typeFilter !== 'all'
              ? tr('transactions.tryAdjusting')
              : tr('transactions.addFirst')}
          </div>
          {!search && typeFilter === 'all' && (
            <button className="tx-retry-btn" onClick={() => navigate('/add')}>{tr('transactions.addTransaction')}</button>
          )}
          {(search || typeFilter !== 'all') && (
            <button className="tx-retry-btn" onClick={() => { setSearch(''); setType('all') }}>{tr('transactions.clearFilters')}</button>
          )}
        </div>
      )}

      {/* ── Desktop table ─── */}
      {!loading && !error && filtered.length > 0 && (
        <div className="tx-table-wrap">
          <table className="tx-table">
            <thead>
              <tr>
                <th>{tr('transactions.date')}</th>
                <th>{tr('transactions.description')}</th>
                <th>{tr('transactions.category')}</th>
                <th>{tr('transactions.source')}</th>
                <th>{tr('transactions.scope')}</th>
                <th className="tx-col-amount">{tr('transactions.amount')}</th>
                <th>{tr('transactions.type')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => {
                const badge = getTypeBadge(t.type)
                const isSelected = selectedTx?.id === t.id
                return (
                  <tr
                    key={t.id}
                    className={`tx-row-clickable${isSelected ? ' tx-row-selected' : ''}`}
                    onClick={() => setSelectedTx(isSelected ? null : t)}
                  >
                    <td className="tx-col-date">{fmtDate(t.created_at)}</td>
                    <td className="tx-col-desc">
                      <div className="tx-desc-text">{t.description || '—'}</div>
                      {t.project && <div className="tx-desc-sub">{t.project}</div>}
                    </td>
                    <td className="tx-col-cat">
                      <span className="tx-cat-text">{t.category || tr('transactions.uncategorized')}</span>
                    </td>
                    <td className="tx-col-source">
                      <span className="tx-source-text">{t.source || '—'}</span>
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
                      <span className="type-badge" style={{ background: badge.bg, color: badge.color }}>
                        {badge.labelKey ? tr(badge.labelKey) : badge.label}
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
            const isSelected = selectedTx?.id === t.id
            const dotBg    = t.type === 'income'  ? 'var(--green-light)' : t.type === 'expense' ? 'var(--red-light)'  : t.type === 'payroll' ? 'var(--amber-light)' : 'var(--bg-3)'
            const dotColor = t.type === 'income'  ? 'var(--green)'       : t.type === 'expense' ? 'var(--red)'        : t.type === 'payroll' ? 'var(--amber-dark)'  : 'var(--text-3)'
            const dotIcon  = t.type === 'income'  ? '↓'                  : t.type === 'expense' ? '↑'                 : t.type === 'payroll' ? '💼'                 : '↔'
            return (
              <div
                key={t.id}
                className={`tx-card tx-row-clickable${isSelected ? ' tx-row-selected' : ''}`}
                onClick={() => setSelectedTx(isSelected ? null : t)}
              >
                <div className="tx-card-left">
                  <div className="tx-card-dot" style={{ background: dotBg }}>
                    <span style={{ fontSize: 14, color: dotColor }}>{dotIcon}</span>
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
                  <span className="type-badge" style={{ background: badge.bg, color: badge.color, marginTop: 4 }}>
                    {badge.labelKey ? tr(badge.labelKey) : badge.label}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Transaction details drawer ─── */}
      {selectedTx && (
        <TransactionDetailsDrawer tx={selectedTx} onClose={closeDrawer} refDirections={refDirections} refActivityTypes={refActivityTypes} refWallets={refWallets} />
      )}

    </div>
  )
}
