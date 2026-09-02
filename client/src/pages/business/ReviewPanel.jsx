// Inline expandable review panel — the desktop replacement for the side drawer.
//
// ── Why a hook and not pure CSS ──────────────────────────────────────────────
// An inline panel must be rendered INSIDE the row list (directly under the selected
// row); a drawer is rendered at page level. That is a DOM-position difference, not a
// style difference, so a media query alone cannot express it. `useIsDesktop` decides
// which of the two mount points is used, and the existing drawer components are left
// completely intact for the mobile path — no mobile regression is possible, because
// on mobile nothing about the old code path changes.
//
// ── What this file is NOT ────────────────────────────────────────────────────
// It holds no business logic. Every judgement rendered inside a panel still comes from
// evidenceModel.js / companyVault.js / computeInvoicePlan — the same pure functions the
// drawers call. This is layout and interaction only.
import { useEffect, useState } from 'react'
import { Icon } from '../../shell/ui'
import './ReviewPanel.css'

/** Desktop = inline panel. Below this width the page keeps its existing drawer/sheet. */
export const DESKTOP_QUERY = '(min-width: 1024px)'

export function useIsDesktop() {
  const [is, setIs] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true
    return window.matchMedia(DESKTOP_QUERY).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia(DESKTOP_QUERY)
    const on = (e) => setIs(e.matches)
    // addEventListener is not available on MediaQueryList in older Safari.
    if (mq.addEventListener) { mq.addEventListener('change', on); return () => mq.removeEventListener('change', on) }
    mq.addListener(on); return () => mq.removeListener(on)
  }, [])
  return is
}

/**
 * One expanded row at a time, per page.
 * Returns { id, isOpen, toggle, open, close } — `toggle` on the same row collapses it,
 * on a different row switches to it, which is the behaviour the spec asks for.
 */
export function useInlineExpand() {
  const [state, setState] = useState(null)          // { id, focus } | null
  const open = (id, focus = null) => setState({ id, focus })
  const close = () => setState(null)
  const toggle = (id, focus = null) =>
    setState((s) => (s && s.id === id && s.focus === focus ? null : { id, focus }))
  return { id: state?.id ?? null, focus: state?.focus ?? null, isOpen: (x) => state?.id === x, open, close, toggle }
}

/**
 * The panel shell. Renders inline (no scrim, no modal semantics) — it is part of the
 * page, not an overlay, which is the whole point of the pattern.
 */
export default function ReviewPanel({
  eyebrow, title, sub, chips, onClose, children, tone = 'default', labelledBy,
}) {
  // Escape collapses. Bound at document level so it works wherever focus sits inside
  // the panel, and removed on unmount so a collapsed panel never keeps a listener.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <section className={`rp rp--${tone}`} role="region" aria-label={labelledBy || title || 'Review panel'}>
      <header className="rp-head">
        <div className="rp-head-main">
          {eyebrow && <span className="rp-eyebrow">{eyebrow}</span>}
          {title && <h3 className="rp-title">{title}</h3>}
          {sub && <p className="rp-sub">{sub}</p>}
        </div>
        <div className="rp-head-side">
          {chips}
          <button type="button" className="rp-x" onClick={onClose} aria-label="Collapse panel">
            <Icon.plus width="15" height="15" style={{ transform: 'rotate(45deg)' }} />
          </button>
        </div>
      </header>
      {children}
    </section>
  )
}

/** Three-column body. Collapses to 2 then 1 as width drops. */
export const RpCols = ({ children, className = '' }) => (
  <div className={`rp-cols ${className}`.trim()}>{children}</div>
)

/**
 * One column. `emphasis` marks the column that should read strongest on the page —
 * payment breakdown on invoices, checklist on records, preview on documents.
 */
export const RpCol = ({ label, emphasis = false, wide = false, children }) => (
  <div className={`rp-col${emphasis ? ' is-emphasis' : ''}${wide ? ' is-wide' : ''}`}>
    {label && <span className="rp-col-label">{label}</span>}
    {children}
  </div>
)

/** Key/value line, the same shape the drawers use. */
export const RpKv = ({ k, v, missing = 'Not set' }) => (
  <div className="rp-kv">
    <span>{k}</span>
    <span>{v || <em className="rp-miss">{missing}</em>}</span>
  </div>
)

/** Footer action bar. The primary action stays first and always visible. */
export const RpActions = ({ children }) => <div className="rp-actions">{children}</div>
