// v2 primitives. Presentational only; styled by v2.css from brand tokens.
import { Link } from 'react-router-dom'
import { Ico } from './icons'
import { useV2T } from '../lib/i18n'

export { Ico }

const cx = (...a) => a.filter(Boolean).join(' ')

export function Page({ title, sub, actions, children, narrow }) {
  return (
    <div className={cx('v2-page', narrow && 'v2-page-narrow')}>
      {(title || actions) && (
        <header className="v2-pagehead">
          <div className="v2-pagehead-text">
            {title && <h1 className="v2-h1">{title}</h1>}
            {sub && <p className="v2-sub">{sub}</p>}
          </div>
          {actions && <div className="v2-pagehead-actions">{actions}</div>}
        </header>
      )}
      {children}
    </div>
  )
}

export function Card({ title, sub, action, children, className, hero, flush, as: As = 'section', ...rest }) {
  return (
    <As className={cx('v2-card', hero && 'v2-card-hero', flush && 'v2-card-flush', className)} {...rest}>
      {(title || action) && (
        <div className="v2-cardhead">
          <div className="v2-cardhead-text">
            {title && <h2 className="v2-h2">{title}</h2>}
            {sub && <p className="v2-cardsub">{sub}</p>}
          </div>
          {action && <div className="v2-cardhead-action">{action}</div>}
        </div>
      )}
      {children}
    </As>
  )
}

/**
 * Button or link. `to` → router Link; `href` → anchor; otherwise <button>.
 * `notYet` renders an honest disabled control with a visible "Not available yet"
 * hint — never a dead click.
 */
export function Btn({ variant = 'secondary', size, to, href, onClick, disabled, notYet, icon, children, className, type = 'button', ...rest }) {
  const { t } = useV2T()
  const cls = cx('v2-btn', `v2-btn-${variant}`, size && `v2-btn-${size}`, className)
  const inner = <>{icon && <Ico name={icon} size={16} />}{children && <span className="v2-btn-label">{children}</span>}</>
  if (notYet) {
    return (
      <button type="button" className={cx(cls, 'is-notyet')} disabled aria-disabled="true"
        title={t('state.notYet')} {...rest}>
        {inner}<span className="v2-notyet-tag">{t('state.notYet')}</span>
      </button>
    )
  }
  if (to && !disabled) return <Link className={cls} to={to} {...rest}>{inner}</Link>
  if (href && !disabled) return <a className={cls} href={href} {...rest}>{inner}</a>
  return <button type={type} className={cls} onClick={onClick} disabled={disabled} {...rest}>{inner}</button>
}

/** Status pill. Tone colour is never the only signal: the label carries meaning. */
export function Pill({ tone = 'neutral', dot, children, className }) {
  return (
    <span className={cx('v2-pill', `v2-pill-${tone}`, className)}>
      {dot && <span className="v2-pill-dot" aria-hidden="true" />}{children}
    </span>
  )
}

export function Count({ tone = 'neutral', children, label }) {
  if (children === null || children === undefined || children === 0 || children === '') return null
  return <span className={cx('v2-count', `v2-count-${tone}`)} aria-label={label}>{children}</span>
}

/** Segmented tabs. Items with `to` are links (route-driven); else buttons. */
export function Tabs({ items, active, onChange, label, size }) {
  return (
    <div className={cx('v2-tabs', size && `v2-tabs-${size}`)} role="tablist" aria-label={label}>
      {items.map((it) => {
        const on = it.key === active
        const content = <>{it.label}{it.badge != null && <span className="v2-tab-badge">{it.badge}</span>}</>
        return it.to ? (
          <Link key={it.key} to={it.to} role="tab" aria-selected={on} className={cx('v2-tab', on && 'is-on')}>{content}</Link>
        ) : (
          <button key={it.key} type="button" role="tab" aria-selected={on} className={cx('v2-tab', on && 'is-on')}
            onClick={() => onChange && onChange(it.key)} disabled={it.disabled}>{content}</button>
        )
      })}
    </div>
  )
}

export function Chip({ on, onClick, children, to, notYet, icon }) {
  const { t } = useV2T()
  if (notYet) {
    return <button type="button" className="v2-chip is-notyet" disabled aria-disabled="true" title={t('state.notYet')}>
      {icon && <Ico name={icon} size={14} />}{children}<span className="v2-sr">{` (${t('state.notYet')})`}</span></button>
  }
  if (to) return <Link className={cx('v2-chip', on && 'is-on')} to={to}>{icon && <Ico name={icon} size={14} />}{children}</Link>
  return <button type="button" className={cx('v2-chip', on && 'is-on')} aria-pressed={!!on} onClick={onClick}>
    {icon && <Ico name={icon} size={14} />}{children}</button>
}

export function Kpi({ label, value, meta, metaTone, tone, className }) {
  return (
    <div className={cx('v2-kpi', className)}>
      <div className="v2-kpi-label">{label}</div>
      <div className={cx('v2-kpi-value', 'v2-num', tone && `is-${tone}`)}>{value}</div>
      {meta && <div className={cx('v2-kpi-meta', metaTone && `is-${metaTone}`)}>{meta}</div>}
    </div>
  )
}

export const Num = ({ children, tone, className }) => (
  <span className={cx('v2-num', tone && `is-${tone}`, className)}>{children}</span>
)

export function Empty({ icon = 'doc', title, body, action }) {
  return (
    <div className="v2-empty">
      <span className="v2-empty-ic"><Ico name={icon} size={22} /></span>
      {title && <div className="v2-empty-title">{title}</div>}
      {body && <p className="v2-empty-body">{body}</p>}
      {action && <div className="v2-empty-action">{action}</div>}
    </div>
  )
}

export function Loading({ rows = 3 }) {
  const { t } = useV2T()
  return (
    <div className="v2-loading" role="status" aria-live="polite">
      <span className="v2-sr">{t('shell.loading')}</span>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="v2-skel" style={{ width: `${90 - i * 12}%` }} />)}
    </div>
  )
}

export function ErrorBox({ error, onRetry }) {
  const { t } = useV2T()
  const msg = error ? (error.message || String(error)) : ''
  return (
    <div className="v2-error" role="alert">
      <Ico name="warn" size={18} />
      <div className="v2-error-text">
        <strong>{t('state.loadFailed')}</strong>
        {msg && <span className="v2-error-msg">{msg}</span>}
      </div>
      {onRetry && <Btn size="sm" onClick={onRetry}>{t('state.retry')}</Btn>}
    </div>
  )
}

/** Inline honest note: a figure or feature that is not available yet. */
export function Note({ tone = 'info', icon = 'clock', children, action }) {
  return (
    <div className={cx('v2-note', `v2-note-${tone}`)}>
      <Ico name={icon} size={16} />
      <div className="v2-note-text">{children}</div>
      {action && <div className="v2-note-action">{action}</div>}
    </div>
  )
}

/** Accessible "chart + table" wrapper: every chart has a Show-as-table view. */
export function ChartFrame({ title, legend, table, children, showTableLabel, showChartLabel, tableOn, onToggle }) {
  return (
    <div className="v2-chart">
      {children && !tableOn && <div className="v2-chart-plot">{children}</div>}
      {tableOn && <div className="v2-chart-table">{table}</div>}
      <div className="v2-chart-foot">
        {legend && !tableOn && <div className="v2-legend">{legend}</div>}
        {table && <button type="button" className="v2-linkbtn" onClick={onToggle} aria-pressed={!!tableOn}>
          <Ico name={tableOn ? 'performance' : 'table'} size={14} />{tableOn ? showChartLabel : showTableLabel}
        </button>}
      </div>
      {title && <span className="v2-sr">{title}</span>}
    </div>
  )
}
