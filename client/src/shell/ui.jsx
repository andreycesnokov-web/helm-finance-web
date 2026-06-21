// CFO AI — shared UI primitives (Phase 1). One set for Personal + Business.
// Brand-token styled (shell.css). Stateless/presentational; no business logic.
import { useState, useRef, useEffect } from 'react'

/* ── icons (stroke = currentColor) ─────────────────────────────────────────── */
export const Icon = {
  lock:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>,
  users:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/></svg>,
  plus:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" {...p}><line x1="12" y1="6" x2="12" y2="18"/><line x1="6" y1="12" x2="18" y2="12"/></svg>,
  chev:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><polyline points="6 9 12 15 18 9"/></svg>,
  warn:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  dot:    (p) => <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>,
  dots:   (p) => <svg viewBox="0 0 24 24" fill="currentColor" {...p}><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>,
  pulse:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
  wallet: (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>,
  list:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>,
  fund:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>,
  link:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>,
  doc:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>,
  cfo:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  cog:    (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  team:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  check:  (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  down:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>,
  up:     (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>,
  acct:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>,
  bank:   (p) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}><path d="M3 21h18"/><path d="M3 10h18"/><path d="M5 6l7-3 7 3"/><path d="M4 10v11M20 10v11M9 10v11M15 10v11"/></svg>,
}

/* ── primitives ─────────────────────────────────────────────────────────────*/
export const Btn = ({ variant = 'primary', sm, icon, children, ...p }) => (
  <button className={`cfo-btn cfo-btn-${variant}${sm ? ' cfo-btn-sm' : ''}`} {...p}>{icon}{children}</button>
)

export const StatusBadge = ({ tone = 'neutral', icon, children }) => (
  <span className={`cfo-badge cfo-badge-${tone}`}>{icon}{children}</span>
)

export const PageHeader = ({ eyebrow, title, actions }) => (
  <div className="cfo-pagehead">
    <div>{eyebrow && <div className="cfo-eyebrow">{eyebrow}</div>}<h1 className="cfo-h1">{title}</h1></div>
    {actions && <div className="cfo-pagehead-actions">{actions}</div>}
  </div>
)

export const Card = ({ title, action, children, className = '' }) => (
  <section className={`cfo-card ${className}`}>
    {(title || action) && <div className="cfo-card-head"><span className="cfo-card-title">{title}</span>{action}</div>}
    {children}
  </section>
)

// Summary / hero card. `metrics` = [{k, v, tone}]
export const SummaryCard = ({ label, value, meta, metrics, symbol }) => (
  <section className="cfo-summary">
    {symbol && <img className="cfo-summary-sym" src={symbol} alt="" aria-hidden />}
    <div className="cfo-summary-label">{label}</div>
    <div className="cfo-summary-value">{value}</div>
    {meta && <div className="cfo-summary-meta">{meta}</div>}
    {metrics && (
      <div className="cfo-summary-row">
        {metrics.map((m, i) => (
          <div key={i}><span className="cfo-summary-k">{m.k}</span><span className={`cfo-summary-v ${m.tone || ''}`}>{m.v}</span></div>
        ))}
      </div>
    )}
  </section>
)

// Native-asset money card. Never used to sum across assets.
export const MoneyCard = ({ asset, kind = 'Fiat', sub, native, unit, reporting, ts, stale }) => (
  <div className="cfo-money">
    <div className="cfo-money-top">
      <span className={`cfo-money-asset ${kind.toLowerCase() === 'crypto' ? 'crypto' : 'fiat'}`}>{asset}</span>
      <span className="cfo-money-sub">{sub || kind}</span>
    </div>
    <div className="cfo-money-native">{native} {unit && <span className="cfo-money-unit">{unit}</span>}</div>
    {reporting && <div className="cfo-money-rep">{reporting}</div>}
    {ts && <div className={`cfo-money-ts${stale ? ' stale' : ''}`}>{stale && <Icon.warn />}{ts}</div>}
  </div>
)

export const Stat = ({ k, v, tone }) => (
  <div className="cfo-stat"><span className="cfo-stat-k">{k}</span><span className={`cfo-stat-v ${tone || ''}`}>{v}</span></div>
)

export const PageTabs = ({ tabs, active, onChange }) => (
  <div className="cfo-tabs" role="tablist">
    {tabs.map(t => (
      <button key={t.key} role="tab" aria-selected={active === t.key}
        className={`cfo-tab${active === t.key ? ' is-active' : ''}`} onClick={() => onChange(t.key)}>{t.label}</button>
    ))}
  </div>
)

export const LoadingSkeleton = ({ rows = 3, height = 16, gap = 12, width = '100%' }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="cfo-skel" style={{ height, width: typeof width === 'function' ? width(i) : width }} />
    ))}
  </div>
)

export const EmptyState = ({ symbol, title, description, actions }) => (
  <div className="cfo-state">
    {symbol && <img src={symbol} alt="" className="cfo-state-sym" aria-hidden />}
    <h2 className="cfo-state-h">{title}</h2>
    {description && <p className="cfo-state-p">{description}</p>}
    {actions && <div className="cfo-state-actions">{actions}</div>}
  </div>
)

export const ErrorState = ({ title = 'Something went wrong', description, onRetry, retryLabel = 'Try again' }) => (
  <div className="cfo-state">
    <span className="cfo-state-ic danger"><Icon.warn /></span>
    <h2 className="cfo-state-h">{title}</h2>
    {description && <p className="cfo-state-p">{description}</p>}
    {onRetry && <Btn onClick={onRetry}>{retryLabel}</Btn>}
  </div>
)

export const ConfirmationModal = ({ open, title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', tone = 'primary', onConfirm, onCancel }) => {
  if (!open) return null
  return (
    <div className="cfo-modal-scrim" onClick={onCancel}>
      <div className="cfo-modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3 className="cfo-modal-title">{title}</h3>
        <div className="cfo-modal-body">{children}</div>
        <div className="cfo-modal-actions">
          <Btn variant="ghost" onClick={onCancel}>{cancelLabel}</Btn>
          <Btn variant={tone} onClick={onConfirm}>{confirmLabel}</Btn>
        </div>
      </div>
    </div>
  )
}

export const ActionMenu = ({ items }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h)
  }, [])
  return (
    <div className="cfo-menu-wrap" ref={ref}>
      <button className="cfo-iconbtn" aria-label="Actions" onClick={() => setOpen(o => !o)}><Icon.dots width="18" height="18" /></button>
      {open && (
        <div className="cfo-menu" role="menu">
          {items.map((it, i) => (
            <button key={i} role="menuitem" className={`cfo-menu-item${it.danger ? ' danger' : ''}`}
              onClick={() => { setOpen(false); it.onClick?.() }}>{it.icon}{it.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

// ResponsiveTable: real <table> on desktop; on mobile each row becomes a stacked card.
// columns = [{key, label, num, render}], rows = array of objects, rowKey = fn
export const ResponsiveTable = ({ columns, rows, rowKey, onRowClick }) => (
  <div className="cfo-table-wrap">
    <table className="cfo-table">
      <thead><tr>{columns.map(c => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={rowKey ? rowKey(r) : i} onClick={onRowClick ? () => onRowClick(r) : undefined} style={onRowClick ? { cursor: 'pointer' } : undefined}>
            {columns.map(c => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

// DataList: icon + label/sub + amount rows (transactions, activity, repayments…)
export const DataList = ({ items }) => (
  <ul className="cfo-list">
    {items.map((it, i) => (
      <li key={it.id || i} className="cfo-list-item">
        {it.dir && <span className={`cfo-list-ic ${it.dir}`}>{it.dir === 'in' ? '↓' : it.dir === 'out' ? '↑' : '•'}</span>}
        <span className="cfo-list-main">
          <span className="cfo-list-label">{it.label}{it.tag && <span className="cfo-chip cfo-chip-soft">{it.tag}</span>}</span>
          {it.sub && <span className="cfo-list-sub">{it.sub}</span>}
        </span>
        {it.amount && <span className={`cfo-list-amt ${it.amountTone || ''}`}>{it.amount}</span>}
      </li>
    ))}
  </ul>
)
